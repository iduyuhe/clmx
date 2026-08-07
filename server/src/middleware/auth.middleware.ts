import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { config } from '../utils/config'
import { prisma } from '../utils/prisma'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type UserRole = 'ADMIN' | 'MANAGER' | 'ANNOTATOR' | 'VIEWER'

const VALID_USER_ROLES: readonly UserRole[] = ['ADMIN', 'MANAGER', 'ANNOTATOR', 'VIEWER']

/** Runtime validation: check whether a string is a valid UserRole. */
function isValidUserRole(value: string): value is UserRole {
  return VALID_USER_ROLES.includes(value as UserRole)
}

export interface AuthRequest extends Request {
  userId?: string
  tenantId?: string
  userRole?: UserRole
}

// ---------------------------------------------------------------------------
// Role hierarchy (higher index = more power)
// ---------------------------------------------------------------------------
const ROLE_RANK: Record<UserRole, number> = {
  VIEWER:     0,
  ANNOTATOR:  1,
  MANAGER:    2,
  ADMIN:      3,
}

/** Check whether `userRole` satisfies the minimum required role. */
export function roleSatisfies(userRole: UserRole, minRole: UserRole): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[minRole]
}

// ---------------------------------------------------------------------------
// JWT authentication middleware (required for every protected route)
// ---------------------------------------------------------------------------
export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  // 优先从 Authorization header 取 token，SSE (EventSource) 无法自定义 header，允许从 query param 传入
  let token: string | undefined
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1]
  } else if (req.query.token && typeof req.query.token === 'string') {
    token = req.query.token
  }

  if (!token) {
    return res.status(401).json({ success: false, message: '未登录' })
  }
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as { userId: string; tenantId: string; role?: string }
    req.userId = decoded.userId
    req.tenantId = decoded.tenantId
    // P2 修复: 从 JWT payload 注入 userRole，避免 requireRole 每次重查数据库
    if (decoded.role && isValidUserRole(decoded.role)) {
      req.userRole = decoded.role
    }
    next()
  } catch {
    return res.status(401).json({ success: false, message: 'Token 无效' })
  }
}

// ---------------------------------------------------------------------------
// Role-check middleware (run AFTER authMiddleware)
// ---------------------------------------------------------------------------
export function requireRole(minRole: UserRole) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.userId || !req.tenantId) {
      return res.status(401).json({ success: false, message: '未登录' })
    }

    // P2 修复: 优先使用 authMiddleware 从 JWT 注入的 userRole，避免重查数据库
    if (!req.userRole) {
      const user = await prisma.user.findUnique({ where: { id: req.userId } })
      if (!user) {
        return res.status(401).json({ success: false, message: '用户不存在' })
      }
      if (!isValidUserRole(user.role)) {
        return res.status(403).json({ success: false, message: `无效的用户角色: ${user.role}` })
      }
      req.userRole = user.role
    }

    if (!roleSatisfies(req.userRole, minRole)) {
      return res.status(403).json({ success: false, message: `需要 ${minRole} 及以上权限` })
    }
    next()
  }
}

/** Convenience: ADMIN-only routes. */
export const requireAdmin = requireRole('ADMIN')
