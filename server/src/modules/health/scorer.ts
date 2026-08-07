import fs from 'fs'
import path from 'path'
import { prisma } from '../../utils/prisma'
import { runTimeseriesInference } from '../inference/inference.service'
import { buildWindowedSeries } from '../sensor-data/windowing'

export type HealthLevel = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'FAULT'

export function levelFromScore(score: number): HealthLevel {
  if (score < 40) return 'FAULT'
  if (score < 60) return 'CRITICAL'
  if (score < 80) return 'WARNING'
  return 'HEALTHY'
}

export interface SensorReading {
  name: string
  value: number
  score: number
  timestamp: Date
}

/**
 * 规则评分：基于传感器最新读数与阈值（与原有逻辑一致，抽出便于复用）
 */
export async function computeRuleScore(device: {
  sensors: Array<{
    id: string
    name: string
    status: string
    minThreshold: number | null
    maxThreshold: number | null
    autoBaseline?: boolean
    baselineMin?: number | null
    baselineMax?: number | null
  }>
}): Promise<{ score: number; details: Record<string, SensorReading>; activeSensors: number }> {
  let totalScore = 0
  let activeSensors = 0
  const details: Record<string, SensorReading> = {}

  for (const sensor of device.sensors) {
    if (sensor.status !== 'ACTIVE') continue
    const latest = await prisma.sensorData.findFirst({
      where: { sensorId: sensor.id },
      orderBy: { timestamp: 'desc' },
    })
    if (!latest) continue

    activeSensors++
    let sensorScore = 100

    // 阈值来源：开启自动基线且已有基线值时，使用动态基线阈值替代固定阈值
    let lo: number | null = sensor.minThreshold
    let hi: number | null = sensor.maxThreshold
    if (sensor.autoBaseline && sensor.baselineMin != null && sensor.baselineMax != null) {
      lo = sensor.baselineMin
      hi = sensor.baselineMax
    }

    if (lo !== null && hi !== null) {
      if (latest.value < lo || latest.value > hi) {
        sensorScore = 0
      } else {
        const range = hi - lo
        const center = (hi + lo) / 2
        const deviation = Math.abs(latest.value - center) / (range / 2)
        sensorScore = Math.round(100 * (1 - deviation * 0.5))
      }
    }

    details[sensor.name] = { name: sensor.name, value: latest.value, score: sensorScore, timestamp: latest.timestamp }
    totalScore += sensorScore
  }

  const score = activeSensors > 0 ? Math.round(totalScore / activeSensors) : 100
  return { score, details, activeSensors }
}

/**
 * 模型评分：用已训练工业时序模型对设备传感器最新窗口推理
 * 返回 0-100 分（异常分越低分越高），并保留每传感器的异常窗口信息
 */
export async function computeModelScore(
  tenantId: string,
  device: { sensors: Array<{ id: string; name: string; status: string }> },
  modelVersionId: string,
): Promise<{ score: number; details: Record<string, unknown>; anomalyWindows: number; modelVersionId: string } | null> {
  const version = await prisma.modelVersion.findUnique({
    where: { id: modelVersionId },
    include: { model: true },
  })
  // 校验模型版本存在、租户归属、有 checkpoint
  if (!version || version.model?.tenantId !== tenantId || !version.checkpointPath) return null
  const metaPath = path.join(version.checkpointPath, 'model_meta.json')
  if (!fs.existsSync(metaPath)) return null
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
  const wsize: number = meta.window_size

  const sensors = device.sensors.filter(s => s.status === 'ACTIVE')
  if (sensors.length === 0) return null

  let worstScore = 100
  const perSensor: Record<string, unknown> = {}
  let totalAnomaly = 0

  for (const sensor of sensors) {
    const ws = await buildWindowedSeries(tenantId, { sensorId: sensor.id, windowSize: wsize })
    if (ws.count === 0) {
      perSensor[sensor.name] = { status: 'INSUFFICIENT_DATA' }
      continue
    }
    const inf = await runTimeseriesInference({
      modelVersionId,
      tenantId,
      windows: ws.windows.slice(-20), // 仅推理最近 20 个窗口
    })
    const sensorScores = inf.results.map(r => Math.round(100 * Math.max(0, 1 - r.score / inf.threshold)))
    const sensorScore = sensorScores.length ? Math.min(...sensorScores) : 100
    const anomalyCount = inf.results.filter(r => r.isAnomaly).length
    totalAnomaly += anomalyCount
    worstScore = Math.min(worstScore, sensorScore)
    perSensor[sensor.name] = {
      score: sensorScore,
      anomalyWindows: anomalyCount,
      threshold: inf.threshold,
      lastAnomalyScore: inf.results[inf.results.length - 1]?.score,
    }
  }

  return { score: worstScore, details: perSensor, anomalyWindows: totalAnomaly, modelVersionId }
}

/**
 * 混合评分：规则分 + 模型分
 * 预防性维修以安全优先 —— 取两者最小值（worst-case），并保留分量供展示
 */
export function hybridScore(
  ruleScore: number,
  modelScore: number | null,
): { score: number; ruleScore: number; modelScore: number | null } {
  if (modelScore === null) return { score: ruleScore, ruleScore, modelScore: null }
  return { score: Math.min(ruleScore, modelScore), ruleScore, modelScore }
}
