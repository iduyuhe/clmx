/**
 * 审计日志自动写入中间件
 */
import { Response, NextFunction } from 'express'
import { AuthRequest } from '../../middleware/auth.middleware'
import { writeAuditLog, AuditAction } from './audit.service'

const ACTION_LABELS: Record<AuditAction, string> = {
  LOGIN: '用户登录', LOGOUT: '用户登出', LOGIN_FAIL: '登录失败',
  USER_CREATE: '创建用户', USER_UPDATE: '更新用户', USER_DISABLE: '禁用用户', USER_ENABLE: '启用用户',
  MODEL_CREATE: '创建模型', MODEL_UPDATE: '更新模型', MODEL_DELETE: '删除模型', MODEL_PUBLISH: '发布模型',
  TRAINING_START: '启动训练', TRAINING_PAUSE: '暂停训练', TRAINING_RESUME: '继续训练', TRAINING_STOP: '停止训练', TRAINING_COMPLETE: '训练完成',
  DEPLOY_CREATE: '创建部署', DEPLOY_DELETE: '删除部署', DEPLOY_TEST: '测试调用',
  APIKEY_CREATE: '创建API密钥', APIKEY_DELETE: '删除API密钥',
  DATASET_UPLOAD: '上传数据集', DATASET_DELETE: '删除数据集',
  SETTINGS_UPDATE: '更新设置',
}

export function getActionLabel(action: string): string {
  return ACTION_LABELS[action as AuditAction] || action
}

/**
 * 自动审计中间件 — 根据 HTTP 方法 + 路径自动记录审计日志
 * 仅在 mutation 操作（POST/PUT/PATCH/DELETE）时写入
 */
export function auditMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const method = req.method.toUpperCase()
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return next()

  // 在 response 完成后写入审计日志
  const originalEnd = res.end

  res.end = function (...args: any[]) {
    // 从 req 中获取审计信息（如果有的话，路由可预先设置）
    const auditMeta = (req as any).__auditMeta as { action?: AuditAction; resourceType?: string; resourceId?: string; detail?: Record<string, unknown> } | undefined

    // 自动推断 action（如果路由没有预设置）
    let action: AuditAction | undefined = auditMeta?.action
    if (!action) {
      action = inferAction(method, req.path)
    }

    if (action && req.userId && req.tenantId) {
      writeAuditLog({
        tenantId: req.tenantId,
        userId: req.userId,
        action,
        resourceType: auditMeta?.resourceType || inferResourceType(req.path),
        resourceId: auditMeta?.resourceId || req.params?.id || '',
        detail: auditMeta?.detail,
        ipAddress: req.ip || req.socket?.remoteAddress || '',
        userAgent: (req.headers['user-agent'] as string) || '',
      }).catch(() => {})
    }

    return (originalEnd as any).apply(res, args)
  }

  next()
}

function inferAction(method: string, path: string): AuditAction | undefined {
  const lower = path.toLowerCase()

  // 使用 if-else 避免过多条件嵌套
  if (method === 'POST') {
    if (lower.includes('/login')) return AuditAction.LOGIN
    if (lower.includes('/register')) return AuditAction.USER_CREATE
    if (lower.includes('/change-password')) return AuditAction.USER_UPDATE
    if (lower.includes('/users') && !lower.includes('reset-password')) return AuditAction.USER_CREATE
    if (lower.includes('/users') && lower.includes('reset-password')) return AuditAction.USER_UPDATE
    if (lower.includes('/models')) return AuditAction.MODEL_CREATE
    if (lower.includes('/datasets') && lower.includes('upload')) return AuditAction.DATASET_UPLOAD
    if (lower.includes('/datasets')) return AuditAction.DATASET_UPLOAD
    if (lower.includes('/training') && lower.includes('start')) return AuditAction.TRAINING_START
    if (lower.includes('/training') && lower.includes('pause')) return AuditAction.TRAINING_PAUSE
    if (lower.includes('/training') && lower.includes('resume')) return AuditAction.TRAINING_RESUME
    if (lower.includes('/training') && lower.includes('stop')) return AuditAction.TRAINING_STOP
    if (lower.includes('/deployments') && lower.includes('api-keys')) return AuditAction.APIKEY_CREATE
    if (lower.includes('/deployments') && lower.includes('test')) return AuditAction.DEPLOY_TEST
    if (lower.includes('/deployments')) return AuditAction.DEPLOY_CREATE
    if (lower.includes('/training')) return AuditAction.TRAINING_START
  }

  if (method === 'PUT' || method === 'PATCH') {
    if (lower.includes('/users')) return AuditAction.USER_UPDATE
    if (lower.includes('/models')) return AuditAction.MODEL_UPDATE
    if (lower.includes('/settings')) return AuditAction.SETTINGS_UPDATE
    return AuditAction.SETTINGS_UPDATE
  }

  if (method === 'DELETE') {
    if (lower.includes('/users')) return AuditAction.USER_DISABLE
    if (lower.includes('/models')) return AuditAction.MODEL_DELETE
    if (lower.includes('/datasets') && lower.includes('api-keys')) return AuditAction.APIKEY_DELETE
    if (lower.includes('/deployments') && lower.includes('api-keys')) return AuditAction.APIKEY_DELETE
    if (lower.includes('/datasets')) return AuditAction.DATASET_DELETE
    if (lower.includes('/deployments')) return AuditAction.DEPLOY_DELETE
    if (lower.includes('/training')) return AuditAction.TRAINING_STOP
  }

  return undefined
}

function inferResourceType(path: string): string {
  const lower = path.toLowerCase()
  if (lower.includes('/users')) return 'User'
  if (lower.includes('/models')) return 'Model'
  if (lower.includes('/datasets')) return 'Dataset'
  if (lower.includes('/training')) return 'TrainingJob'
  if (lower.includes('/deployments')) return 'Deployment'
  if (lower.includes('/settings')) return 'Settings'
  return 'Unknown'
}
