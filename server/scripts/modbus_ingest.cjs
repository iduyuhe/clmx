/**
 * CLMX 真实设备接入 — Modbus 时序摄入适配器（独立进程，可经 pm2 常驻）
 *
 * 功能：
 *   - 通过 Modbus TCP/RTU 轮询远程设备寄存器，读取数值
 *   - 按映射配置将寄存器地址 → 传感器 ID，写入 SensorData
 *   - 经租户隔离后写入并累加存储配额
 *
 * 运行：
 *   node scripts/modbus_ingest.cjs                   # 连接外部 Modbus 设备，按配置轮询
 *   node scripts/modbus_ingest.cjs --selftest         # 内嵌模拟 Modbus 服务器做端到端验证
 *
 * 环境变量：
 *   DATABASE_URL            PG 连接串（必填）
 *   MODBUS_ENDPOINT         modbus://host:port（TCP 默认 502）或 modbus-rtu:///dev/ttyUSB0
 *   MODBUS_MAP_FILE         映射配置文件路径（JSON，见下文格式）
 *   MODBUS_INTERVAL_MS      轮询间隔毫秒（默认 5000）
 *   MODBUS_SLAVE_ID         Modbus 从站 ID（默认 1）
 *
 * 映射文件格式（JSON）：
 *   [
 *     { "sensorId": "<sensor-uuid>", "address": 0, "type": "holding", "length": 1, "scale": 0.1 },
 *     { "sensorId": "...", "address": 1, "type": "input", "length": 2, "scale": 1 }
 *   ]
 *   - address: 寄存器起始地址
 *   - type: holding | input（保持寄存器/输入寄存器）
 *   - length: 1=16位单精度, 2=32位浮点(大端)
 *   - scale: 缩放系数（raw * scale = 实际值）
 */
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const ModbusRTU = require('modbus-serial')

const prisma = new PrismaClient()

const PLAN_STORAGE_LIMIT = { TRIAL: 50, FREE: 1000000, PRO: 20000000, ENTERPRISE: 500000000 }

async function incrementStorageUsed(tenantId, points) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) return
  const limit = PLAN_STORAGE_LIMIT[tenant.planType] || PLAN_STORAGE_LIMIT.FREE
  const next = (tenant.storageUsed || BigInt(0)) + BigInt(Math.max(0, points))
  if (next > BigInt(limit)) throw new Error(`存储空间配额已用尽（套餐上限 ${limit} 个数据点）`)
  await prisma.tenant.update({ where: { id: tenantId }, data: { storageUsed: next } })
}

function parseModbusEndpoint(ep) {
  if (!ep) return null
  const tcpMatch = ep.match(/^modbus:\/\/(.+):(\d+)$/)
  if (tcpMatch) return { transport: 'tcp', host: tcpMatch[1], port: parseInt(tcpMatch[2]) }
  const rtuMatch = ep.match(/^modbus-rtu:\/\/(.+)$/)
  if (rtuMatch) return { transport: 'rtu', path: rtuMatch[1] }
  // 默认尝试解析为 host:port
  const parts = ep.split(':')
  if (parts.length === 2) return { transport: 'tcp', host: parts[0], port: parseInt(parts[1]) }
  return null
}

function loadMap(filePath) {
  const map = JSON.parse(require('fs').readFileSync(filePath, 'utf-8'))
  if (!Array.isArray(map) || map.length === 0) throw new Error('映射文件必须为非空数组')
  for (const entry of map) {
    if (!entry.sensorId || entry.address === undefined) throw new Error('映射条目缺少 sensorId 或 address')
  }
  return map
}

/**
 * 读取 Modbus 寄存器值并按 scale 转换
 */
async function readModbusValue(client, entry, slaveId) {
  const len = entry.length || 1
  let raw
  try {
    if (entry.type === 'input') {
      raw = await client.readInputRegisters(entry.address, len)
    } else {
      raw = await client.readHoldingRegisters(entry.address, len)
    }
  } catch (e) {
    console.warn(`[modbus] 读取地址 ${entry.address} 失败: ${e.message}`)
    return null
  }
  if (!raw || !raw.data || raw.data.length < len) return null

  let value
  if (len >= 2) {
    // 32 位大端浮点
    const buf = Buffer.alloc(4)
    buf.writeUInt16BE(raw.data[0], 0)
    buf.writeUInt16BE(raw.data[1], 2)
    value = buf.readFloatBE(0)
  } else {
    value = raw.data[0]
  }
  const scale = entry.scale || 1
  return Math.round(value * scale * 100) / 100
}

async function ingest(tenantId, sensorId, value) {
  const sensor = await prisma.sensor.findUnique({ where: { id: sensorId }, include: { device: true } })
  if (!sensor) return { ok: false, reason: 'sensor_not_found' }
  if (sensor.device.tenantId !== tenantId) return { ok: false, reason: 'tenant_mismatch' }
  await incrementStorageUsed(tenantId, 1)
  await prisma.sensorData.create({
    data: {
      sensorId: sensor.id,
      tenantId,
      value,
      quality: 'GOOD',
      timestamp: new Date(),
    },
  })
  return { ok: true }
}

async function pollLoop(client, map, slaveId, tenantId, intervalMs) {
  console.log(`[modbus] 开始轮询 ${map.length} 个寄存器，间隔 ${intervalMs}ms`)
  for (;;) {
    for (const entry of map) {
      const value = await readModbusValue(client, entry, slaveId)
      if (value === null) continue
      await ingest(tenantId, entry.sensorId, value)
      console.log(`[modbus] 传感器 ${entry.sensorId} @${entry.address} = ${value}`)
    }
    await new Promise(r => setTimeout(r, intervalMs))
  }
}

// ─── 自检模式（内嵌 Modbus 模拟服务器）────────────────────
async function selfTest() {
  console.log('[modbus] 自检模式：启动模拟 Modbus TCP 服务器 + 客户端轮询验证')
  const net = require('net')

  // 模拟 Modbus TCP 服务器（响应单寄存器读取，适应自测需求）
  const mockServer = net.createServer(sock => {
    sock.on('data', buf => {
      if (buf.length < 8) return
      const tid = buf.readUInt16BE(0)
      const unitId = buf[6]
      const fc = buf[7]
      const startAddr = buf.readUInt16BE(8)
      const quantity = buf.readUInt16BE(10)  // 请求的寄存器数量
      const dataLen = quantity * 2            // 每个寄存器 2 字节
      const resp = Buffer.alloc(9 + dataLen)
      resp.writeUInt16BE(tid, 0)
      resp.writeUInt16BE(0, 2)      // 协议标识
      resp.writeUInt16BE(3 + dataLen, 4)  // 剩余长度 = UnitId+FC+ByteCount+Data
      resp[6] = unitId
      resp[7] = fc
      resp[8] = dataLen              // Byte Count
      for (let i = 0; i < quantity; i++) {
        // 地址2开始的连续2个寄存器组成 100.0 的 IEEE 754 float32 大端
        const addr = startAddr + i
        let val = 100  // 默认
        if (addr === 2) val = 0x42C8   // 100.0 高16位
        if (addr === 3) val = 0x0000   // 100.0 低16位
        resp.writeUInt16BE(val, 9 + i * 2)
      }
      sock.write(resp)
    })
  })

  await new Promise(r => mockServer.listen(0, '127.0.0.1', r))
  const port = mockServer.address().port
  console.log(`[modbus] 模拟服务器已启动 :${port}`)

  // 客户端连接并读取
  const client = new ModbusRTU()
  await client.connectTCP('127.0.0.1', { port })
  client.setID(1)

  const map = [
    { sensorId: '__test_sensor_1__', address: 0, type: 'holding', length: 1, scale: 1 },
    { sensorId: '__test_sensor_2__', address: 2, type: 'holding', length: 2, scale: 0.1 },
  ]
  const results = []
  for (const entry of map) {
    const val = await readModbusValue(client, entry, 1)
    results.push({ address: entry.address, value: val })
    console.log(`  [modbus] 读取 地址=${entry.address} 值=${val}`)
  }

  client.close()
  mockServer.close()

  // 断言
  const v0 = results.find(r => r.address === 0)
  const v2 = results.find(r => r.address === 2)
  if (!v0 || v0.value !== 100) throw new Error('地址0 期望 100，实际 ' + (v0 ? v0.value : 'null'))
  if (!v2 || Math.abs(v2.value - 10.0) > 0.01) throw new Error('地址2(浮点+scale) 期望 10.0，实际 ' + (v2 ? v2.value : 'null'))
  console.log('[modbus] 自检 PASS')
}

// ─── 入口 ───────────────────────────
async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--selftest')) {
    await selfTest()
    await prisma.$disconnect()
    return
  }

  const endpoint = process.env.MODBUS_ENDPOINT || 'modbus://127.0.0.1:502'
  const mapFile = process.env.MODBUS_MAP_FILE
  const intervalMs = parseInt(process.env.MODBUS_INTERVAL_MS || '5000')
  const slaveId = parseInt(process.env.MODBUS_SLAVE_ID || '1')

  if (!mapFile) {
    console.error('[modbus] 必需环境变量 MODBUS_MAP_FILE')
    process.exit(1)
  }

  const parsed = parseModbusEndpoint(endpoint)
  if (!parsed) {
    console.error('[modbus] 无法解析 Modbus 端点:', endpoint)
    process.exit(1)
  }

  let map
  try {
    map = loadMap(mapFile)
  } catch (e) {
    console.error('[modbus] 加载映射文件失败:', e.message)
    process.exit(1)
  }

  // 从映射文件推断租户（取第一个 sensorId 的 tenant）
  const firstSensor = await prisma.sensor.findUnique({ where: { id: map[0].sensorId }, include: { device: true } })
  if (!firstSensor) {
    console.error('[modbus] 映射中第一个传感器不存在:', map[0].sensorId)
    process.exit(1)
  }
  const tenantId = firstSensor.device.tenantId
  console.log(`[modbus] 租户: ${tenantId}, 传感器: ${map.length} 个`)

  const client = new ModbusRTU()
  if (parsed.transport === 'rtu') {
    await client.connectRTUBuffered(parsed.path, { baudRate: 9600 })
  } else {
    await client.connectTCP(parsed.host, { port: parsed.port })
  }
  client.setID(slaveId)
  console.log(`[modbus] 已连接到 ${endpoint}`)

  await pollLoop(client, map, slaveId, tenantId, intervalMs)
}

main().catch(e => {
  console.error('[modbus] 错误:', e.message)
  process.exit(1)
})
