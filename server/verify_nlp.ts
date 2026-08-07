import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const BASE = 'http://127.0.0.1:3002'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  // 1. 登录
  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@test.com', password: '123456' }),
  }).then((r) => r.json())
  const token: string = login.data.token
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
  console.log('[1] login token len =', token.length)

  // 2. 生成演示数据（会写出真实 jsonl 训练文件）
  const gen = await fetch(BASE + '/api/demo-data/generate', {
    method: 'POST', headers, body: JSON.stringify({ scale: 'medium' }),
  }).then((r) => r.json())
  console.log('[2] demo generate ->', gen.data?.nlpSamples ?? gen.message)

  // 3. 创建一个 NLP 模型
  const tenant = await prisma.tenant.findFirst()
  const model = await prisma.aiModel.create({
    data: { tenantId: tenant!.id, name: 'DEMO-情感分类器', domain: 'NLP',
      baseModel: 'text_classification',
      status: 'DRAFT', description: 'verify' },
  })
  console.log('[3] aiModel =', model.id)

  // 4. 找到 demo 数据集版本
  const ds = await prisma.dataset.findFirst({
    where: { name: { startsWith: 'DEMO-情感分析' } }, include: { versions: true },
  })
  if (!ds || !ds.versions.length) throw new Error('demo NLP dataset/version 不存在')
  const dvId = ds.versions[0].id
  console.log('[4] datasetVersion =', dvId, 'filePath =', ds.versions[0].filePath)

  // 5. 创建训练任务（中文文本分类）
  const tj = await fetch(BASE + '/api/training', {
    method: 'POST', headers,
    body: JSON.stringify({ modelId: model.id, datasetVersionId: dvId,
      hyperparams: { modelType: 'text_classification', dataType: 'text' } }),
  }).then((r) => r.json())
  const jobId: string = tj.data.id
  console.log('[5] training job =', jobId, '->', tj.message)

  // 6. 轮询训练状态
  let status = 'QUEUED'
  for (let i = 0; i < 90; i++) {
    const j = await fetch(BASE + '/api/training/' + jobId, { headers }).then((r) => r.json())
    status = j.data.status
    const lp = j.data.liveProgress
    process.stdout.write(`\r[6] status=${status} progress=${lp?.progress ?? ''} loss=${lp?.loss ?? ''}`)
    if (status === 'COMPLETED' || status === 'FAILED') break
    await sleep(2000)
  }
  console.log('\n[6] final status =', status)
  if (status !== 'COMPLETED') { console.error('训练未成功完成'); process.exit(1) }

  // 7. 读取训练出的模型版本
  const mv = await prisma.modelVersion.findFirst({
    where: { modelId: model.id, status: 'TRAINED' }, orderBy: { createdAt: 'desc' },
  })
  if (!mv) throw new Error('未找到 TRAINED 模型版本')
  console.log('[7] modelVersion =', mv.id, 'checkpoint =', mv.checkpointPath)

  // 8. 用训练出的模型做推理（纯 JS，不联网）
  const inf = await fetch(BASE + '/api/inference/text-classification', {
    method: 'POST', headers,
    body: JSON.stringify({
      modelVersionId: mv.id,
      texts: ['这家公司服务态度特别好，工程师很专业，非常推荐',
        '质量太差了，没用几天就坏了，后悔购买',
        '设备运行稳定，噪音很小'],
    }),
  }).then((r) => r.json())
  if (!inf.success) throw new Error('推理失败: ' + JSON.stringify(inf))
  console.log('[8] 推理结果:')
  for (const r of inf.data.results) {
    console.log(`    文本: ${r.text}\n    -> 预测: ${r.label}  概率: ${JSON.stringify(r.probabilities)}`)
  }

  // 9. 清理验证产物
  await prisma.aiModel.delete({ where: { id: model.id } }).catch(() => {})
  console.log('\n[done] NLP 训推闭环验证通过')
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
