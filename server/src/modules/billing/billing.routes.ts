/**
 * CLMX SaaS 计费 — 账单生命周期
 *
 * 端点（均经租户隔离）：
 *   GET  /api/billing/invoices          账单列表（分页）
 *   POST /api/billing/invoices/:id/pay  mock 支付（OPEN → PAID）
 *   POST /api/billing/generate-monthly  依据当前用量生成本月账单（幂等：重生成先撤销未支付账单）
 *
 * 说明：支付为 mock，不接真实支付网关；仅演示「账单 → 支付 → 已结清」闭环。
 */
import { Router } from 'express'
import { prisma } from '../../utils/prisma'
import { authMiddleware, requireRole, AuthRequest } from '../../middleware/auth.middleware'
import { asyncHandler } from '../../utils/asyncHandler'
import { PLANS, getPlan } from '../tenant/plans'
import logger from '../../utils/logger'

const router = Router()

const STORAGE_UNIT_PRICE = 0.0001 // 每超出数据点 ¥
const API_UNIT_PRICE = 0.01 // 每超出调用 ¥

function nowPeriod(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

router.get('/invoices', authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const page = Math.max(1, +(req.query.page || 1))
  const pageSize = Math.min(100, Math.max(1, +(req.query.pageSize || 20)))
  const [rows, total] = await Promise.all([
    prisma.invoice.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.invoice.count({ where: { tenantId: req.tenantId } }),
  ])
  res.json({ success: true, data: { data: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) } })
}))

router.post('/invoices/:id/pay', authMiddleware, requireRole('MANAGER'), asyncHandler(async (req: AuthRequest, res) => {
  const inv = await prisma.invoice.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } })
  if (!inv) return res.status(404).json({ success: false, message: '账单不存在' })
  if (inv.status === 'PAID') return res.status(409).json({ success: false, message: '该账单已支付' })
  if (inv.status === 'VOID') return res.status(409).json({ success: false, message: '该账单已作废' })

  const updated = await prisma.invoice.update({
    where: { id: inv.id },
    data: { status: 'PAID', paidAt: new Date() },
  })
  logger.info('账单已支付(mock)', { tenantId: req.tenantId, invoiceId: inv.id })
  res.json({ success: true, data: updated, message: '支付成功（演示）' })
}))

router.post('/generate-monthly', authMiddleware, requireRole('ADMIN'), asyncHandler(async (req: AuthRequest, res) => {
  const tenantId = req.tenantId!
  const period = nowPeriod()
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) return res.status(404).json({ success: false, message: '租户不存在' })

  const plan = getPlan(tenant.planType || 'FREE')
  const base = plan.priceMonthly || 0
  const storageLimit = plan.storageLimit || 0
  const apiQuota = Number(tenant.apiCallQuota || 0)

  const storageUsed = Number(tenant.storageUsed || 0)
  const apiUsed = await prisma.apiUsage.count({ where: { tenantId } })

  const overStorage = Math.max(0, storageUsed - storageLimit)
  const overApi = Math.max(0, apiUsed - apiQuota)
  const storageFee = Math.round(overStorage * STORAGE_UNIT_PRICE * 100) / 100
  const apiFee = Math.round(overApi * API_UNIT_PRICE * 100) / 100
  const amount = Math.round((base + storageFee + apiFee) * 100) / 100

  const items = [
    { name: `套餐 ${plan.label}`, qty: 1, unitPrice: base, amount: base },
    ...(overStorage > 0 ? [{ name: '存储超额', qty: overStorage, unitPrice: STORAGE_UNIT_PRICE, amount: storageFee }] : []),
    ...(overApi > 0 ? [{ name: 'API 调用超额', qty: overApi, unitPrice: API_UNIT_PRICE, amount: apiFee }] : []),
  ]

  const seq = (await prisma.invoice.count({ where: { tenantId } })) + 1
  const number = `INV-${period}-${String(seq).padStart(4, '0')}`

  // 幂等：撤销本月未支付账单，重生成
  await prisma.invoice.deleteMany({ where: { tenantId, period, status: { in: ['DRAFT', 'OPEN'] } } })

  const invoice = await prisma.invoice.create({
    data: {
      tenantId,
      userId: req.userId ?? tenantId,
      number,
      period,
      amount,
      currency: 'CNY',
      status: 'OPEN',
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      items: JSON.stringify(items),
    },
  })

  res.json({ success: true, data: invoice, message: '已生成本月账单' })
}))

export default router
