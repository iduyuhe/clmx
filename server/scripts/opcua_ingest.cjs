/**
 * CLMX 真实设备接入 — OPC-UA 摄入适配器（独立进程，可经 pm2 常驻）
 *
 * 与 mqtt_ingest.cjs 共享同一套「租户隔离 + 存储配额」摄入逻辑（复用其 ingest）。
 * 本适配器连接工业 OPC-UA 服务器，订阅已配置的节点（NodeId → SensorId 映射），
 * 在数值变化时写入 SensorData。
 *
 * 运行：
 *   node scripts/opcua_ingest.cjs                 # 连接外部 OPC-UA 服务器并常驻订阅
 *   node scripts/opcua_ingest.cjs --selftest      # 直连 PG 验证摄入链路（不连 OPC-UA）
 *   node scripts/opcua_ingest.cjs --mock          # 内置最小 OPC-UA 服务器做端到端验证
 *
 * 配置（环境变量）：
 *   DATABASE_URL        PG 连接串（必填）
 *   OPCUA_ENDPOINT      OPC-UA 服务器地址（默认 opc.tcp://127.0.0.1:4840）
 *   OPCUA_MAP           节点映射 JSON 数组，如 [{"nodeId":"ns=2;s=Temp","sensorId":"..."}]
 *   OPCUA_MAP_FILE      节点映射 JSON 文件路径（与 OPCUA_MAP 二选一；默认 ./opcua_map.json）
 *   OPCUA_USERNAME / OPCUA_PASSWORD  服务器鉴权（可选）
 *   OPCUA_PUBLISH_INTERVAL  订阅发布间隔 ms（默认 1000）
 */
require('dotenv').config()
const path = require('path')
const { ingest } = require('./mqtt_ingest.cjs')

const DEFAULT_MAP = { endpoint: 'opc.tcp://127.0.0.1:4840', map: [] }

/** 解析节点映射：优先 OPCUA_MAP（JSON 串），其次 OPCUA_MAP_FILE，再次默认文件 */
function loadMapping() {
  if (process.env.OPCUA_MAP) {
    try { return JSON.parse(process.env.OPCUA_MAP) } catch (e) { console.error('[opc] OPCUA_MAP 不是合法 JSON:', e.message); process.exit(1) }
  }
  const file = process.env.OPCUA_MAP_FILE || path.join(process.cwd(), 'opcua_map.json')
  try {
    const fs = require('fs')
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch (e) { console.warn('[opc] 读取映射文件失败，使用空映射:', e.message) }
  return []
}

/** 把 OPC-UA DataValue 转为摄入负载；非数值尝试转 Number */
function toPayload(sensorId, dataValue) {
  let value = dataValue?.value?.value
  if (typeof value !== 'number') {
    const n = Number(value)
    if (Number.isNaN(n)) return null
    value = n
  }
  return { sensorId, value, timestamp: dataValue?.sourceTimestamp ? new Date(dataValue.sourceTimestamp) : new Date(), quality: 'GOOD' }
}

async function connectAndSubscribe() {
  let opcua
  try { opcua = require('node-opcua') } catch (e) {
    console.error('[opc] 未安装 node-opcua，请先 npm install node-opcua。仅 --selftest 可用。')
    process.exit(1)
  }
  const { OPCUAClient, MessageSecurityMode, SecurityPolicy, AttributeIds, ClientSubscription, ClientMonitoredItem } = opcua

  const endpoint = process.env.OPCUA_ENDPOINT || DEFAULT_MAP.endpoint
  const mapping = loadMapping()
  if (!mapping.length) { console.error('[opc] 未配置任何节点映射（OPCUA_MAP / OPCUA_MAP_FILE），无订阅目标。'); process.exit(1) }

  const client = OPCUAClient.create({
    endpointMustExist: false,
    securityMode: MessageSecurityMode.None,
    securityPolicy: SecurityPolicy.None,
    connectionStrategy: { initialDelay: 1000, maxRetry: 10 },
  })
  const userIdentity = process.env.OPCUA_USERNAME
    ? { userName: process.env.OPCUA_USERNAME, password: process.env.OPCUA_PASSWORD || '' }
    : undefined

  client.on('connection_lost', () => console.warn('[opc] 连接丢失，将自动重连'))
  client.on('backoff', (n, d) => console.warn(`[opc] 重连退避 ${n} (${d}ms)`))

  await client.connect(endpoint)
  console.log(`[opc] 已连接 ${endpoint}`)
  const session = await client.createSession(userIdentity)
  console.log('[opc] 会话已建立')

  const subscription = ClientSubscription.create(session, {
    requestedPublishingInterval: +(process.env.OPCUA_PUBLISH_INTERVAL || 1000),
    requestedMaxKeepAliveCount: 20,
  })
  subscription.on('started', () => console.log(`[opc] 订阅已启动（id=${subscription.subscriptionId}）`))
  subscription.on('terminated', () => console.warn('[opc] 订阅已终止'))

  for (const m of mapping) {
    if (!m.nodeId || !m.sensorId) { console.warn('[opc] 跳过无效映射:', JSON.stringify(m)); continue }
    const item = ClientMonitoredItem.create(
      subscription,
      { nodeId: m.nodeId, attributeId: AttributeIds.Value },
      { samplingInterval: 500, discardOldest: true, queueSize: 10 },
    )
    item.on('changed', async (dataValue) => {
      const payload = toPayload(m.sensorId, dataValue)
      if (!payload) { console.warn('[opc] 非数值负载，跳过 nodeId=', m.nodeId); return }
      try {
        const r = await ingest(payload)
        if (r.ok) console.log(`[opc] 写入 sensor=${m.sensorId} value=${payload.value}`)
      } catch (e) {
        console.error('[opc] 写入失败 nodeId=', m.nodeId, e.message)
      }
    })
    console.log(`[opc] 订阅节点 ${m.nodeId} → sensor ${m.sensorId}`)
  }

  // 保持进程存活
  process.on('SIGINT', async () => { try { await session.close(); await client.disconnect() } catch {} process.exit(0) })
}

async function selftest() {
  console.log('[selftest] 直连 PG 验证 OPC-UA 摄入链路（不连 OPC-UA 服务器）...')
  const prisma = require('@prisma/client').PrismaClient ? new (require('@prisma/client').PrismaClient)() : null
  const P = require('@prisma/client').PrismaClient
  const p = new P()
  const sensor = await p.sensor.findFirst({ include: { device: true }, orderBy: { createdAt: 'asc' } })
  if (!sensor) { console.error('[selftest] 无可用传感器，需先创建设备/传感器'); process.exit(2) }
  const before = await p.sensorData.count({ where: { sensorId: sensor.id } })
  const r = await ingest({ sensorId: sensor.id, value: 11.5, timestamp: new Date(), quality: 'GOOD' })
  const after = await p.sensorData.count({ where: { sensorId: sensor.id } })
  const ok = r.ok && after === before + 1
  console.log(`[selftest] sensor=${sensor.id} before=${before} after=${after} result=${JSON.stringify(r)}`)
  if (r.ok && r.id) { try { await p.sensorData.delete({ where: { id: r.id } }) } catch {} }
  console.log(ok ? '[selftest] PASS' : '[selftest] FAIL')
  await p.$disconnect()
  process.exit(ok ? 0 : 1)
}

/** 内置最小 OPC-UA 服务器 + 客户端，做端到端验证（需 node-opcua） */
async function mock() {
  let opcua
  try { opcua = require('node-opcua') } catch (e) { console.error('[mock] 需要 node-opcua（npm install node-opcua）:', e.message); process.exit(1) }
  const { OPCUAServer, OPCUAClient, MessageSecurityMode, SecurityPolicy, AttributeIds, DataType, Variant, ClientSubscription, ClientMonitoredItem, coerceNodeId } = opcua

  const prisma = require('@prisma/client')
  const p = new prisma.PrismaClient()
  const sensor = await p.sensor.findFirst({ include: { device: true }, orderBy: { createdAt: 'asc' } })
  if (!sensor) { console.error('[mock] 无可用传感器'); process.exit(2) }
  const nodeId = 'ns=2;s=MockSensor'
  const sensorId = sensor.id

  const server = new OPCUAServer({ port: 4841 })
  await server.initialize()
  const addressSpace = server.engine.addressSpace
  const ns = addressSpace.getOwnNamespace()
  const folder = ns.addFolder(addressSpace.rootFolder.objects, { browseName: 'CLMX' })
  let mockValue = 42.0
  ns.addVariable({
    componentOf: folder,
    browseName: 'MockSensor',
    nodeId,
    dataType: 'Double',
    value: { get: () => new Variant({ dataType: DataType.Double, value: mockValue }) },
  })
  await server.start()
  console.log('[mock] 内置 OPC-UA 服务器已启动 opc.tcp://127.0.0.1:4841')

  const client = OPCUAClient.create({ endpointMustExist: false, securityMode: MessageSecurityMode.None, securityPolicy: SecurityPolicy.None })
  await client.connect('opc.tcp://127.0.0.1:4841')
  const session = await client.createSession()
  const subscription = ClientSubscription.create(session, { requestedPublishingInterval: 500 })
  const before = await p.sensorData.count({ where: { sensorId } })
  const item = ClientMonitoredItem.create(subscription, { nodeId: coerceNodeId(nodeId), attributeId: AttributeIds.Value }, { samplingInterval: 200, discardOldest: true, queueSize: 5 })

  const got = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 8000)
    item.on('changed', async (dv) => {
      const payload = toPayload(sensorId, dv)
      if (!payload) return resolve(false)
      try {
        const r = await ingest(payload)
        const after = await p.sensorData.count({ where: { sensorId } })
        clearTimeout(timer)
        resolve(r.ok && after === before + 1)
        if (r.ok && r.id) { try { await p.sensorData.delete({ where: { id: r.id } }) } catch {} }
      } catch (e) { clearTimeout(timer); resolve(false) }
    })
    // 触发一次数值变化
    setTimeout(() => { mockValue = 77.7 }, 600)
  })
  console.log(`[mock] OPC-UA → 摄入 结果=${got}`)
  console.log(got ? '[mock] PASS' : '[mock] FAIL')
  try { await session.close(); await client.disconnect(); await server.shutdown() } catch {}
  await p.$disconnect()
  process.exit(got ? 0 : 1)
}

async function main() {
  if (process.argv.includes('--selftest')) await selftest()
  else if (process.argv.includes('--mock')) await mock()
  else await connectAndSubscribe()
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(2) })
}

module.exports = { toPayload, loadMapping, connectAndSubscribe }
