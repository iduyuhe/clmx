/**
 * 套餐目录（SaaS 计费的唯一权威来源）
 *
 * - 各套餐的存储上限（数据点）与 API 调用配额在此定义
 * - quota.ts 的 PLAN_STORAGE_LIMIT 由此派生，避免数字重复
 * - 前端通过 GET /settings/plans 获取同一份目录用于展示与升降级
 */

export type PlanId = 'TRIAL' | 'FREE' | 'PRO' | 'ENTERPRISE'

export interface PlanDef {
  id: PlanId
  label: string
  /** 存储上限（数据点），超过则新数据摄入被拒绝 */
  storageLimit: number
  /** API 调用配额（按调用次数计量）；0 表示不限量 */
  apiCallQuota: number
  /** 月价（元） */
  priceMonthly: number
  features: string[]
}

export const PLANS: Record<PlanId, PlanDef> = {
  TRIAL: {
    id: 'TRIAL',
    label: '试用版',
    storageLimit: 50,
    apiCallQuota: 1000,
    priceMonthly: 0,
    features: ['基础时序异常检测', '50 数据点存储', '社区支持'],
  },
  FREE: {
    id: 'FREE',
    label: '免费版',
    storageLimit: 1_000_000,
    apiCallQuota: 10_000,
    priceMonthly: 0,
    features: ['规则引擎健康评分', '1M 数据点存储', '标准支持'],
  },
  PRO: {
    id: 'PRO',
    label: '专业版',
    storageLimit: 20_000_000,
    apiCallQuota: 500_000,
    priceMonthly: 1999,
    features: ['时序 ML 模型', '20M 数据点存储', '优先支持', '白标品牌'],
  },
  ENTERPRISE: {
    id: 'ENTERPRISE',
    label: '企业版',
    storageLimit: 500_000_000,
    apiCallQuota: 0, // 不限量
    priceMonthly: 9999,
    features: ['无限 API 调用', '500M 数据点存储', '专属客户成功', '私有化部署'],
  },
}

/** 套餐由低到高的顺序，用于判断「升级 / 降级」 */
export const PLAN_ORDER: PlanId[] = ['TRIAL', 'FREE', 'PRO', 'ENTERPRISE']

export function getPlan(id: string): PlanDef {
  return PLANS[id as PlanId] ?? PLANS.FREE
}

export function isPlanId(v: unknown): v is PlanId {
  return typeof v === 'string' && v in PLANS
}

/** 配额软告警阈值（达到该比例即预警，达到 100% 熔断） */
export const QUOTA_SOFT_PCT = 0.9
