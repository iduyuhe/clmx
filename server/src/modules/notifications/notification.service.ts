import { prisma } from '../../utils/prisma'
import logger from '../../utils/logger'

export type AlertLevel = 'INFO' | 'WARNING' | 'CRITICAL'

export interface DispatchInput {
  tenantId: string
  title: string
  body: string
  level?: AlertLevel
  type?: string // ALERT / MAINTENANCE / SYSTEM
  relatedId?: string
  link?: string
}

function parseConfig(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s || '{}')
  } catch {
    return {}
  }
}

/**
 * 触发一次告警投递：
 * 1) IN_APP：按租户成员 fan-out 生成站内信（每位 ACTIVE 成员各一条未读）。
 * 2) 外部通道：遍历启用的 AlertChannel（WEBHOOK / 企微群机器人 POST；EMAIL 为桩）。
 * 任何外部通道失败都不影响站内信与触发源。
 */
export async function dispatchAlert(input: DispatchInput): Promise<void> {
  const { tenantId, title, body, level = 'WARNING', type = 'ALERT', relatedId, link } = input

  // 1) 站内信 fan-out
  const users = await prisma.user.findMany({
    where: { tenantId, status: 'ACTIVE' },
    select: { id: true },
  })
  if (users.length > 0) {
    await prisma.notification.createMany({
      data: users.map((u) => ({
        tenantId,
        userId: u.id,
        type,
        title,
        body,
        level,
        relatedId: relatedId ?? null,
        link: link ?? null,
      })),
    })
  }

  // 2) 外部通道
  const channels = await prisma.alertChannel.findMany({
    where: { tenantId, enabled: true },
  })
  for (const ch of channels) {
    try {
      if (ch.type === 'EMAIL') {
        // 邮件适配器桩：需 SMTP 配置，当前仅记录，避免引入第三方依赖
        logger.info(`[EMAIL 桩] 本应邮件推送告警: ${title}`, { channelId: ch.id })
        continue
      }
      const cfg = parseConfig(ch.config)
      const url = typeof cfg.url === 'string' ? cfg.url : ''
      if (!url) {
        logger.warn(`告警通道 ${ch.type} 缺少 url，跳过`, { channelId: ch.id })
        continue
      }
      const payload =
        ch.type === 'WECHAT'
          ? { msgtype: 'text', text: { content: `${title}\n${body}` } }
          : { title, body, level, type, timestamp: new Date().toISOString() }
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!resp.ok) {
        logger.warn(`告警通道 ${ch.type} 投递返回 ${resp.status}`, { channelId: ch.id })
      }
    } catch (e: any) {
      logger.warn(`告警通道 ${ch.type} 投递失败: ${e?.message || e}`, { channelId: ch.id })
    }
  }
}
