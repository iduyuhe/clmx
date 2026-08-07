import { prisma } from '../../utils/prisma'

export interface BaselineResult {
  sensorId: string
  baselineMin: number
  baselineMax: number
  mean: number
  std: number
  samples: number
  method: string
  insufficient: boolean
}

const MIN_SAMPLES = 20
const DEFAULT_DAYS = 7
const DEFAULT_K = 3

/**
 * 自动基线：基于传感器最近 N 天历史遥测，用 mean ± k·std 计算动态告警阈值。
 * 纯 TS 实现，无外部依赖。std=0 时退化为以 mean 为中心的小区间，避免阈值倒挂。
 */
export async function computeBaselineValues(
  sensorId: string,
  opts?: { days?: number; k?: number },
): Promise<BaselineResult | null> {
  const days = opts?.days ?? DEFAULT_DAYS
  const k = opts?.k ?? DEFAULT_K
  const since = new Date(Date.now() - days * 24 * 3600 * 1000)

  const rows = await prisma.sensorData.findMany({
    where: { sensorId, timestamp: { gte: since } },
    select: { value: true },
    orderBy: { timestamp: 'desc' },
    take: 5000,
  })
  const vals = rows.map((r) => r.value)
  const method = `mean±${k}std`

  if (vals.length < MIN_SAMPLES) {
    return {
      sensorId,
      baselineMin: 0,
      baselineMax: 0,
      mean: 0,
      std: 0,
      samples: vals.length,
      method,
      insufficient: true,
    }
  }

  const n = vals.length
  const mean = vals.reduce((a, b) => a + b, 0) / n
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n
  const std = Math.sqrt(variance)

  let baselineMin = mean - k * std
  let baselineMax = mean + k * std
  if (baselineMin >= baselineMax) {
    const eps = Math.abs(mean) * 0.05 || 1
    baselineMin = mean - eps
    baselineMax = mean + eps
  }

  return {
    sensorId,
    baselineMin,
    baselineMax,
    mean,
    std,
    samples: n,
    method,
    insufficient: false,
  }
}

/**
 * 计算并将基线写回 Sensor 表（调用方需先校验 sensor 归属当前租户）。
 */
export async function recomputeSensorBaseline(
  sensorId: string,
  opts?: { days?: number; k?: number },
): Promise<BaselineResult | null> {
  const result = await computeBaselineValues(sensorId, opts)
  if (!result) return null
  await prisma.sensor.update({
    where: { id: sensorId },
    data: {
      baselineMin: result.baselineMin,
      baselineMax: result.baselineMax,
      baselineMean: result.mean,
      baselineStd: result.std,
      baselineSamples: result.samples,
      baselineUpdatedAt: new Date(),
    },
  })
  return result
}
