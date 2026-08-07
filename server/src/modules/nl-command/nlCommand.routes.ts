import { Router } from 'express'
import { authMiddleware, AuthRequest } from '../../middleware/auth.middleware'
import { asyncHandler } from '../../utils/asyncHandler'
import { handleNlCommand } from './nlCommand.service'

const router = Router()

// 自然语言指令入口
router.post('/', authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const { message } = req.body as { message?: string }
  if (!message || !message.trim()) {
    return res.status(400).json({ success: false, message: '指令不能为空' })
  }
  const result = await handleNlCommand(message, {
    tenantId: req.tenantId,
    userId: req.userId,
    authHeader: req.headers.authorization,
  })
  res.json({ success: true, data: result })
}))

export default router
