/**
 * AI 原生接入生成器 + 能力资产化治理（HubPort 思想融合 · 阶段5 / 阶段7）
 *
 * 与既有遥测摄入端点（ingest.routes.ts 的 /telemetry）共存于 /api/ingest，互不冲突。
 *
 * 阶段5（生成）：specs 提交接入需求 → generate 产出物模型+零依赖驱动 → selftest 自测 → run 运行时零AI执行
 * 阶段7（资产化）：publish 进入资产市场 → apply 一键复用他人已验证资产（自动建传感器）→ reuseCount 度量资产厚度
 *
 * 思想红线：LLM 仅生成时使用（可关闭、零依赖运行）；运行时驱动纯 JS 确定性执行。
 */
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { prisma } from '../../utils/prisma'
import { authMiddleware, requireRole, AuthRequest } from '../../middleware/auth.middleware'
import { asyncHandler } from '../../utils/asyncHandler'
import { incrementStorageUsed, QuotaExceededError } from '../tenant/quota'
import logger from '../../utils/logger'
import { config } from '../../utils/config'
import { generateFromSpec, type IngestPoint } from './generator'
import { runSelfTest } from './selfTest'

const router = Router()

function tenantFilter(tenantId: string | undefined) {
  // 预置/市场资产 tenantId=null；查询时兼容「本租户 + 公共」
  return { OR: [{ tenantId }, { tenantId: null }] }
}

// ─── 生成核心（被 POST 与 SSE 复用） ───────────────────────────
async function doGenerate(specId: string, tenantId: string | undefined, userId?: string) {
  const spec = await prisma.ingestSpec.findFirst({ where: { id: specId, ...tenantFilter(tenantId) } })
  if (!spec) throw Object.assign(new Error('接入需求不存在或无权限'), { status: 404 })

  const gen = await generateFromSpec({
    name: spec.name,
    description: spec.description,
    sourceType: spec.sourceType,
    sourceUrl: spec.sourceUrl,
    rawSpec: spec.rawSpec,
    sampleData: spec.rawSpec, // 复用 rawSpec 作为样本候选
  })

  const selfTest = runSelfTest({ driverCode: gen.driverCode, thingModel: gen.thingModel, sampleData: spec.rawSpec })

  // 版本链：取该 spec 现有最大版本 +1
  const last = await prisma.ingestAsset.findFirst({
    where: { specId: spec.id },
    orderBy: { version: 'desc' },
  })
  const version = (last?.version || 0) + 1
  const asset = await prisma.ingestAsset.create({
    data: {
      tenantId,
      specId: spec.id,
      version,
      thingModel: JSON.stringify(gen.thingModel),
      driverCode: gen.driverCode,
      sampleData: spec.rawSpec || null,
      selfTestResult: JSON.stringify(selfTest),
      status: selfTest.passed ? 'verified' : 'generated',
    },
  })
  await prisma.ingestSpec.update({ where: { id: spec.id }, data: { status: 'generated' } })
  return { asset, gen, selfTest }
}

// ─── 创建接入需求 ──────────────────────────────────────────────
router.post(
  '/specs',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    const { name, description, sourceType, sourceUrl, rawSpec } = req.body || {}
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ success: false, message: 'name 必填' })
    }
    const spec = await prisma.ingestSpec.create({
      data: {
        tenantId: req.tenantId,
        name,
        description: description || '',
        sourceType: sourceType || 'http',
        sourceUrl: sourceUrl || null,
        rawSpec: rawSpec || '',
        createdBy: req.userId,
      },
    })
    res.json({ success: true, data: spec })
  }),
)

// ─── 我的接入需求列表 ─────────────────────────────────────────
router.get(
  '/specs',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    const specs = await prisma.ingestSpec.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { createdAt: 'desc' },
      include: { assets: { orderBy: { version: 'desc' }, take: 1 } },
    })
    res.json({ success: true, data: specs })
  }),
)

// ─── 接入需求详情（含全部版本资产） ───────────────────────────
router.get(
  '/specs/:id',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    const spec = await prisma.ingestSpec.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
      include: { assets: { orderBy: { version: 'desc' } } },
    })
    if (!spec) return res.status(404).json({ success: false, message: '接入需求不存在' })
    res.json({ success: true, data: spec })
  }),
)

// ─── 生成（同步，主路径，前端按钮调用） ───────────────────────
router.post(
  '/specs/:id/generate',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    const { asset, gen, selfTest } = await doGenerate(req.params.id, req.tenantId, req.userId)
    res.json({
      success: true,
      data: {
        asset,
        from: gen.from,
        points: gen.points,
        notes: gen.notes,
        selfTest,
      },
    })
  }),
)

// ─── 生成（SSE 流式，实时可见生成过程） ───────────────────────
// EventSource 不支持自定义 header，token 经 ?token= 传入
router.get('/specs/:id/generate/stream', asyncHandler(async (req, res) => {
  const token = (req.query.token as string) || ''
  let decoded: any
  try {
    decoded = jwt.verify(token, config.jwtSecret)
  } catch {
    return res.status(401).json({ success: false, message: '无效 token' })
  }
  const tenantId = decoded.tenantId as string | undefined
  const userId = decoded.userId as string | undefined

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  const send = (step: string, payload: unknown) =>
    res.write(`event: ${step}\ndata: ${JSON.stringify(payload)}\n\n`)

  try {
    send('start', { message: '开始解析接入需求…' })
    const spec = await prisma.ingestSpec.findFirst({ where: { id: req.params.id, ...tenantFilter(tenantId) } })
    if (!spec) return send('error', { message: '接入需求不存在或无权限' })
    await new Promise((r) => setTimeout(r, 150))
    send('parsing', { sourceType: spec.sourceType, message: '提取测点（规则/启发式/可选LLM）…' })
    await new Promise((r) => setTimeout(r, 250))
    const { asset, gen, selfTest } = await doGenerate(req.params.id, tenantId, userId)
    send('model', { points: gen.points, from: gen.from, message: `生成物模型：${gen.points.length} 个测点` })
    await new Promise((r) => setTimeout(r, 200))
    send('driver', { message: '生成零依赖采集驱动 collect()…' })
    await new Promise((r) => setTimeout(r, 200))
    send('selftest', { passed: selfTest.passed, readings: selfTest.readings, message: selfTest.passed ? '自测通过' : '自测未完全通过' })
    send('done', { assetId: asset.id, version: asset.version, message: '生成完成，资产已保存' })
  } catch (e: any) {
    send('error', { message: e?.message || '生成失败' })
  } finally {
    res.end()
  }
}))

// ─── 资产自测（可重复跑） ─────────────────────────────────────
router.post(
  '/assets/:id/selftest',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    const asset = await prisma.ingestAsset.findFirst({ where: { id: req.params.id, ...tenantFilter(req.tenantId) } })
    if (!asset) return res.status(404).json({ success: false, message: '资产不存在' })
    const thingModel = JSON.parse(asset.thingModel || '[]') as IngestPoint[]
    const selfTest = runSelfTest({ driverCode: asset.driverCode, thingModel, sampleData: asset.sampleData })
    await prisma.ingestAsset.update({
      where: { id: asset.id },
      data: { selfTestResult: JSON.stringify(selfTest), status: selfTest.passed ? 'verified' : 'generated' },
    })
    res.json({ success: true, data: selfTest })
  }),
)

// ─── 运行时零 AI 执行驱动（可选写入 SensorData） ───────────────
router.post(
  '/assets/:id/run',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    const asset = await prisma.ingestAsset.findFirst({ where: { id: req.params.id, ...tenantFilter(req.tenantId) } })
    if (!asset) return res.status(404).json({ success: false, message: '资产不存在' })
    const thingModel = JSON.parse(asset.thingModel || '[]') as IngestPoint[]
    const { deviceId, payload } = req.body || {}
    const sourcePayload = payload ?? (asset.sampleData ? safeParse(asset.sampleData) : undefined) ?? {}

    let collect: (ctx: any) => any
    try {
      // eslint-disable-next-line no-new-func
      collect = new Function('ctx', `${asset.driverCode}\n return collect(ctx);`) as any
    } catch (e: any) {
      return res.status(400).json({ success: false, message: '驱动编译失败：' + (e as Error).message })
    }
    let readings: any[]
    try {
      readings = collect({ payload: sourcePayload, now: Date.now() })
    } catch (e: any) {
      return res.status(400).json({ success: false, message: '驱动执行失败：' + (e as Error).message })
    }

    let written = 0
    if (deviceId) {
      const device = await prisma.device.findFirst({ where: { id: deviceId, tenantId: req.tenantId } })
      if (!device) return res.status(404).json({ success: false, message: '设备不存在或无权限' })
      const sensors = await prisma.sensor.findMany({ where: { deviceId } })
      const byChannel = new Map(sensors.map((s) => [s.channel, s]))
      for (const r of readings) {
        const sensor = byChannel.get(r.key)
        if (!sensor) continue
        try {
          await incrementStorageUsed(req.tenantId!, 1)
          await prisma.sensorData.create({
            data: { sensorId: sensor.id, tenantId: req.tenantId, value: Number(r.value), quality: 'GOOD' },
          })
          written++
        } catch (e) {
          if (e instanceof QuotaExceededError) {
            /* 配额上限，停止写入 */
            break
          }
          logger.warn('run 写入 SensorData 失败: ' + (e as Error).message)
        }
      }
    }
    res.json({ success: true, data: { readings, written, deviceId: deviceId || null } })
  }),
)

// ─── 发布为资产（进入市场，可跨租户复用） ─────────────────────
router.post(
  '/assets/:id/publish',
  authMiddleware,
  requireRole('MANAGER'),
  asyncHandler(async (req: AuthRequest, res) => {
    const asset = await prisma.ingestAsset.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } })
    if (!asset) return res.status(404).json({ success: false, message: '资产不存在或不属于本租户' })
    const updated = await prisma.ingestAsset.update({
      where: { id: asset.id },
      data: { published: true, status: 'published' },
    })
    await prisma.ingestSpec.update({ where: { id: asset.specId }, data: { status: 'published' } })
    res.json({ success: true, data: updated })
  }),
)

// ─── 下线/废弃资产 ────────────────────────────────────────────
router.post(
  '/assets/:id/deprecate',
  authMiddleware,
  requireRole('MANAGER'),
  asyncHandler(async (req: AuthRequest, res) => {
    const asset = await prisma.ingestAsset.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } })
    if (!asset) return res.status(404).json({ success: false, message: '资产不存在或不属于本租户' })
    const updated = await prisma.ingestAsset.update({
      where: { id: asset.id },
      data: { published: false, status: 'deprecated' },
    })
    res.json({ success: true, data: updated })
  }),
)

// ─── 资产市场（已发布的跨租户资产） ───────────────────────────
router.get(
  '/assets',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    const marketplace = req.query.marketplace === '1'
    const where = marketplace
      ? { published: true, status: 'published' }
      : tenantFilter(req.tenantId)
    const assets = await prisma.ingestAsset.findMany({
      where,
      orderBy: [{ reuseCount: 'desc' }, { createdAt: 'desc' }],
      include: { spec: { select: { name: true, sourceType: true, description: true } } },
    })
    res.json({ success: true, data: assets })
  }),
)

// ─── 一键复用他人已验证资产（自动在目标设备建传感器） ──────────
router.post(
  '/assets/:id/apply',
  authMiddleware,
  requireRole('MANAGER'),
  asyncHandler(async (req: AuthRequest, res) => {
    const { deviceId } = req.body || {}
    if (!deviceId) return res.status(400).json({ success: false, message: 'deviceId 必填' })
    const asset = await prisma.ingestAsset.findFirst({ where: { id: req.params.id, ...tenantFilter(req.tenantId) } })
    if (!asset) return res.status(404).json({ success: false, message: '资产不存在' })
    const device = await prisma.device.findFirst({ where: { id: deviceId, tenantId: req.tenantId } })
    if (!device) return res.status(404).json({ success: false, message: '目标设备不存在或无权限' })

    const points = JSON.parse(asset.thingModel || '[]') as IngestPoint[]
    const created: string[] = []
    for (const p of points) {
      const existing = await prisma.sensor.findFirst({ where: { deviceId, channel: p.key } })
      if (existing) {
        await prisma.sensor.update({ where: { id: existing.id }, data: { name: p.name, unit: p.unit, status: 'ACTIVE' } })
      } else {
        await prisma.sensor.create({
          data: { tenantId: req.tenantId, deviceId, name: p.name, channel: p.key, unit: p.unit, status: 'ACTIVE' },
        })
      }
      created.push(p.key)
    }
    await prisma.ingestAsset.update({ where: { id: asset.id }, data: { reuseCount: { increment: 1 } } })
    res.json({ success: true, data: { deviceId, sensors: created, count: created.length } })
  }),
)

function safeParse(s: string): any {
  try {
    return JSON.parse(s)
  } catch {
    return {}
  }
}

export default router
