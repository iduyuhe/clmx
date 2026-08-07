/**
 * CLMX MQTT 常驻验证 —— 对线上已运行的 broker 发布一条遥测，断言写入 SensorData。
 *
 * 用法：
 *   node scripts/mqtt_pubtest.cjs
 *
 * 前置：
 *   - 常驻进程 clmx-mqtt 已在运行（见 deploy/run_mqtt_deploy.py）
 *   - DATABASE_URL 指向同一 PG（dotenv 读 cwd/.env）
 *   - MQTT_BROKER_URL 默认 mqtt://127.0.0.1:1883
 *
 * 逻辑：取一条现有 sensor → 记录 count → 发布到 clmx/<tenantId>/<deviceCode>/telemetry
 *      → 等待 2s → 断言 count+1 → 删除测试行。
 */
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  let mqtt
  try { mqtt = require('mqtt') } catch (e) {
    console.error('[pubtest] 未安装 mqtt 包'); process.exit(1)
  }
  const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://127.0.0.1:1883'
  const topic = 'clmx/+/+/telemetry'

  const sensor = await prisma.sensor.findFirst({ include: { device: true }, orderBy: { createdAt: 'asc' } })
  if (!sensor) { console.error('[pubtest] 无可用传感器，请先创建设备/传感器'); process.exit(2) }

  const before = await prisma.sensorData.count({ where: { sensorId: sensor.id } })
  const client = mqtt.connect(brokerUrl)
  await new Promise((res, rej) => {
    client.on('connect', () => {
      client.subscribe(topic, () => {
        const pub = `clmx/${sensor.device.tenantId}/${sensor.device.code}/telemetry`
        client.publish(pub, JSON.stringify({ sensorId: sensor.id, value: Math.random() * 10, quality: 'GOOD' }), { qos: 0 }, async () => {
          await new Promise((r) => setTimeout(r, 2000))
          const after = await prisma.sensorData.count({ where: { sensorId: sensor.id } })
          const ok = after === before + 1
          const last = await prisma.sensorData.findFirst({ where: { sensorId: sensor.id }, orderBy: { timestamp: 'desc' } })
          if (last) { try { await prisma.sensorData.delete({ where: { id: last.id } }) } catch {} }
          console.log(`[pubtest] sensor=${sensor.id} tenant=${sensor.device.tenantId} before=${before} after=${after} ok=${ok}`)
          console.log(ok ? '[pubtest] PASS' : '[pubtest] FAIL')
          client.end(true)
          await prisma.$disconnect()
          process.exit(ok ? 0 : 1)
        })
      })
    })
    client.on('error', rej)
  })
}

main().catch((e) => { console.error(e); process.exit(2) })
