import { Router } from 'express'
import { prisma } from '../../utils/prisma'
import { authMiddleware, requireRole, AuthRequest } from '../../middleware/auth.middleware'
import { asyncHandler } from '../../utils/asyncHandler'
import logger from '../../utils/logger'

const router = Router()

// 维修工单列表
router.get('/', authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const p = +(req.query.page || 1), ps = +(req.query.pageSize || 20)
  const where: Record<string, unknown> = { tenantId: req.tenantId }
  if (req.query.status) where.status = req.query.status
  if (req.query.priority) where.priority = req.query.priority
  if (req.query.deviceId) where.deviceId = req.query.deviceId
  if (req.query.type) where.type = req.query.type

  const [data, total] = await Promise.all([
    prisma.maintenanceOrder.findMany({
      where,
      skip: (p - 1) * ps,
      take: ps,
      orderBy: { createdAt: 'desc' },
      include: { device: { select: { id: true, name: true, code: true } } },
    }),
    prisma.maintenanceOrder.count({ where }),
  ])
  res.json({ success: true, data: { data, total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) } })
}))

// 工单详情
router.get('/:id', authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const order = await prisma.maintenanceOrder.findFirst({
    where: { id: req.params.id, tenantId: req.tenantId },
    include: { device: { include: { sensors: { select: { id: true, name: true, channel: true } } } } },
  })
  if (!order) return res.status(404).json({ success: false, message: '工单不存在' })
  res.json({ success: true, data: order })
}))

// 创建工单
router.post('/', authMiddleware, requireRole('MANAGER'), asyncHandler(async (req: AuthRequest, res) => {
  if (!req.tenantId) return res.status(401).json({ success: false, message: '未登录' })
  const { deviceId, type, priority, title, description, assignedTo, dueDate, healthScore } = req.body
  if (!deviceId || !title) return res.status(400).json({ success: false, message: '设备和工单标题不能为空' })

  const device = await prisma.device.findFirst({ where: { id: deviceId, tenantId: req.tenantId } })
  if (!device) return res.status(404).json({ success: false, message: '设备不存在' })

  const order = await prisma.maintenanceOrder.create({
    data: {
      tenantId: req.tenantId,
      deviceId, type: type || 'PREVENTIVE',
      priority: priority || 'MEDIUM',
      title, description, assignedTo,
      dueDate: dueDate ? new Date(dueDate) : null,
      healthScore,
    },
  })
  logger.info(`维修工单创建: ${order.title}`, { userId: req.userId, orderId: order.id })
  res.json({ success: true, data: order })
}))

// 更新工单状态
router.put('/:id', authMiddleware, requireRole('MANAGER'), asyncHandler(async (req: AuthRequest, res) => {
  const order = await prisma.maintenanceOrder.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } })
  if (!order) return res.status(404).json({ success: false, message: '工单不存在' })

  const { status, priority, assignedTo, dueDate, description, completedAt } = req.body
  const updated = await prisma.maintenanceOrder.update({
    where: { id: req.params.id },
    data: { status, priority, assignedTo, dueDate: dueDate ? new Date(dueDate) : undefined, description, completedAt: completedAt ? new Date(completedAt) : undefined },
  })
  res.json({ success: true, data: updated })
}))

// 删除工单
router.delete('/:id', authMiddleware, requireRole('ADMIN'), asyncHandler(async (req: AuthRequest, res) => {
  await prisma.maintenanceOrder.delete({ where: { id: req.params.id } })
  res.json({ success: true, message: '工单已删除' })
}))

// ─── 备件管理 ─────────────────────────────────────

// 备件列表
router.get('/spare-parts/list', authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const p = +(req.query.page || 1), ps = +(req.query.pageSize || 20)
  const where: Record<string, unknown> = { tenantId: req.tenantId }
  if (req.query.keyword) where.name = { contains: req.query.keyword as string }

  const [data, total] = await Promise.all([
    prisma.sparePart.findMany({ where, skip: (p - 1) * ps, take: ps, orderBy: { createdAt: 'desc' } }),
    prisma.sparePart.count({ where }),
  ])
  res.json({ success: true, data: { data, total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) } })
}))

// 添加备件
router.post('/spare-parts', authMiddleware, requireRole('MANAGER'), asyncHandler(async (req: AuthRequest, res) => {
  if (!req.tenantId) return res.status(401).json({ success: false, message: '未登录' })
  const { name, partNumber, specification, stockQty, minStock, unitPrice, supplier } = req.body
  if (!name) return res.status(400).json({ success: false, message: '备件名称不能为空' })

  const part = await prisma.sparePart.create({
    data: { tenantId: req.tenantId, name, partNumber, specification, stockQty: stockQty || 0, minStock: minStock || 0, unitPrice: unitPrice || 0, supplier },
  })
  res.json({ success: true, data: part })
}))

// 更新备件
router.put('/spare-parts/:id', authMiddleware, requireRole('MANAGER'), asyncHandler(async (req: AuthRequest, res) => {
  const part = await prisma.sparePart.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } })
  if (!part) return res.status(404).json({ success: false, message: '备件不存在' })

  const { name, partNumber, specification, stockQty, minStock, unitPrice, supplier } = req.body
  const updated = await prisma.sparePart.update({
    where: { id: req.params.id },
    data: { name, partNumber, specification, stockQty, minStock, unitPrice, supplier },
  })
  res.json({ success: true, data: updated })
}))

// 删除备件
router.delete('/spare-parts/:id', authMiddleware, requireRole('ADMIN'), asyncHandler(async (req: AuthRequest, res) => {
  await prisma.sparePart.delete({ where: { id: req.params.id } })
  res.json({ success: true, message: '备件已删除' })
}))

export default router
