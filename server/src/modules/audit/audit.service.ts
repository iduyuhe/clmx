/**
 * 审计日志服务
 *
 * 统一提供审计日志写入能力，支持：
 * - 手动调用（在路由处理器中显式记录）
 * - Action 枚举约束（防止随意字符串）
 */
import { prisma } from '../../utils/prisma'
import logger from '../../utils/logger'

/** 审计操作类型 */
export enum AuditAction {
  // 认证
  LOGIN            = 'LOGIN',
  LOGOUT           = 'LOGOUT',
  LOGIN_FAIL       = 'LOGIN_FAIL',

  // 用户
  USER_CREATE      = 'USER_CREATE',
  USER_UPDATE      = 'USER_UPDATE',
  USER_DISABLE     = 'USER_DISABLE',
  USER_ENABLE      = 'USER_ENABLE',

  // 模型
  MODEL_CREATE     = 'MODEL_CREATE',
  MODEL_UPDATE     = 'MODEL_UPDATE',
  MODEL_DELETE     = 'MODEL_DELETE',
  MODEL_PUBLISH    = 'MODEL_PUBLISH',

  // 训练
  TRAINING_START   = 'TRAINING_START',
  TRAINING_PAUSE   = 'TRAINING_PAUSE',
  TRAINING_RESUME  = 'TRAINING_RESUME',
  TRAINING_STOP    = 'TRAINING_STOP',
  TRAINING_COMPLETE= 'TRAINING_COMPLETE',

  // 部署
  DEPLOY_CREATE    = 'DEPLOY_CREATE',
  DEPLOY_DELETE    = 'DEPLOY_DELETE',
  DEPLOY_TEST      = 'DEPLOY_TEST',

  // API Key
  APIKEY_CREATE    = 'APIKEY_CREATE',
  APIKEY_DELETE    = 'APIKEY_DELETE',

  // 数据集
  DATASET_UPLOAD   = 'DATASET_UPLOAD',
  DATASET_DELETE   = 'DATASET_DELETE',

  // 设置
  SETTINGS_UPDATE  = 'SETTINGS_UPDATE',
}

export interface AuditLogInput {
  tenantId: string
  userId:   string
  action:   AuditAction
  resourceType?: string   // 操作的资源类型，如 "Model", "TrainingJob"
  resourceId?:   string // 操作的资源 ID
  detail?:        Record<string, unknown> // 额外详情（JSON）
  ipAddress?:     string  // 客户端 IP
  userAgent?:     string  // 客户端 User-Agent
}

/**
 * 写入一条审计日志
 */
export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId:     input.tenantId,
        userId:       input.userId,
        action:       input.action,
        resourceType: input.resourceType || '',
        resourceId:   input.resourceId   || '',
        changes:      input.detail ? JSON.stringify(input.detail) : undefined,
        ipAddress:    input.ipAddress || '',
        userAgent:    input.userAgent || '',
      },
    })
  } catch (err) {
    // 审计日志写入失败不应阻断主流程
    logger.error('[Audit] 写入失败', { error: String(err) })
  }
}
