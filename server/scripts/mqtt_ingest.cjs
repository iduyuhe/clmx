/**
 * CLMX 真实设备接入 — MQTT 时序摄入适配器（独立进程，可经 pm2 常驻）
 *
 * 功能：
 *   - 订阅 MQTT 主题（默认 clmx/+/+/telemetry），解析设备上报的 JSON 负载
 *   - 解析 sensorId 直连，或 deviceCode + sensorChannel 定位传感器
 *   - 经租户隔离后写入 SensorData，并累加存储配额（复用 SaaS 配额逻辑）
 *
 * 运行：
 *   node scripts/mqtt_ingest.cjs                 # 连接外部 broker 常驻
 *   node scripts/mqtt_ingest.cjs --broker        # 自托管 aedes broker（同时起 broker + 订阅摄入），适合 pm2 常驻
 *   node scripts/mqtt_ingest.cjs --selftest      # 不连 broker，直连 PG 写入一条并断言（CI/冒烟）
 *   node scripts/mqtt_ingest.cjs --brokertest    # 内嵌 aedes broker 做真实发布/订阅往返验证
 *
 * 环境变量：
 *   DATABASE_URL        PG 连接串（必填）
 *   MQTT_BROKER_URL     mqtt://host:port （默认 mqtt://127.0.0.1:1883，外部 broker 模式）
 *   MQTT_SELF_BROKER    设为 1 时自托管 broker（等效 --broker）
 *   MQTT_BROKER_PORT    自托管 broker 监听端口（默认 1883）
 *   MQTT_TOPIC          订阅主题（默认 clmx/+/+/telemetry）
 *   MQTT_CLIENT_ID      客户端 ID（默认 clmx-mqtt-ingest）
 *   MQTT_USERNAME / MQTT_PASSWORD   broker 鉴权（可选）
 */
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const PLAN_STORAGE_LIMIT = { TRIAL: 50, FREE: 1000000, PRO: 20000000, ENTERPRISE: 500000000 }

/** 套餐存储上限（与 server/src/modules/tenant/quota.ts 保持一致） */
async function incrementStorageUsed(tenantId, points) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) return
  const limit = PLAN_STORAGE_LIMIT[tenant.planType] || PLAN_STORAGE_LIMIT.FREE
  const next = (tenant.storageUsed || BigInt(0)) + BigInt(Math.max(0, points))
  if (next > BigInt(limit)) {
    throw new Error(`存储空间配额已用尽（套餐上限 ${limit} 个数据点）`)
  }
  await prisma.tenant.update({ where: { id: tenantId }, data: { storageUsed: next } })
}

/** 解析 MQTT 负载：支持 {sensorId,value} 或 {deviceCode,sensorChannel,value} */
function parsePayload(raw) {
  let obj
  if (typeof raw === 'object' && raw !== null) obj = raw
  else {
    try { obj = JSON.parse(raw) } catch { return null }
  }
  if (obj == null || typeof obj.value === 'undefined') return null
  const value = Number(obj.value)
  if (Number.isNaN(value)) return null
  return {
    sensorId: obj.sensorId,
    deviceCode: obj.deviceCode,
    sensorChannel: obj.sensorChannel,
    value,
    timestamp: obj.timestamp ? new Date(obj.timestamp) : new Date(),
    quality: obj.quality || 'GOOD',
  }
}

/** 写入单条（带租户隔离 + 配额） */
async function ingest(payload) {
  let sensor
  if (payload.sensorId) {
    sensor = await prisma.sensor.findUnique({ where: { id: payload.sensorId }, include: { device: true } })
  } else if (payload.deviceCode && payload.sensorChannel) {
    sensor = await prisma.sensor.findFirst({
      where: { channel: payload.sensorChannel, device: { code: payload.deviceCode } },
      include: { device: true },
    })
  }
  if (!sensor) {
    console.warn('[mqtt] 传感器未找到，跳过:', JSON.stringify(payload))
    return { ok: false, reason: 'sensor_not_found' }
  }
  const tenantId = sensor.device.tenantId
  await incrementStorageUsed(tenantId, 1)
  const row = await prisma.sensorData.create({
    data: {
      sensorId: sensor.id,
      tenantId,
      value: payload.value,
      quality: payload.quality,
      timestamp: payload.timestamp,
    },
  })
  return { ok: true, id: row.id, tenantId }
}

/** 让一个已连接的 mqtt client 订阅主题并摄入消息 */
function subscribeClient(client, topic) {
  client.subscribe(topic)
  client.on('message', async (t, message) => {
    const payload = parsePayload(message.toString())
    if (!payload) { console.warn('[mqtt] 无效负载:', message.toString().slice(0, 120)); return }
    try {
      const r = await ingest(payload)
      if (r.ok) console.log(`[mqtt] 写入 sensor=${payload.sensorId || (payload.deviceCode + '/' + payload.sensorChannel)} id=${r.id}`)
    } catch (e) {
      console.error('[mqtt] 写入失败:', e.message)
    }
  })
}

/** 自托管 aedes broker（--broker / MQTT_SELF_BROKER=1），单进程同时提供 MQTT 端点与摄入 */
async function startBroker() {
  let aedesMod
  try { aedesMod = require('aedes') } catch (e) {
    console.error('[broker] 未安装 aedes，自托管 broker 不可用（npm install aedes）')
    throw e
  }
  const Aedes = aedesMod.Aedes || aedesMod.default || aedesMod
  const broker = (Aedes.createBroker ? await Aedes.createBroker() : (typeof Aedes === 'function' ? new Aedes() : Aedes()))
  const net = require('net')
  const server = net.createServer(broker.handle)
  const port = parseInt(process.env.MQTT_BROKER_PORT || '1883', 10)
  await new Promise((res, rej) => server.listen(port, (e) => (e ? rej(e) : res())))
  console.log(`[broker] aedes MQTT broker 已启动，监听 :${port}`)
  return { broker, server, port }
}

async function start() {
  let mqtt
  try { mqtt = require('mqtt') } catch (e) {
    console.error('[mqtt] 未安装 mqtt 包，请先 npm install mqtt。仅 --selftest 可用。')
    process.exit(1)
  }
  const selfBroker = process.argv.includes('--broker') || process.env.MQTT_SELF_BROKER === '1'
  let brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://127.0.0.1:1883'
  if (selfBroker) {
    const { server, port } = await startBroker()
    global.__brokerServer = server // 保持进程存活
    brokerUrl = `mqtt://127.0.0.1:${port}`
  }
  const topic = process.env.MQTT_TOPIC || 'clmx/+/+/telemetry'
  const opts = { clientId: process.env.MQTT_CLIENT_ID || 'clmx-mqtt-ingest', reconnectPeriod: 5000 }
  if (process.env.MQTT_USERNAME) opts.username = process.env.MQTT_USERNAME
  if (process.env.MQTT_PASSWORD) opts.password = process.env.MQTT_PASSWORD

  const client = mqtt.connect(brokerUrl, opts)
  client.on('connect', () => {
    console.log(`[mqtt] 已连接 ${brokerUrl}，订阅 ${topic}`)
    subscribeClient(client, topic)
  })
  client.on('error', (e) => console.error('[mqtt] 错误:', e.message))
  client.on('close', () => console.log('[mqtt] 连接关闭，将自动重连'))
}

async function selftest() {
  console.log('[selftest] 直连 PG 验证摄入链路（不连 broker）...')
  const sensor = await prisma.sensor.findFirst({ include: { device: true }, orderBy: { createdAt: 'asc' } })
  if (!sensor) { console.error('[selftest] 无可用传感器，需先创建设备/传感器'); process.exit(2) }
  const before = await prisma.sensorData.count({ where: { sensorId: sensor.id } })
  const r = await ingest({ sensorId: sensor.id, value: 0.777, timestamp: new Date(), quality: 'GOOD' })
  const after = await prisma.sensorData.count({ where: { sensorId: sensor.id } })
  const ok = r.ok && after === before + 1
  console.log(`[selftest] sensor=${sensor.id} before=${before} after=${after} result=${JSON.stringify(r)}`)
  if (r.ok && r.id) { try { await prisma.sensorData.delete({ where: { id: r.id } }) } catch {} }
  console.log(ok ? '[selftest] PASS' : '[selftest] FAIL')
  await prisma.$disconnect()
  process.exit(ok ? 0 : 1)
}

async function brokertest() {
  console.log('[brokertest] 内嵌 aedes broker，验证 发布→订阅→写入 全链路...')
  let aedes, mqtt
  try {
    const aedesMod = require('aedes')
    const Aedes = aedesMod.Aedes || aedesMod.default || aedesMod
    if (Aedes.createBroker) aedes = await Aedes.createBroker()
    else if (typeof Aedes === 'function') aedes = new Aedes()
    else aedes = Aedes()
    mqtt = require('mqtt')
  } catch (e) {
    console.error('[brokertest] 需要 aedes + mqtt 包（npm install aedes mqtt）:', e.message)
    process.exit(1)
  }
  const net = require('net')
  const server = net.createServer(aedes.handle)
  await new Promise((res) => server.listen(0, res))
  const port = server.address().port
  const brokerUrl = `mqtt://127.0.0.1:${port}`
  const topic = 'clmx/+/+/telemetry'

  const sensor = await prisma.sensor.findFirst({ include: { device: true }, orderBy: { createdAt: 'asc' } })
  if (!sensor) { console.error('[brokertest] 无可用传感器'); process.exit(2) }
  const before = await prisma.sensorData.count({ where: { sensorId: sensor.id } })

  const client = mqtt.connect(brokerUrl)
  // 等订阅确认后再发布，避免 QoS0 竞态丢消息
  await new Promise((res, rej) => {
    client.on('connect', () => {
      subscribeClient(client, topic)
      client.subscribe(topic, async () => {
        // 模拟真实设备发布一条遥测（发布到具体主题，匹配 clmx/+/+/telemetry 通配订阅）
        const pubTopic = `clmx/${sensor.device.tenantId}/${sensor.device.code}/telemetry`
        client.publish(pubTopic, JSON.stringify({ sensorId: sensor.id, value: 1.234, quality: 'GOOD' }), { qos: 0 }, async () => {
          await new Promise((r) => setTimeout(r, 2000))
          const after = await prisma.sensorData.count({ where: { sensorId: sensor.id } })
          const ok = after === before + 1
          const last = await prisma.sensorData.findFirst({ where: { sensorId: sensor.id }, orderBy: { timestamp: 'desc' } })
          if (last) await prisma.sensorData.delete({ where: { id: last.id } })
          console.log(`[brokertest] sensor=${sensor.id} before=${before} after=${after} ok=${ok}`)
          console.log(ok ? '[brokertest] PASS' : '[brokertest] FAIL')
          client.end(true)
          aedes.close()
          server.close()
          await prisma.$disconnect()
          process.exit(ok ? 0 : 1)
        })
      })
    })
    client.on('error', rej)
  })
}

async function main() {
  if (process.argv.includes('--selftest')) await selftest()
  else if (process.argv.includes('--brokertest')) await brokertest()
  else await start()
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(2) })
}

module.exports = { parsePayload, ingest, subscribeClient, incrementStorageUsed }
