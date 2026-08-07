import { Router } from 'express'
import { prisma } from '../../utils/prisma'
import { authMiddleware, requireRole, AuthRequest } from '../../middleware/auth.middleware'
import { asyncHandler } from '../../utils/asyncHandler'
import { buildWindowedSeries } from './windowing'
import { incrementStorageUsed } from '../tenant/quota'
import logger from '../../utils/logger'

const router = Router()

/**
 * GET /api/sensor-data/export
 * 导出传感器时序数据为 CSV
 */
router.get('/export', authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const { sensorId, start, end, limit } = req.query
  if (!sensorId) return res.status(400).json({ success: false, message: '缺少 sensorId 参数' })
  const sensor = await prisma.sensor.findUnique({ where: { id: sensorId as string }, include: { device: true } })
  if (!sensor || sensor.device.tenantId !== req.tenantId) return res.status(404).json({ success: false, message: '传感器不存在或无权访问' })
  const where: any = { sensorId: sensorId as string }
  if (start) where.timestamp = { ...(where.timestamp || {}), gte: new Date(start as string) }
  if (end) where.timestamp = { ...(where.timestamp || {}), lte: new Date(end as string) }
  const data = await prisma.sensorData.findMany({ where, orderBy: { timestamp: 'asc' }, take: Math.min(parseInt(limit as string) || 10000, 50000) })
  const rows = data.map(d => d.timestamp.toISOString() + ',' + d.value + ',' + (d.quality || 'GOOD')).join('\n')
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename=sensor-' + sensor.channel + '-' + Date.now() + '.csv')
  res.send('\uFEFFtimestamp,value,quality\n' + rows)
}))

// 写入单条传感器数据
router.post('/ingest', authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const { sensorId, value, timestamp, quality } = req.body
  if (!sensorId || value === undefined) return res.status(400).json({ success: false, message: 'sensorId 和 value 不能为空' })

  // 验证传感器属于当前租户的设备
  const sensor = await prisma.sensor.findUnique({
    where: { id: sensorId },
    include: { device: true },
  })
  if (!sensor || sensor.device.tenantId !== req.tenantId) {
    return res.status(404).json({ success: false, message: '传感器不存在' })
  }

  const dataPoint = await prisma.sensorData.create({
    data: {
      sensorId,
      tenantId: sensor.device.tenantId,
      value: parseFloat(value),
      quality: quality || 'GOOD',
      timestamp: timestamp ? new Date(timestamp) : new Date(),
    },
  })
  res.json({ success: true, data: dataPoint })
}))

// 批量写入传感器数据
router.post('/ingest/batch', authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const { sensorId, data } = req.body as { sensorId: string; data: { value: number; timestamp?: string; quality?: string }[] }
  if (!sensorId || !Array.isArray(data) || data.length === 0) {
    return res.status(400).json({ success: false, message: 'sensorId 和 data 数组不能为空' })
  }

  const sensor = await prisma.sensor.findUnique({
    where: { id: sensorId },
    include: { device: true },
  })
  if (!sensor || sensor.device.tenantId !== req.tenantId) {
    return res.status(404).json({ success: false, message: '传感器不存在' })
  }

  // 配额检查：累加存储用量，超套餐上限返回 429
  try {
    await incrementStorageUsed(sensor.device.tenantId, data.length)
  } catch (e: any) {
    if (e && e.kind === 'storage') return res.status(429).json({ success: false, message: e.message })
    throw e
  }

  // 批量写入（每批最多 1000 条）
  const batchSize = 1000
  let inserted = 0
  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize)
    const result = await prisma.sensorData.createMany({
      data: batch.map(d => ({
        sensorId,
        tenantId: sensor.device.tenantId,
        value: parseFloat(String(d.value)),
        quality: d.quality || 'GOOD',
        timestamp: d.timestamp ? new Date(d.timestamp) : new Date(),
      })),
    })
    inserted += result.count
  }

  logger.info(`传感器数据批量写入: ${sensorId}, ${inserted} 条`, { userId: req.userId })
  res.json({ success: true, data: { inserted } })
}))

// 查询传感器时序数据
router.get('/query', authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const { sensorId, start, end, limit } = req.query
  if (!sensorId) return res.status(400).json({ success: false, message: 'sensorId 不能为空' })

  const sensor = await prisma.sensor.findUnique({
    where: { id: sensorId as string },
    include: { device: true },
  })
  if (!sensor || sensor.device.tenantId !== req.tenantId) {
    return res.status(404).json({ success: false, message: '传感器不存在' })
  }

  const where: Record<string, unknown> = { sensorId: sensorId as string }
  if (start || end) {
    where.timestamp = {}
    if (start) (where.timestamp as Record<string, unknown>).gte = new Date(start as string)
    if (end) (where.timestamp as Record<string, unknown>).lte = new Date(end as string)
  }

  const data = await prisma.sensorData.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: Math.min(+(limit || 1000), 10000),
  })

  res.json({ success: true, data: { sensor, dataPoints: data.reverse() } })
}))

// 获取传感器最新读数
router.get('/latest/:sensorId', authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const sensor = await prisma.sensor.findUnique({
    where: { id: req.params.sensorId },
    include: { device: true },
  })
  if (!sensor || sensor.device.tenantId !== req.tenantId) {
    return res.status(404).json({ success: false, message: '传感器不存在' })
  }

  const latest = await prisma.sensorData.findFirst({
    where: { sensorId: req.params.sensorId },
    orderBy: { timestamp: 'desc' },
  })
  res.json({ success: true, data: { sensor, latest } })
}))

// 导出时序窗口化数据（供训练管线构建数据集：滑动窗口序列 + 可选统计特征）
router.get('/export/windows', authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const { sensorId, start, end, windowSize, step, features } = req.query
  if (!sensorId) return res.status(400).json({ success: false, message: 'sensorId 不能为空' })

  const result = await buildWindowedSeries(req.tenantId as string, {
    sensorId: sensorId as string,
    start: start as string,
    end: end as string,
    windowSize: +(windowSize as string),
    step: +(step as string),
    features: features === 'true',
  })

  res.json({ success: true, data: result })
}))

export default router
