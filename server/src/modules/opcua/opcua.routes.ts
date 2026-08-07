/**
 * CLMX OPC-UA 接入管理端点
 *   GET  /api/opcua/status          当前连接状态
 *   POST /api/opcua/connect         动态连接 OPC-UA 服务端（需 endpoint + 节点→传感器映射）
 *   POST /api/opcua/disconnect      断开
 */
import { Router } from 'express'
import { prisma } from '../../utils/prisma'
import { authMiddleware, requireRole, AuthRequest } from '../../middleware/auth.middleware'
import { asyncHandler } from '../../utils/asyncHandler'
import { connectOpcua, disconnectOpcua, opcuaStatus } from './opcua.adapter'

const router = Router()

router.get('/status', authMiddleware, asyncHandler(async (_req: AuthRequest, res) => {
  res.json({ success: true, data: opcuaStatus() })
}))

router.post('/connect', authMiddleware, requireRole('ADMIN'), asyncHandler(async (req: AuthRequest, res) => {
  const { endpoint, mappings, intervalMs } = req.body || {}
  if (!endpoint || typeof endpoint !== 'string') {
    return res.status(400).json({ success: false, message: '缺少 endpoint' })
  }
  if (!Array.isArray(mappings) || mappings.length === 0) {
    return res.status(400).json({ success: false, message: 'mappings 不能为空' })
  }

  const resolved: { nodeId: string; sensorId: string; tenantId: string }[] = []
  for (const m of mappings) {
    if (!m.nodeId || !m.sensorId) {
      return res.status(400).json({ success: false, message: '每条 mapping 需含 nodeId 与 sensorId' })
    }
    const sensor = await prisma.sensor.findUnique({ where: { id: m.sensorId }, include: { device: true } })
    if (!sensor || sensor.device.tenantId !== req.tenantId) {
      return res.status(404).json({ success: false, message: `传感器 ${m.sensorId} 不存在或无权限` })
    }
    resolved.push({ nodeId: m.nodeId, sensorId: sensor.id, tenantId: sensor.device.tenantId })
  }

  const result = await connectOpcua({ endpoint, mappings: resolved, intervalMs })
  res.json({ success: true, data: result, message: 'OPC-UA 已连接并开始摄入' })
}))

router.post('/disconnect', authMiddleware, requireRole('ADMIN'), asyncHandler(async (_req: AuthRequest, res) => {
  await disconnectOpcua()
  res.json({ success: true, message: 'OPC-UA 已断开' })
}))

export default router
