import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../utils/prisma'
import { authMiddleware, requireRole, AuthRequest } from '../../middleware/auth.middleware'
import { PLAN_STORAGE_LIMIT } from './quota'
import logger from '../../utils/logger'

const router = Router()

function parseBranding(raw: string | null | undefined) {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * GET /api/tenants/me
 * 当前租户的设置与配额使用情况（含品牌白标）
 */
router.get('/me', authMiddleware, async (req: AuthRequest, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId } })
  if (!tenant) return res.status(404).json({ success: false, message: '租户不存在' })
  const apiCallsUsed = await prisma.apiUsage.count({ where: { tenantId: req.tenantId } })
  res.json({
    success: true,
    data: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      planType: tenant.planType,
      status: tenant.status,
      branding: parseBranding(tenant.branding),
      storageUsed: Number(tenant.storageUsed ?? 0),
      storageLimit: PLAN_STORAGE_LIMIT[tenant.planType] ?? PLAN_STORAGE_LIMIT.FREE,
      apiCallQuota: Number(tenant.apiCallQuota ?? 0),
      apiCallsUsed,
      createdAt: tenant.createdAt,
    },
  })
})

const brandingSchema = z.object({
  companyName: z.string().optional(),
  primaryColor: z.string().optional(),
  logoUrl: z.string().optional(),
  faviconUrl: z.string().optional(),
  customDomain: z.string().optional(),
})

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  planType: z.enum(['TRIAL', 'FREE', 'PRO', 'ENTERPRISE']).optional(),
  apiCallQuota: z.number().int().min(0).optional(),
  branding: brandingSchema.optional(),
})

/**
 * PATCH /api/tenants/me
 * 更新品牌白标 / 套餐 / 配额（仅 MANAGER 及以上）
 */
router.patch('/me', authMiddleware, requireRole('MANAGER'), async (req: AuthRequest, res) => {
  try {
    const data = patchSchema.parse(req.body)
    const update: Record<string, unknown> = {}
    if (data.name) update.name = data.name
    if (data.planType) update.planType = data.planType
    if (typeof data.apiCallQuota === 'number') update.apiCallQuota = BigInt(data.apiCallQuota)
    if (data.branding) {
      const existing = parseBranding((await prisma.tenant.findUnique({ where: { id: req.tenantId } }))?.branding)
      update.branding = JSON.stringify({ ...existing, ...data.branding })
    }
    const tenant = await prisma.tenant.update({ where: { id: req.tenantId }, data: update })
    const apiCallsUsed = await prisma.apiUsage.count({ where: { tenantId: req.tenantId } })
    res.json({
      success: true,
      data: {
        ...tenant,
        branding: parseBranding(tenant.branding),
        storageUsed: Number(tenant.storageUsed ?? 0),
        storageLimit: PLAN_STORAGE_LIMIT[tenant.planType] ?? PLAN_STORAGE_LIMIT.FREE,
        apiCallQuota: Number(tenant.apiCallQuota ?? 0),
        apiCallsUsed,
      },
    })
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ success: false, message: '参数错误', data: err.errors })
    logger.warn('更新租户设置失败', { error: err?.message })
    res.status(500).json({ success: false, message: '更新失败' })
  }
})

export default router
