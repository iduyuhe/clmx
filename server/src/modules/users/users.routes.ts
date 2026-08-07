import { Router } from 'express'
import { prisma } from '../../utils/prisma'
import { authMiddleware, requireAdmin, AuthRequest } from '../../middleware/auth.middleware'
import bcrypt from 'bcryptjs'
import { BCRYPT_SALT_ROUNDS } from '../../utils/config'

const router = Router()

// 获取用户列表（分页）
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  const p = +(req.query.page || 1)
  const ps = +(req.query.pageSize || 20)
  const [data, total] = await Promise.all([
    prisma.user.findMany({
      where: { tenantId: req.tenantId },
      select: { id: true, email: true, name: true, role: true, status: true, lastLoginAt: true, createdAt: true },
      skip: (p - 1) * ps,
      take: ps,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.count({ where: { tenantId: req.tenantId } }),
  ])
  res.json({ success: true, data: { data, total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) } })
})

// 创建用户
router.post('/', authMiddleware, requireAdmin, async (req: AuthRequest, res) => {
  const { email, name, password, role } = req.body
  if (!email || !name || !password) return res.status(400).json({ success: false, message: '邮箱、姓名和密码为必填项' })
  if (password.length < 6) return res.status(400).json({ success: false, message: '密码至少6位' })
  const existing = await prisma.user.findFirst({ where: { tenantId: req.tenantId, email } })
  if (!req.tenantId) return res.status(401).json({ success: false, message: '未登录' })
  if (existing) return res.status(409).json({ success: false, message: '该邮箱已存在' })
  const hashed = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS)
  const user = await prisma.user.create({
    data: { email, name, passwordHash: hashed, role: role || 'MEMBER', tenantId: req.tenantId },
    select: { id: true, email: true, name: true, role: true, status: true, createdAt: true },
  })
  res.json({ success: true, data: user })
})

// 更新用户
router.put('/:id', authMiddleware, requireAdmin, async (req: AuthRequest, res) => {
  const { name, role, status } = req.body
  const user = await prisma.user.update({
    where: { id: req.params.id, tenantId: req.tenantId },
    data: { ...(name !== undefined && { name }), ...(role !== undefined && { role }), ...(status !== undefined && { status }) },
    select: { id: true, email: true, name: true, role: true, status: true, updatedAt: true },
  })
  res.json({ success: true, data: user })
})

// 重置密码
router.post('/:id/reset-password', authMiddleware, requireAdmin, async (req: AuthRequest, res) => {
  const { newPassword } = req.body
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ success: false, message: '新密码至少6位' })
  const hashed = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS)
  await prisma.user.update({
    where: { id: req.params.id, tenantId: req.tenantId },
    data: { passwordHash: hashed },
  })
  res.json({ success: true, data: null })
})

// 删除用户
router.delete('/:id', authMiddleware, requireAdmin, async (req: AuthRequest, res) => {
  await prisma.user.delete({ where: { id: req.params.id, tenantId: req.tenantId } })
  res.json({ success: true, data: null })
})

export default router
