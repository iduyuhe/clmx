import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { prisma } from '../../utils/prisma'
import { config, BCRYPT_SALT_ROUNDS } from '../../utils/config'
import { authMiddleware, AuthRequest } from '../../middleware/auth.middleware'
import logger from '../../utils/logger'

const router = Router()
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(6) })
const registerSchema = z.object({ email: z.string().email(), password: z.string().min(6), name: z.string().min(2), companyName: z.string().min(1), planType: z.string().optional() })

/**
 * @openapi
 * /api/auth/register:
 *   post:
 *     tags: [认证]
 *     summary: 注册（创建租户 + 管理员账号）
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, name, companyName]
 *             properties:
 *               email: { type: string, example: admin@company.com }
 *               password: { type: string, example: "123456" }
 *               name: { type: string, example: 管理员 }
 *               companyName: { type: string, example: 某公司 }
 *               planType: { type: string, enum: [TRIAL, FREE, PRO], example: FREE }
 *     responses:
 *       200:
 *         description: 成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     token: { type: string }
 *                     user: { type: object }
 */
router.post('/register', async (req, res) => {
  try {
    const data = registerSchema.parse(req.body)
    const existing = await prisma.user.findUnique({ where: { email: data.email } })
    if (existing) return res.status(400).json({ success: false, message: '该邮箱已注册' })

    const tenant = await prisma.tenant.create({
      data: {
        name: data.companyName,
        slug: data.companyName.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now(),
        planType: data.planType || 'FREE',
        branding: JSON.stringify({ companyName: data.companyName, primaryColor: '#3b82f6', logoUrl: '', faviconUrl: '', customDomain: '' }),
      },
    })

    const passwordHash = await bcrypt.hash(data.password, BCRYPT_SALT_ROUNDS)
    const user = await prisma.user.create({
      data: { tenantId: tenant.id, email: data.email, passwordHash, name: data.name, role: 'ADMIN' },
      include: { tenant: true },
    })

    const token = jwt.sign({ userId: user.id, tenantId: tenant.id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn } as jwt.SignOptions)
    res.json({ success: true, data: { token, user: { ...user, passwordHash: undefined } } })
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ success: false, message: '参数错误', data: err.errors })
    res.status(500).json({ success: false, message: '注册失败' })
  }
})

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     tags: [认证]
 *     summary: 登录
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, example: test@test.com }
 *               password: { type: string, example: "123456" }
 *     responses:
 *       200:
 *         description: 成功，返回 token 和用户信息
 */
router.post('/login', async (req, res) => {
  try {
    const data = loginSchema.parse(req.body)
    const user = await prisma.user.findUnique({ where: { email: data.email }, include: { tenant: true } })
    if (!user) return res.status(401).json({ success: false, message: '邮箱或密码错误' })

    const valid = await bcrypt.compare(data.password, user.passwordHash)
    if (!valid) return res.status(401).json({ success: false, message: '邮箱或密码错误' })

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    const token = jwt.sign({ userId: user.id, tenantId: user.tenantId, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn } as jwt.SignOptions)
    // 解析 tenant.branding（JSON 字符串 → 对象），使登录后白标立即可用
    const loginUser: Record<string, unknown> = { ...user, passwordHash: undefined }
    if (user.tenant?.branding) {
      try { (loginUser.tenant as Record<string, unknown>).branding = JSON.parse(user.tenant.branding as string) } catch { /* 保留原值 */ }
    }
    res.json({ success: true, data: { token, user: loginUser } })
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ success: false, message: '参数错误', data: err.errors })
    logger.warn('登录失败', { error: err?.message })
    res.status(500).json({ success: false, message: '登录失败' })
  }
})

router.get('/me', authMiddleware, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId }, include: { tenant: true } })
  if (!user) return res.status(404).json({ success: false, message: '用户不存在' })
  // 解析 tenant.branding（JSON 字符串 → 对象），使前端白标立即可用
  const tenant = user.tenant
  const data: Record<string, unknown> = { ...user, passwordHash: undefined }
  if (tenant?.branding) {
    try { (data.tenant as Record<string, unknown>).branding = JSON.parse(tenant.branding as string) } catch { /* 保留原值 */ }
  }
  res.json({ success: true, data })
})

router.post('/change-password', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { oldPassword, newPassword } = req.body
    if (!oldPassword || !newPassword) return res.status(400).json({ success: false, message: '请填写旧密码和新密码' })
    if (newPassword.length < 6) return res.status(400).json({ success: false, message: '新密码至少6位' })
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) return res.status(404).json({ success: false, message: '用户不存在' })
    const valid = await bcrypt.compare(oldPassword, user.passwordHash)
    if (!valid) return res.status(400).json({ success: false, message: '旧密码错误' })
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS)
    await prisma.user.update({ where: { id: req.userId }, data: { passwordHash } })
    res.json({ success: true, data: null })
  } catch (err: any) {
    res.status(500).json({ success: false, message: '密码修改失败' })
  }
})

export default router
