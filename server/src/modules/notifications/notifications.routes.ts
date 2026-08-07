import { Router } from 'express'
import { prisma } from '../../utils/prisma'
import { authMiddleware, requireRole, AuthRequest } from '../../middleware/auth.middleware'
import { asyncHandler } from '../../utils/asyncHandler'
import { dispatchAlert } from './notification.service'

const router = Router()

// 收件箱 + 未读计数（仅当前用户）
router.get('/', authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const page = Math.max(1, +(req.query.page || 1))
  const pageSize = Math.min(Math.max(1, +(req.query.pageSize || 20)), 100)
  const where = { userId: req.userId! }
  const [items, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { ...where, read: false } }),
  ])
  res.json({ success: true, data: { data: items, total, page, pageSize, unreadCount } })
}))

// 标记单条已读
router.post('/:id/read', authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const n = await prisma.notification.findFirst({ where: { id: req.params.id, userId: req.userId! } })
  if (!n) return res.status(404).json({ success: false, message: '通知不存在' })
  const updated = await prisma.notification.update({ where: { id: n.id }, data: { read: true } })
  res.json({ success: true, data: updated })
}))

// 全部已读
router.post('/read-all', authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.userId!, read: false },
    data: { read: true },
  })
  res.json({ success: true, message: '已全部标记已读' })
}))

// 发送测试告警（验证投递通道）
router.post('/test', authMiddleware, requireRole('MANAGER'), asyncHandler(async (req: AuthRequest, res) => {
  await dispatchAlert({
    tenantId: req.tenantId!,
    title: '测试告警',
    body: '这是一条来自 CLMX 的测试告警，用于验证投递通道（站内信 + 外部通道）是否正常工作。',
    level: 'WARNING',
    type: 'ALERT',
  })
  res.json({ success: true, message: '测试告警已触发，请检查站内信与外部通道' })
}))

export default router
