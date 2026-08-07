import { Router } from 'express'
import { prisma } from '../../utils/prisma'
import { authMiddleware, requireRole, AuthRequest } from '../../middleware/auth.middleware'
import { asyncHandler } from '../../utils/asyncHandler'
import logger from '../../utils/logger'
import { computeRuleScore, computeModelScore, hybridScore, levelFromScore } from './scorer'
import { recomputeSensorBaseline } from './baseline.service'
import { dispatchAlert } from '../notifications/notification.service'

const router = Router()

// 获取设备健康评分历史
router.get('/device/:deviceId/history', authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const device = await prisma.device.findFirst({ where: { id: req.params.deviceId, tenantId: req.tenantId } })
  if (!device) return res.status(404).json({ success: false, message: '设备不存在' })

  const limit = Math.min(+(req.query.limit || 100), 1000)
  const scores = await prisma.healthScore.findMany({
    where: { deviceId: req.params.deviceId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  res.json({ success: true, data: scores.reverse() })
}))

// 手动计算并记录设备健康评分（规则 + 可选工业模型混合）
router.post('/device/:deviceId/calculate', authMiddleware, requireRole('MANAGER'), asyncHandler(async (req: AuthRequest, res) => {
  const { modelVersionId } = req.body as { modelVersionId?: string }
  const device = await prisma.device.findFirst({
    where: { id: req.params.deviceId, tenantId: req.tenantId },
    include: { sensors: true },
  })
  if (!device) return res.status(404).json({ success: false, message: '设备不存在' })

  // 1) 规则评分（传感器阈值）
  const rule = await computeRuleScore(device)

  // 2) 模型评分（可选：已训练工业时序模型）
  let modelInfo: Awaited<ReturnType<typeof computeModelScore>> = null
  if (modelVersionId) {
    const m = await computeModelScore(req.tenantId as string, device, modelVersionId)
    if (!m) {
      return res.status(400).json({ success: false, message: '指定的模型版本不可用（不存在、无权访问或缺少模型文件）' })
    }
    modelInfo = m
  }

  // 3) 混合（安全优先：取规则分与模型分的最小值）
  const hybrid = hybridScore(rule.score, modelInfo ? modelInfo.score : null)
  const score = hybrid.score
  const level = levelFromScore(score)

  const details: Record<string, unknown> = {
    ruleScore: hybrid.ruleScore,
    modelScore: hybrid.modelScore,
    modelVersionId: modelInfo?.modelVersionId || null,
    rule: rule.details,
  }
  if (modelInfo) details.model = modelInfo.details

  const healthScore = await prisma.healthScore.create({
    data: {
      deviceId: device.id,
      tenantId: device.tenantId,
      score,
      level,
      modelVersionId: modelInfo?.modelVersionId || null,
      details: JSON.stringify(details),
    },
  })

  // 更新设备最新健康评分
  await prisma.device.update({
    where: { id: device.id },
    data: { lastHealthScore: score },
  })

  // 如果健康评分低于阈值，自动创建维修工单（防风暴去重）
  let autoWorkOrder: { created: boolean; skipped: boolean; orderId?: string } = { created: false, skipped: false }
  if (score < 60) {
    // 防风暴：同一设备、未关闭、近 60 分钟内已建过同类预警工单则跳过，避免重复刷单
    const RECENT_WINDOW_MS = 60 * 60 * 1000
    const recentOpen = await prisma.maintenanceOrder.findFirst({
      where: {
        tenantId: req.tenantId!,
        deviceId: device.id,
        status: { in: ['PENDING', 'ASSIGNED', 'IN_PROGRESS'] },
        createdAt: { gte: new Date(Date.now() - RECENT_WINDOW_MS) },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (recentOpen) {
      autoWorkOrder = { created: false, skipped: true, orderId: recentOpen.id }
      logger.info(`设备健康预警已存在未关闭工单，防风暴跳过: ${device.name}`, { userId: req.userId, deviceId: device.id, existingOrderId: recentOpen.id })
    } else {
      const order = await prisma.maintenanceOrder.create({
        data: {
          tenantId: req.tenantId!,
          deviceId: device.id,
          type: 'PREVENTIVE',
          priority: score < 40 ? 'CRITICAL' : 'HIGH',
          title: `${device.name} 健康预警 - 评分 ${score}`,
          description: `设备健康评分降至 ${score}（${level}），需要安排检查。规则分:${hybrid.ruleScore} 模型分:${hybrid.modelScore ?? '-'}。详情：${JSON.stringify(details)}`,
          healthScore: score,
        },
      })
      autoWorkOrder = { created: true, skipped: false, orderId: order.id }
      logger.warn(`设备健康预警自动创建工单: ${device.name}, 评分 ${score}`, { userId: req.userId, deviceId: device.id, orderId: order.id })
      // 告警投递：站内信 + 外部通道（不影响工单创建）
      await dispatchAlert({
        tenantId: req.tenantId!,
        title: `${device.name} 健康预警`,
        body: `设备健康评分降至 ${score}（${level}），已自动创建${score < 40 ? '紧急' : '高优先级'}维修工单，请及时处理。`,
        level: score < 40 ? 'CRITICAL' : 'WARNING',
        type: 'MAINTENANCE',
        relatedId: device.id,
        link: `/devices/${device.id}`,
      })
    }
  }

  res.json({ success: true, data: { ...healthScore, level, ruleScore: hybrid.ruleScore, modelScore: hybrid.modelScore, autoWorkOrder } })
}))

// ─── 自动基线（P0-1） ──────────────────────────────

// 计算并写回某传感器的自动基线阈值
router.post('/sensors/:sensorId/baseline/recompute', authMiddleware, requireRole('MANAGER'), asyncHandler(async (req: AuthRequest, res) => {
  const sensor = await prisma.sensor.findFirst({
    where: { id: req.params.sensorId, device: { tenantId: req.tenantId } },
  })
  if (!sensor) return res.status(404).json({ success: false, message: '传感器不存在' })
  const { days, k } = req.body as { days?: number; k?: number }
  const result = await recomputeSensorBaseline(req.params.sensorId, { days, k })
  if (!result) return res.status(400).json({ success: false, message: '基线计算失败' })
  res.json({ success: true, data: result })
}))

// 读取传感器当前基线
router.get('/sensors/:sensorId/baseline', authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const sensor = await prisma.sensor.findFirst({
    where: { id: req.params.sensorId, device: { tenantId: req.tenantId } },
    select: { id: true, name: true, autoBaseline: true, baselineMin: true, baselineMax: true, baselineMean: true, baselineStd: true, baselineSamples: true, baselineUpdatedAt: true },
  })
  if (!sensor) return res.status(404).json({ success: false, message: '传感器不存在' })
  res.json({ success: true, data: sensor })
}))

// ─── 告警规则 ─────────────────────────────────────

// 告警规则列表
router.get('/rules', authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const where: Record<string, unknown> = { tenantId: req.tenantId }
  if (req.query.deviceId) where.deviceId = req.query.deviceId

  const rules = await prisma.alertRule.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { sensor: { select: { id: true, name: true } } },
  })
  res.json({ success: true, data: rules })
}))

// 创建告警规则
router.post('/rules', authMiddleware, requireRole('MANAGER'), asyncHandler(async (req: AuthRequest, res) => {
  if (!req.tenantId) return res.status(401).json({ success: false, message: '未登录' })
  const { name, deviceId, sensorId, ruleType, condition, severity } = req.body
  if (!name || !condition) return res.status(400).json({ success: false, message: '规则名称和条件不能为空' })

  const rule = await prisma.alertRule.create({
    data: {
      tenantId: req.tenantId,
      name, deviceId, sensorId,
      ruleType: ruleType || 'THRESHOLD',
      condition: typeof condition === 'string' ? condition : JSON.stringify(condition),
      severity: severity || 'WARNING',
    },
  })
  res.json({ success: true, data: rule })
}))

// 更新告警规则
router.put('/rules/:id', authMiddleware, requireRole('MANAGER'), asyncHandler(async (req: AuthRequest, res) => {
  const rule = await prisma.alertRule.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } })
  if (!rule) return res.status(404).json({ success: false, message: '规则不存在' })

  const { name, condition, severity, isEnabled } = req.body
  const updated = await prisma.alertRule.update({
    where: { id: req.params.id },
    data: { name, condition, severity, isEnabled },
  })
  res.json({ success: true, data: updated })
}))

// 删除告警规则
router.delete('/rules/:id', authMiddleware, requireRole('ADMIN'), asyncHandler(async (req: AuthRequest, res) => {
  // P1 修复: 先验证规则属于当前租户
  const rule = await prisma.alertRule.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } })
  if (!rule) return res.status(404).json({ success: false, message: '规则不存在' })
  await prisma.alertRule.delete({ where: { id: req.params.id } })
  res.json({ success: true, message: '规则已删除' })
}))

// 设备健康概览看板
router.get('/dashboard', authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const [devices, recentAlerts, criticalDevices] = await Promise.all([
    prisma.device.findMany({
      where: { tenantId: req.tenantId },
      select: { id: true, name: true, code: true, status: true, lastHealthScore: true, category: true },
      orderBy: { lastHealthScore: 'asc' },
    }),
    prisma.maintenanceOrder.findMany({
      where: { tenantId: req.tenantId, status: { in: ['PENDING', 'IN_PROGRESS'] } },
      include: { device: { select: { name: true, code: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.device.count({
      where: { tenantId: req.tenantId, lastHealthScore: { lt: 60 } },
    }),
  ])
  res.json({ success: true, data: { devices, recentAlerts, criticalDevices } })
}))

export default router
