import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'

const DB_FILE = 'e2e_verify.db'
const DB_PATH = path.resolve(__dirname, '../prisma', DB_FILE)
process.env.DATABASE_URL = 'file:' + DB_PATH.replace(/\\/g, '/')
process.env.PYTHON_PATH = 'C:/Users/Administrator/.workbuddy/binaries/python/versions/3.13.12/python.exe'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function main() {
  // 1) 临时库 schema 同步（每次清空重建，保证可重复）
  fs.rmSync(DB_PATH, { force: true })
  console.log('[1] prisma db push (临时库) ...')
  execSync('npx prisma db push --skip-generate --accept-data-loss', { stdio: 'inherit', env: process.env })

  const { prisma } = await import('../src/utils/prisma')
  const { startTrainingJob } = await import('../src/modules/training/training.service')
  const { runTimeseriesInference } = await import('../src/modules/inference/inference.service')
  const { computeModelScore, hybridScore, computeRuleScore } = await import('../src/modules/health/scorer')

  // 2) 种子：租户 / 设备 / 传感器 / 时序数据 / 工业模型
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'e2e' },
    update: {},
    create: { name: 'E2E租户', slug: 'e2e', status: 'ACTIVE' },
  })
  const device = await prisma.device.create({
    data: { tenantId: tenant.id, name: 'E2E泵机', code: 'PUMP-01', category: 'PUMP', status: 'ACTIVE' },
  })
  const sensor = await prisma.sensor.create({
    data: {
      deviceId: device.id, name: '振动', channel: 'CH1',
      unit: 'mm/s', status: 'ACTIVE', samplingRate: 1, minThreshold: 0, maxThreshold: 100,
    },
  })

  const now = Date.now()
  const batch: Array<{ sensorId: string; value: number; timestamp: Date; quality: string }> = []
  for (let i = 0; i < 300; i++) {
    // 纯正常波动（小噪声）：让模型学到正常轮廓，异常样本留给推理阶段验证
    batch.push({ sensorId: sensor.id, value: 50 + (Math.random() * 2 - 1) * 4, timestamp: new Date(now + i * 60000), quality: 'GOOD' })
  }
  await prisma.sensorData.createMany({ data: batch })

  const model = await prisma.aiModel.create({
    data: {
      tenantId: tenant.id, name: '振动异常检测', baseModel: 'timeseries',
      domain: 'INDUSTRIAL', status: 'DRAFT', industry: '工业', scenario: '设备预防性维修',
    },
  })

  // 3) 创建时序训练任务并启动
  const job = await prisma.trainingJob.create({
    data: {
      modelId: model.id,
      datasetVersionId: null,
      hyperparams: JSON.stringify({ dataType: 'timeseries', sensorId: sensor.id, windowSize: 24, step: 12 }),
      status: 'QUEUED',
    },
  })
  console.log('[2] 启动时序训练 job', job.id)
  startTrainingJob(job.id).catch(e => console.error('训练启动异常:', e))

  // 4) 轮询训练完成
  let final: any = null
  for (let i = 0; i < 45; i++) {
    await sleep(1000)
    const j = await prisma.trainingJob.findUnique({ where: { id: job.id } })
    if (j && (j.status === 'COMPLETED' || j.status === 'FAILED')) { final = j; break }
  }
  console.log('[3] 训练状态:', final?.status, 'lossHistory:', final?.lossHistory)
  if (final?.status !== 'COMPLETED') {
    console.log('RESULT: FAIL (训练未成功)')
    await prisma.$disconnect()
    return
  }

  // 5) 读取自动创建的模型版本
  const mv = await prisma.modelVersion.findFirst({ where: { modelId: model.id }, orderBy: { createdAt: 'desc' } })
  console.log('[4] ModelVersion:', mv?.id, '| dataType:', mv?.dataType, '| checkpoint:', mv?.checkpointPath)
  if (!mv) { console.log('RESULT: FAIL (无模型版本)'); await prisma.$disconnect(); return }

  // 6) 推理验证：正常窗口 vs 异常窗口
  const normalWindow = Array.from({ length: 24 }, () => 50 + (Math.random() * 2 - 1) * 3)
  const abnormalWindow = Array.from({ length: 24 }, (_, i) => (i === 10 ? 200 : 50 + (Math.random() * 2 - 1) * 3))
  const inf = await runTimeseriesInference({ modelVersionId: mv.id, tenantId: tenant.id, windows: [normalWindow, abnormalWindow] })
  console.log('[5] 推理结果:', JSON.stringify(inf.results))

  // 7) 健康混合分
  const deviceFull = await prisma.device.findFirst({ where: { id: device.id }, include: { sensors: true } })
  const rule = await computeRuleScore(deviceFull!)
  const modelScore = await computeModelScore(tenant.id, deviceFull!, mv.id)
  const hybrid = hybridScore(rule.score, modelScore ? modelScore.score : null)
  console.log('[6] 规则分:', rule.score, '| 模型分:', modelScore?.score, '| 混合分:', hybrid.score)

  const infOk = inf.results[0].isAnomaly === false && inf.results[1].isAnomaly === true
  const hybridHasModel = hybrid.modelScore !== null
  const modelVersionDataTypeOk = mv.dataType === 'timeseries'
  console.log('\n推理: 正常窗非异常 & 异常窗为异常 =', infOk)
  console.log('健康: 混合分含模型分 =', hybridHasModel)
  console.log('模型版本 dataType =', modelVersionDataTypeOk)
  console.log('RESULT:', (infOk && hybridHasModel && modelVersionDataTypeOk) ? 'PASS' : 'FAIL')

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
