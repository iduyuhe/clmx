import { prisma } from '../../utils/prisma'

export interface WindowingParams {
  sensorId: string
  start?: string
  end?: string
  windowSize?: number
  step?: number
  features?: boolean
}

export interface WindowingResult {
  sensorId: string
  windowSize: number
  step: number
  count: number
  windows: number[][]
  features?: Array<Record<string, unknown>>
}

/**
 * 从传感器散点时序数据构造滑动窗口序列 —— 工业训练/推理的统一数据源。
 * 包含租户校验：传感器必须属于传入 tenantId 的设备。
 */
export async function buildWindowedSeries(tenantId: string, params: WindowingParams): Promise<WindowingResult> {
  const sensor = await prisma.sensor.findUnique({
    where: { id: params.sensorId },
    include: { device: true },
  })
  if (!sensor || sensor.device.tenantId !== tenantId) {
    throw new Error('传感器不存在或无权访问')
  }

  const ws = Math.max(2, Math.min(params.windowSize ?? 24, 1000))
  const st = Math.max(1, Math.min(params.step ?? ws, ws))

  const where: Record<string, unknown> = { sensorId: params.sensorId }
  if (params.start || params.end) {
    where.timestamp = {}
    if (params.start) (where.timestamp as Record<string, unknown>).gte = new Date(params.start)
    if (params.end) (where.timestamp as Record<string, unknown>).lte = new Date(params.end)
  }

  const points = await prisma.sensorData.findMany({
    where,
    orderBy: { timestamp: 'asc' },
    take: Math.min(ws * 10000, 200000),
    select: { timestamp: true, value: true, quality: true },
  })

  const windows: number[][] = []
  const statFeatures: Array<Record<string, unknown>> = []
  const useFeatures = params.features ?? false
  for (let i = 0; i + ws <= points.length; i += st) {
    const slice = points.slice(i, i + ws)
    const values = slice.map((p: { value: number }) => p.value)
    windows.push(values)
    if (useFeatures) {
      const mean = values.reduce((a, b) => a + b, 0) / values.length
      const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
      statFeatures.push({
        startTs: slice[0].timestamp,
        endTs: slice[slice.length - 1].timestamp,
        mean: +mean.toFixed(4),
        std: +Math.sqrt(variance).toFixed(4),
        min: +Math.min(...values).toFixed(4),
        max: +Math.max(...values).toFixed(4),
      })
    }
  }

  return {
    sensorId: params.sensorId,
    windowSize: ws,
    step: st,
    count: windows.length,
    windows,
    features: useFeatures ? statFeatures : undefined,
  }
}
