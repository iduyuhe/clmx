import { prisma } from '../../utils/prisma'
import { PLANS, QUOTA_SOFT_PCT } from './plans'

/** 各套餐的存储上限（按数据点计）。派生自 plans.ts，避免数字重复。 */
export const PLAN_STORAGE_LIMIT: Record<string, number> = Object.fromEntries(
  Object.values(PLANS).map((p) => [p.id, p.storageLimit]),
) as Record<string, number>

/** 配额超限错误，统一映射为 HTTP 429 */
export class QuotaExceededError extends Error {
  status: number
  kind: 'storage' | 'api'
  constructor(kind: 'storage' | 'api', message: string) {
    super(message)
    this.name = 'QuotaExceededError'
    this.kind = kind
    this.status = 429
  }
}

/**
 * 摄入传感器数据时累加存储用量；超过套餐上限则抛出 QuotaExceededError(storage)。
 */
export async function incrementStorageUsed(tenantId: string, points: number): Promise<void> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) return
  const limit = PLAN_STORAGE_LIMIT[tenant.planType] ?? PLAN_STORAGE_LIMIT.FREE
  const current = tenant.storageUsed ?? BigInt(0)
  const next = current + BigInt(Math.max(0, points))
  if (next > BigInt(limit)) {
    throw new QuotaExceededError(
      'storage',
      `存储空间配额已用尽（套餐上限 ${limit} 个数据点），请升级套餐或清理历史数据`,
    )
  }
  await prisma.tenant.update({ where: { id: tenantId }, data: { storageUsed: next } })
}

/**
 * API 调用配额检查：统计租户已产生的 ApiUsage 次数，达到 apiCallQuota 则抛出 QuotaExceededError(api)。
 * apiCallQuota <= 0 视为不限量。
 */
export async function checkApiQuota(tenantId: string): Promise<void> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) return
  const quota = Number(tenant.apiCallQuota ?? 0)
  if (quota <= 0) return
  const used = await prisma.apiUsage.count({ where: { tenantId } })
  if (used >= quota) {
    throw new QuotaExceededError('api', `API 调用配额已用尽（${quota} 次/周期），请升级套餐`)
  }
}

/**
 * 计算租户配额状态（供前端计费看板展示「熔断」状态）。
 * 纯函数：根据当前用量与套餐上限得出百分比与是否已熔断。
 */
export function getQuotaState(opts: {
  storageUsed: bigint | number
  storageLimit: number
  apiUsed: number
  apiQuota: number
}): {
  storagePct: number
  apiPct: number
  storageSoft: boolean
  apiSoft: boolean
  storageBreached: boolean
  apiBreached: boolean
} {
  const storageLimit = opts.storageLimit || 0
  const storagePct = storageLimit > 0 ? Math.min(100, (Number(opts.storageUsed) / storageLimit) * 100) : 0
  const apiUnlimited = opts.apiQuota <= 0
  const apiPct = apiUnlimited ? 0 : Math.min(100, (opts.apiUsed / opts.apiQuota) * 100)
  return {
    storagePct: Number(storagePct.toFixed(2)),
    apiPct: Number(apiPct.toFixed(2)),
    storageSoft: storagePct >= QUOTA_SOFT_PCT * 100 && storagePct < 100,
    apiSoft: !apiUnlimited && apiPct >= QUOTA_SOFT_PCT * 100 && apiPct < 100,
    storageBreached: storagePct >= 100,
    apiBreached: !apiUnlimited && apiPct >= 100,
  }
}
