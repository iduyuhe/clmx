import { Router } from 'express'
import { prisma } from '../../utils/prisma'
import { authMiddleware, requireRole, AuthRequest } from '../../middleware/auth.middleware'
import { asyncHandler } from '../../utils/asyncHandler'
import multer from 'multer'
import XLSX from 'xlsx'
import path from 'path'
import fs from 'fs'
import logger from '../../utils/logger'

const router = Router()
const upload = multer({ dest: path.resolve(process.cwd(), 'uploads', 'excel_import') })

/**
 * @openapi
 * /api/devices:
 *   get:
 *     tags: [设备]
 *     summary: 设备列表（分页）
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer }
 *       - in: query
 *         name: keyword
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [RUNNING, STOPPED, MAINTENANCE, FAULT] }
 *     responses:
 *       200:
 *         description: 设备分页列表
 *   post:
 *     tags: [设备]
 *     summary: 创建设备
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, code]
 *             properties:
 *               name: { type: string }
 *               code: { type: string }
 *               category: { type: string }
 *               manufacturer: { type: string }
 *               modelNumber: { type: string }
 *               location: { type: string }
 *     responses: { 200: { description: 创建设备成功 } }
 */
// 设备列表（分页 + 筛选）
router.get('/', authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const p = +(req.query.page || 1), ps = +(req.query.pageSize || 20)
  const where: Record<string, unknown> = { tenantId: req.tenantId }
  if (req.query.category) where.category = req.query.category
  if (req.query.status) where.status = req.query.status
  if (req.query.keyword) where.name = { contains: req.query.keyword as string }

  const [data, total] = await Promise.all([
    prisma.device.findMany({
      where,
      skip: (p - 1) * ps,
      take: ps,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { sensors: true, maintenanceOrders: true } } },
    }),
    prisma.device.count({ where }),
  ])
  res.json({ success: true, data: { data, total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) } })
}))

// 当前租户全部传感器（供 OPC-UA / 摄入映射等选择）
router.get('/sensors', authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const sensors = await prisma.sensor.findMany({
    where: { tenantId: req.tenantId },
    orderBy: { createdAt: 'asc' },
    include: { device: { select: { id: true, name: true, code: true } } },
  })
  res.json({ success: true, data: sensors })
}))

/**
 * GET /api/devices/export
 * 导出设备清单为 CSV
 */
router.get('/export', authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const devices = await prisma.device.findMany({
    where: { tenantId: req.tenantId },
    orderBy: { createdAt: 'asc' },
    include: { sensors: true },
  })
  const header = 'name,code,category,manufacturer,modelNumber,location,status,installDate,sensorCount\n'
  const rows = devices.map(d => {
    const vals = [d.name, d.code, d.category, d.manufacturer || '', d.modelNumber || '', d.location || '', d.status]
    if (d.installDate) vals.push(d.installDate.toISOString().split('T')[0])
    else vals.push('')
    vals.push(String(d.sensors.length))
    return vals.join(',')
  }).join('\n')
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename=clmx-devices-export.csv')
  res.send('\uFEFF' + header + rows)
}))

/**
 * GET /api/devices/import-template
 * 下载批量导入 Excel 模板（无鉴权，公开下载）
 */
router.get('/import-template', asyncHandler(async (req, res) => {
  const wb = XLSX.utils.book_new()
  const devData = [['name', 'code', 'category', 'manufacturer', 'modelNumber', 'location']]
  devData.push(['示例风机', 'FAN-001', 'fan', '沈鼓集团', 'G4-73', 'A区1号车间'])
  devData.push(['示例泵', 'PUMP-001', 'pump', '凯泉泵业', 'KQSN', 'B区2号车间'])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(devData), '设备')
  const sensData = [['deviceCode', 'name', 'channel', 'unit', 'minThreshold', 'maxThreshold']]
  sensData.push(['FAN-001', '振动', 'vib', 'mm/s', '0', '8'])
  sensData.push(['FAN-001', '温度', 'temp', '℃', '0', '95'])
  sensData.push(['PUMP-001', '压力', 'pres', 'bar', '0', '12'])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sensData), '传感器')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename=clmx-device-import-template.xlsx')
  res.send(buf)
}))

// 设备详情
router.get('/:id', authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const device = await prisma.device.findFirst({
    where: { id: req.params.id, tenantId: req.tenantId },
    include: {
      sensors: { orderBy: { createdAt: 'asc' } },
      healthScores: { orderBy: { createdAt: 'desc' }, take: 20 },
      maintenanceOrders: { orderBy: { createdAt: 'desc' }, take: 10 },
    },
  })
  if (!device) return res.status(404).json({ success: false, message: '设备不存在' })
  res.json({ success: true, data: device })
}))

// 创建设备
router.post('/', authMiddleware, requireRole('MANAGER'), asyncHandler(async (req: AuthRequest, res) => {
  if (!req.tenantId) return res.status(401).json({ success: false, message: '未登录' })
  const { name, code, category, manufacturer, modelNumber, location, installDate, description } = req.body
  if (!name || !code) return res.status(400).json({ success: false, message: '设备名称和编码不能为空' })

  const existing = await prisma.device.findFirst({ where: { tenantId: req.tenantId, code } })
  if (existing) return res.status(409).json({ success: false, message: '设备编码已存在' })

  const device = await prisma.device.create({
    data: {
      tenantId: req.tenantId,
      name, code,
      category: category || 'other',
      manufacturer, modelNumber, location,
      installDate: installDate ? new Date(installDate) : null,
      description,
    },
  })
  logger.info(`设备创建: ${device.name} (${device.code})`, { userId: req.userId, deviceId: device.id })
  res.json({ success: true, data: device })
}))

// 更新设备
router.put('/:id', authMiddleware, requireRole('MANAGER'), asyncHandler(async (req: AuthRequest, res) => {
  const device = await prisma.device.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } })
  if (!device) return res.status(404).json({ success: false, message: '设备不存在' })

  const { name, category, manufacturer, modelNumber, location, installDate, description, status } = req.body
  const updated = await prisma.device.update({
    where: { id: req.params.id },
    data: { name, category, manufacturer, modelNumber, location, installDate: installDate ? new Date(installDate) : undefined, description, status },
  })
  res.json({ success: true, data: updated })
}))

// 删除设备
router.delete('/:id', authMiddleware, requireRole('ADMIN'), asyncHandler(async (req: AuthRequest, res) => {
  const device = await prisma.device.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } })
  if (!device) return res.status(404).json({ success: false, message: '设备不存在' })

  await prisma.device.delete({ where: { id: req.params.id } })
  res.json({ success: true, message: '设备已删除' })
}))

// ─── 传感器管理 ─────────────────────────────────────

// 获取设备下所有传感器
router.get('/:id/sensors', authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const device = await prisma.device.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } })
  if (!device) return res.status(404).json({ success: false, message: '设备不存在' })

  const sensors = await prisma.sensor.findMany({
    where: { deviceId: req.params.id },
    orderBy: { createdAt: 'asc' },
  })
  res.json({ success: true, data: sensors })
}))

// 添加传感器
router.post('/:id/sensors', authMiddleware, requireRole('MANAGER'), asyncHandler(async (req: AuthRequest, res) => {
  const device = await prisma.device.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } })
  if (!device) return res.status(404).json({ success: false, message: '设备不存在' })

  const { name, channel, unit, samplingRate, minThreshold, maxThreshold, autoBaseline } = req.body
  if (!name || !channel) return res.status(400).json({ success: false, message: '传感器名称和通道不能为空' })

  const sensor = await prisma.sensor.create({
    data: {
      deviceId: req.params.id,
      tenantId: device.tenantId,
      name, channel,
      unit: unit || '',
      samplingRate: samplingRate || 1,
      minThreshold, maxThreshold,
      autoBaseline: autoBaseline ?? false,
    },
  })
  res.json({ success: true, data: sensor })
}))

// 更新传感器
router.put('/:id/sensors/:sensorId', authMiddleware, requireRole('MANAGER'), asyncHandler(async (req: AuthRequest, res) => {
  // P0 修复: 先验证传感器所属设备属于当前租户
  const sensor = await prisma.sensor.findFirst({
    where: { id: req.params.sensorId, deviceId: req.params.id, device: { tenantId: req.tenantId } },
  })
  if (!sensor) return res.status(404).json({ success: false, message: '传感器不存在' })

  const { name, channel, unit, samplingRate, minThreshold, maxThreshold, status, autoBaseline } = req.body
  const updated = await prisma.sensor.update({
    where: { id: req.params.sensorId },
    data: { name, channel, unit, samplingRate, minThreshold, maxThreshold, status, autoBaseline },
  })
  res.json({ success: true, data: updated })
}))

// 删除传感器
router.delete('/:id/sensors/:sensorId', authMiddleware, requireRole('MANAGER'), asyncHandler(async (req: AuthRequest, res) => {
  // P0 修复: 先验证传感器所属设备属于当前租户
  const sensor = await prisma.sensor.findFirst({
    where: { id: req.params.sensorId, deviceId: req.params.id, device: { tenantId: req.tenantId } },
  })
  if (!sensor) return res.status(404).json({ success: false, message: '传感器不存在' })

  await prisma.sensor.delete({ where: { id: req.params.sensorId } })
  res.json({ success: true, message: '传感器已删除' })
}))

// 设备统计摘要
router.get('/stats/summary', authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const [total, running, maintenance, fault, sensors] = await Promise.all([
    prisma.device.count({ where: { tenantId: req.tenantId } }),
    prisma.device.count({ where: { tenantId: req.tenantId, status: 'RUNNING' } }),
    prisma.device.count({ where: { tenantId: req.tenantId, status: 'MAINTENANCE' } }),
    prisma.device.count({ where: { tenantId: req.tenantId, status: 'FAULT' } }),
    prisma.sensor.count({
      where: { device: { tenantId: req.tenantId } },
    }),
  ])
  res.json({ success: true, data: { total, running, maintenance, fault, sensors } })
}))

/**
 * POST /api/devices/import-excel
 * 批量导入设备和传感器（Excel 格式）
 */
router.post('/import-excel', authMiddleware, requireRole('MANAGER'), upload.single('file'), asyncHandler(async (req: AuthRequest, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: '请上传 Excel 文件' })
  const tenantId = req.tenantId!
  let workbook
  try {
    workbook = XLSX.readFile(req.file.path)
  } catch (e: any) {
    return res.status(400).json({ success: false, message: `文件解析失败: ${e.message}` })
  } finally {
    fs.unlink(req.file.path, () => {})
  }
  const result: any = { devices: { total: 0, created: 0, skipped: 0, errors: [] }, sensors: { total: 0, created: 0, skipped: 0, errors: [] } }
  const devSheet = workbook.Sheets['设备'] || workbook.Sheets[workbook.SheetNames[0]]
  if (devSheet) {
    const devRows: any[] = XLSX.utils.sheet_to_json(devSheet)
    result.devices.total = devRows.length
    for (const row of devRows) {
      if (!row.name) { result.devices.skipped++; continue }
      try {
        const existing = row.code ? await prisma.device.findFirst({ where: { tenantId, code: row.code } }) : null
        if (existing) { result.devices.skipped++; continue }
        await prisma.device.create({ data: { tenantId, name: row.name, code: row.code || `imp-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, category: row.category || 'generic', manufacturer: row.manufacturer || '', modelNumber: row.modelNumber || '', location: row.location || '', status: 'RUNNING', installDate: new Date() } })
        result.devices.created++
      } catch (e: any) { result.devices.errors.push(`设备「${row.name}」: ${e.message}`) }
    }
  }
  const sensSheet = workbook.Sheets['传感器'] || (workbook.SheetNames.length > 1 ? workbook.Sheets[workbook.SheetNames[1]] : null)
  if (sensSheet) {
    const sensRows: any[] = XLSX.utils.sheet_to_json(sensSheet)
    result.sensors.total = sensRows.length
    for (const row of sensRows) {
      if (!row.deviceCode || !row.name || !row.channel) { result.sensors.skipped++; continue }
      try {
        const device = await prisma.device.findFirst({ where: { tenantId, code: row.deviceCode } })
        if (!device) { result.sensors.errors.push(`传感器「${row.name}」: 设备 ${row.deviceCode} 不存在`); continue }
        await prisma.sensor.create({ data: { tenantId, deviceId: device.id, name: row.name, channel: row.channel, unit: row.unit || '', samplingRate: 1, minThreshold: row.minThreshold != null ? Number(row.minThreshold) : 0, maxThreshold: row.maxThreshold != null ? Number(row.maxThreshold) : 100, status: 'ACTIVE' } })
        result.sensors.created++
      } catch (e: any) { result.sensors.errors.push(`传感器「${row.name}」: ${e.message}`) }
    }
  }
  res.json({ success: true, data: result, message: `设备: ${result.devices.created} 创建 / ${result.devices.skipped} 跳过 / ${result.devices.errors.length} 错误；传感器: ${result.sensors.created} 创建 / ${result.sensors.skipped} 跳过 / ${result.sensors.errors.length} 错误` })
}))

export default router
