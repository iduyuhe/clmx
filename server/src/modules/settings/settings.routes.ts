import { Router } from 'express'
import { prisma } from '../../utils/prisma'
import { authMiddleware, requireRole, AuthRequest } from '../../middleware/auth.middleware'
import { PLAN_STORAGE_LIMIT, getQuotaState } from '../tenant/quota'
import { PLANS, getPlan, isPlanId } from '../tenant/plans'
import logger from '../../utils/logger'
import { asyncHandler } from '../../utils/asyncHandler'
const router = Router()

function parseBranding(raw: string | null | undefined): Record<string, string> | null {
  if (!raw) return null
  try {
    const obj = JSON.parse(raw)
    return obj && typeof obj === 'object' ? obj : null
  } catch {
    return null
  }
}

/** 租户当前设置 + 套餐/配额使用情况（供前端白标与计费看板使用） */
router.get('/tenant', authMiddleware, async (req: AuthRequest, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId } })
  if (!tenant) return res.status(404).json({ success: false, message: '租户不存在' })

  const planType = tenant.planType || 'FREE'
  const storageLimit = PLAN_STORAGE_LIMIT[planType] ?? PLAN_STORAGE_LIMIT.FREE
  // ApiUsage.tenantId 可能为 null，统一经 deployment→model 关联统计，保证多租户隔离准确
  const apiCallsUsed = await prisma.apiUsage.count({
    where: { deployment: { modelVersion: { model: { tenantId: req.tenantId } } } },
  })

  const apiCallQuota = Number(tenant.apiCallQuota ?? 0)
  const storageUsed = Number(tenant.storageUsed ?? 0)
  const quotaState = getQuotaState({ storageUsed, storageLimit, apiUsed: apiCallsUsed, apiQuota: apiCallQuota })

  res.json({
    success: true,
    data: {
      ...tenant,
      branding: parseBranding(tenant.branding),
      storageUsed,
      storageLimit,
      apiCallQuota,
      apiCallsUsed,
      ...quotaState,
    },
  })
})

/** 套餐目录（SaaS 计费的权威展示来源，与 server 端 PLANS 一致） */
router.get('/plans', authMiddleware, async (_req: AuthRequest, res) => {
  res.json({
    success: true,
    data: Object.values(PLANS).map((p) => ({
      id: p.id,
      label: p.label,
      storageLimit: p.storageLimit,
      apiCallQuota: p.apiCallQuota,
      priceMonthly: p.priceMonthly,
      features: p.features,
    })),
  })
})

/**
 * 套餐升降级（仅本租户 ADMIN）
 * 护栏：降级时若当前用量已超目标套餐上限，则拒绝（409），避免降级后立刻熔断。
 * apiCallQuota 未显式传入时，自动套用目标套餐的默认配额。
 */
router.post('/change-plan', authMiddleware, requireRole('ADMIN'), async (req: AuthRequest, res) => {
  try {
    const { planType, apiCallQuota } = req.body || {}
    if (!isPlanId(planType)) {
      return res.status(400).json({ success: false, message: '无效的套餐类型' })
    }
    const target = getPlan(planType)

    const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId } })
    if (!tenant) return res.status(404).json({ success: false, message: '租户不存在' })

    const storageUsed = Number(tenant.storageUsed ?? 0)
    if (storageUsed > target.storageLimit) {
      return res.status(409).json({
        success: false,
        message: `存储用量（${storageUsed.toLocaleString()}）已超过目标套餐上限（${target.storageLimit.toLocaleString()} 数据点），无法降级，请先清理历史数据或升级。`,
      })
    }

    const apiUsed = await prisma.apiUsage.count({ where: { tenantId: req.tenantId } })
    const newQuota = typeof apiCallQuota === 'number' ? apiCallQuota : target.apiCallQuota
    if (newQuota > 0 && apiUsed > newQuota) {
      return res.status(409).json({
        success: false,
        message: `累计 API 调用（${apiUsed.toLocaleString()}）已超过目标套餐配额（${newQuota.toLocaleString()}），无法降级，请升级套餐。`,
      })
    }

    const updated = await prisma.tenant.update({
      where: { id: req.tenantId },
      data: { planType: target.id, apiCallQuota: BigInt(Math.max(0, newQuota)) },
    })

    res.json({ success: true, data: { ...updated, apiCallQuota: Number(updated.apiCallQuota) } })
  } catch (e: any) {
    logger.warn('套餐变更失败', { error: e?.message })
    res.status(500).json({ success: false, message: '套餐变更失败' })
  }
})

/**
 * 用量明细导出。
 *   ?format=csv  → 返回 text/csv（带 UTF-8 BOM，Excel 友好），浏览器直接下载
 *   其它         → 返回 JSON（与 usage-records 相同结构，便于调试）
 * 仅本租户数据（经 deployment→model 关联保证多租户隔离）。
 */
router.get('/usage-export', authMiddleware, async (req: AuthRequest, res) => {
  const where = { deployment: { modelVersion: { model: { tenantId: req.tenantId } } } }
  const rows = await prisma.apiUsage.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: 10000,
    select: { id: true, deploymentId: true, requestTokens: true, responseTokens: true, latencyMs: true, statusCode: true, timestamp: true },
  })

  if (req.query.format === 'csv') {
    const header = 'timestamp,deploymentId,requestTokens,responseTokens,latencyMs,statusCode'
    const body = rows
      .map((r) => [r.timestamp.toISOString(), r.deploymentId, r.requestTokens, r.responseTokens, r.latencyMs, r.statusCode].join(','))
      .join('\n')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="clmx-usage-${Date.now()}.csv"`)
    return res.send('﻿' + header + '\n' + body) // BOM 让 Excel 正确识别 UTF-8
  }

  res.json({ success: true, data: { data: rows, total: rows.length } })
})

/** 更新品牌白标（合并式，支持部分字段；仅本租户 ADMIN） */
router.put('/branding', authMiddleware, requireRole('ADMIN'), async (req: AuthRequest, res) => {
  try {
    const { companyName, logoUrl, primaryColor, faviconUrl, customDomain } = req.body || {}
    const existing = parseBranding((await prisma.tenant.findUnique({ where: { id: req.tenantId } }))?.branding) || {}
    const merged = {
      companyName: companyName ?? existing.companyName ?? '',
      logoUrl: logoUrl ?? existing.logoUrl ?? '',
      primaryColor: primaryColor ?? existing.primaryColor ?? '#3b82f6',
      faviconUrl: faviconUrl ?? existing.faviconUrl ?? '',
      customDomain: customDomain ?? existing.customDomain ?? '',
    }
    const tenant = await prisma.tenant.update({
      where: { id: req.tenantId },
      data: { branding: JSON.stringify(merged) },
    })
    res.json({ success: true, data: { ...tenant, branding: merged } })
  } catch (e: any) {
    logger.warn('更新品牌失败', { error: e?.message })
    res.status(500).json({ success: false, message: '更新失败' })
  }
})

router.get('/members', authMiddleware, async (req: AuthRequest, res) => {
  res.json({ success: true, data: await prisma.user.findMany({ where: { tenantId: req.tenantId }, select: { id: true, name: true, email: true, role: true, status: true, lastLoginAt: true, createdAt: true } }) })
})

/** 用量聚合：总调用/Token + 近 7 日趋势（DB 无关实现，兼容 PostgreSQL） */
router.get('/usage', authMiddleware, async (req: AuthRequest, res) => {
  const tenantFilter = { deployment: { modelVersion: { model: { tenantId: req.tenantId } } } }

  const [totalCalls, agg, recent] = await Promise.all([
    prisma.apiUsage.count({ where: tenantFilter }),
    prisma.apiUsage.aggregate({ where: tenantFilter, _sum: { requestTokens: true, responseTokens: true } }),
    prisma.apiUsage.findMany({
      where: { ...tenantFilter, timestamp: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      select: { timestamp: true, requestTokens: true, responseTokens: true },
    }),
  ])
  const totalTokens = (Number(agg._sum.requestTokens) || 0) + (Number(agg._sum.responseTokens) || 0)

  // 在 JS 中补齐近 7 天（避免 DB 方言差异）
  const dailyMap = new Map<string, { date: string; calls: number; tokens: number }>()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
    const label = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    dailyMap.set(label, { date: label, calls: 0, tokens: 0 })
  }
  for (const r of recent) {
    const d = new Date(r.timestamp)
    const label = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const e = dailyMap.get(label)
    if (e) { e.calls += 1; e.tokens += (Number(r.requestTokens) || 0) + (Number(r.responseTokens) || 0) }
  }

  res.json({ success: true, data: { totalCalls, totalTokens, dailyStats: [...dailyMap.values()] } })
})

/** 用量明细（分页）：最近 API 调用记录，供计费看板展示 */
router.get('/usage-records', authMiddleware, async (req: AuthRequest, res) => {
  const p = Math.max(1, +(req.query.page || 1))
  const ps = Math.min(100, Math.max(1, +(req.query.pageSize || 20)))
  const where = { deployment: { modelVersion: { model: { tenantId: req.tenantId } } } }
  const [rows, total] = await Promise.all([
    prisma.apiUsage.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      skip: (p - 1) * ps,
      take: ps,
      select: { id: true, deploymentId: true, requestTokens: true, responseTokens: true, latencyMs: true, statusCode: true, timestamp: true },
    }),
    prisma.apiUsage.count({ where }),
  ])
  res.json({ success: true, data: { data: rows, total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) } })
})

router.get('/audit-logs', authMiddleware, requireRole('MANAGER'), async (req: AuthRequest, res) => {
  const p = +(req.query.page || 1), ps = +(req.query.pageSize || 20)
  const [d, t] = await Promise.all([
    prisma.auditLog.findMany({ where: { tenantId: req.tenantId }, skip: (p - 1) * ps, take: ps, orderBy: { createdAt: 'desc' }, include: { user: { select: { name: true } } } }),
    prisma.auditLog.count({ where: { tenantId: req.tenantId } }),
  ])
  res.json({ success: true, data: { data: d, total: t, page: p, pageSize: ps, totalPages: Math.ceil(t / ps) } })
})

router.get('/audit-actions', authMiddleware, requireRole('MANAGER'), async (_req: AuthRequest, res) => {
  const actions = [
    { value: 'USER_LOGIN', label: '用户登录' },
    { value: 'USER_LOGOUT', label: '用户登出' },
    { value: 'MODEL_CREATE', label: '创建模型' },
    { value: 'MODEL_UPDATE', label: '更新模型' },
    { value: 'MODEL_DELETE', label: '删除模型' },
    { value: 'DATASET_UPLOAD', label: '上传数据集' },
    { value: 'DATASET_DELETE', label: '删除数据集' },
    { value: 'TRAINING_START', label: '启动训练' },
    { value: 'TRAINING_STOP', label: '停止训练' },
    { value: 'DEPLOYMENT_CREATE', label: '创建部署' },
    { value: 'DEPLOYMENT_DELETE', label: '删除部署' },
    { value: 'USER_CREATE', label: '创建用户' },
    { value: 'USER_UPDATE', label: '更新用户' },
    { value: 'USER_DELETE', label: '删除用户' },
  ]
  res.json({ success: true, data: actions })
})

// ─── 告警投递通道（租户级） ─────────────────────────────────────
const CHANNEL_TYPES = ['IN_APP', 'WEBHOOK', 'WECHAT', 'EMAIL']

router.get('/alert-channels', authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const channels = await prisma.alertChannel.findMany({
    where: { tenantId: req.tenantId },
    orderBy: { createdAt: 'desc' },
  })
  res.json({ success: true, data: channels })
}))

router.post('/alert-channels', authMiddleware, requireRole('MANAGER'), asyncHandler(async (req: AuthRequest, res) => {
  const { type, name, config, enabled } = req.body as { type?: string; name?: string; config?: unknown; enabled?: boolean }
  if (!type || !CHANNEL_TYPES.includes(type)) return res.status(400).json({ success: false, message: '通道类型无效' })
  if (!name) return res.status(400).json({ success: false, message: '通道名称不能为空' })
  const channel = await prisma.alertChannel.create({
    data: {
      tenantId: req.tenantId!,
      type,
      name,
      config: typeof config === 'string' ? config : JSON.stringify(config ?? {}),
      enabled: enabled ?? true,
    },
  })
  res.json({ success: true, data: channel })
}))

router.put('/alert-channels/:id', authMiddleware, requireRole('MANAGER'), asyncHandler(async (req: AuthRequest, res) => {
  const ch = await prisma.alertChannel.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } })
  if (!ch) return res.status(404).json({ success: false, message: '通道不存在' })
  const { name, config, enabled } = req.body as { name?: string; config?: unknown; enabled?: boolean }
  const updated = await prisma.alertChannel.update({
    where: { id: ch.id },
    data: {
      ...(name !== undefined && { name }),
      ...(config !== undefined && { config: typeof config === 'string' ? config : JSON.stringify(config) }),
      ...(enabled !== undefined && { enabled }),
    },
  })
  res.json({ success: true, data: updated })
}))

router.delete('/alert-channels/:id', authMiddleware, requireRole('ADMIN'), asyncHandler(async (req: AuthRequest, res) => {
  const ch = await prisma.alertChannel.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } })
  if (!ch) return res.status(404).json({ success: false, message: '通道不存在' })
  await prisma.alertChannel.delete({ where: { id: ch.id } })
  res.json({ success: true, message: '通道已删除' })
}))

export default router
