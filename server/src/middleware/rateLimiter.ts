import rateLimit from 'express-rate-limit'

/** 严格限制 — 用于登录/注册接口（防暴力破解） */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟窗口
  max: 20,                   // 最多 20 次请求
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: '请求过于频繁，请 15 分钟后再试' },
})

/** 通用 API 限制 */
export const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 分钟窗口
  max: 200,                 // 每分钟最多 200 次
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: '请求过于频繁，请稍后再试' },
})
