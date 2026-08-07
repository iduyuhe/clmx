/* 线上端到端验证：在服务器上用已部署的 dist 代码跑完整 stage2 管线。
   创建测试租户/设备/传感器/时序数据/工业模型 -> 触发训练(服务端 python worker) ->
   轮询 COMPLETED -> 断言 ModelVersion.dataType=timeseries -> 推理正常/异常窗 ->
   混合评分 -> 清理测试数据。
   运行：cd /opt/clmx/server && node e2e_online.cjs */
require('dotenv').config()
const { prisma } = require('./dist/utils/prisma')
const { startTrainingJob } = require('./dist/modules/training/training.service')
const { runTimeseriesInference } = require('./dist/modules/inference/inference.service')
const { computeModelScore, hybridScore, computeRuleScore } = require('./dist/modules/health/scorer')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const slug = 'e2e-online-' + Date.now()
  const tenant = await prisma.tenant.create({ data: { name: 'E2E在线', slug, status: 'ACTIVE' } })
  const device = await prisma.device.create({
    data: { tenantId: tenant.id, name: 'E2E泵机', code: 'PUMP-E2E', category: 'PUMP', status: 'ACTIVE' },
  })
  const sensor = await prisma.sensor.create({
    data: { deviceId: device.id, name: '振动', channel: 'CH1', unit: 'mm/s', status: 'ACTIVE', samplingRate: 1, minThreshold: 0, maxThreshold: 100 },
  })
  const now = Date.now()
  const batch = []
  for (let i = 0; i < 300; i++) {
    batch.push({ sensorId: sensor.id, value: 50 + (Math.random() * 2 - 1) * 4, timestamp: new Date(now + i * 60000), quality: 'GOOD' })
  }
  await prisma.sensorData.createMany({ data: batch })

  const model = await prisma.aiModel.create({
    data: { tenantId: tenant.id, name: '振动异常检测', baseModel: 'timeseries', domain: 'INDUSTRIAL', status: 'DRAFT', industry: '工业', scenario: '设备预防性维修' },
  })
  const job = await prisma.trainingJob.create({
    data: {
      modelId: model.id,
      datasetVersionId: null,
      hyperparams: JSON.stringify({ dataType: 'timeseries', sensorId: sensor.id, windowSize: 24, step: 12 }),
      status: 'QUEUED',
    },
  })

  console.log('[1] 启动训练', job.id)
  await startTrainingJob(job.id)

  let status = 'RUNNING'
  for (let i = 0; i < 60; i++) {
    await sleep(2000)
    const j = await prisma.trainingJob.findUnique({ where: { id: job.id } })
    status = j.status
    if (i % 5 === 0) console.log('   轮询', i, '状态=', status)
    if (status === 'COMPLETED' || status === 'FAILED') break
  }
  if (status !== 'COMPLETED') throw new Error('训练未完成: ' + status)

  const mv = await prisma.modelVersion.findFirst({ where: { modelId: model.id, trainingJobId: job.id } })
  console.log('[2] ModelVersion dataType =', mv.dataType, '| checkpoint =', mv.checkpointPath)
  if (mv.dataType !== 'timeseries') throw new Error('dataType != timeseries')

  const normalWin = Array.from({ length: 24 }, () => 50 + (Math.random() * 2 - 1) * 4)
  const anomalyWin = Array.from({ length: 24 }, (_, k) => (k === 12 ? 95 : 50 + (Math.random() * 2 - 1) * 4))
  const inf = await runTimeseriesInference({ modelVersionId: mv.id, tenantId: tenant.id, windows: [normalWin, anomalyWin] })
  console.log('[3] 推理结果:', JSON.stringify(inf.results.map((r) => ({ score: +r.score.toFixed(3), isAnomaly: r.isAnomaly, severity: r.severity }))))
  if (inf.results[0].severity !== 'NORMAL') throw new Error('正常窗未被判为 NORMAL')
  if (inf.results[1].severity !== 'CRITICAL') throw new Error('异常窗未被判为 CRITICAL')

  const dev = await prisma.device.findUnique({ where: { id: device.id }, include: { sensors: true } })
  const rule = await computeRuleScore(dev)
  const modelInfo = await computeModelScore(tenant.id, dev, mv.id)
  const hybrid = hybridScore(rule.score, modelInfo ? modelInfo.score : null)
  console.log('[4] 规则分', rule.score, '| 模型分', modelInfo && modelInfo.score, '| 混合分', hybrid.score, '| 异常窗口数', modelInfo && modelInfo.anomalyWindows)

  console.log('RESULT: PASS')

  // 清理
  await prisma.sensorData.deleteMany({ where: { sensorId: sensor.id } })
  await prisma.trainingLog.deleteMany({ where: { trainingJobId: job.id } })
  await prisma.modelVersion.deleteMany({ where: { modelId: model.id } })
  await prisma.trainingJob.deleteMany({ where: { id: job.id } })
  await prisma.sensor.deleteMany({ where: { id: sensor.id } })
  await prisma.device.deleteMany({ where: { id: device.id } })
  await prisma.aiModel.deleteMany({ where: { id: model.id } })
  await prisma.tenant.deleteMany({ where: { id: tenant.id } })
  console.log('[cleanup] 测试数据已清除')
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('RESULT: FAIL', e && e.message)
  try { await prisma.$disconnect() } catch (_) {}
  process.exit(1)
})
