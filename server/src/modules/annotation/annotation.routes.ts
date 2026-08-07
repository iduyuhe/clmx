import { Router } from 'express'
import { prisma } from '../../utils/prisma'
import { authMiddleware, requireRole, AuthRequest } from '../../middleware/auth.middleware'
import logger from '../../utils/logger'
const router = Router()

/** 获取标注进度汇总 */
router.get('/:datasetId/annotations/summary', authMiddleware, async (req: AuthRequest, res) => {
  const ds = await prisma.dataset.findFirst({ where: { id: req.params.datasetId, tenantId: req.tenantId } })
  if (!ds) return res.status(404).json({ success: false, message: 'Not found' })

  const versionId = req.query.versionId as string || (ds as any).latestVersionId

  const [completed, pending, rejected, totalRows] = await Promise.all([
    prisma.annotation.count({ where: { datasetId: ds.id, versionId, status: 'COMPLETED' } }),
    prisma.annotation.count({ where: { datasetId: ds.id, versionId, status: 'PENDING' } }),
    prisma.annotation.count({ where: { datasetId: ds.id, versionId, status: 'REJECTED' } }),
    Promise.resolve(ds.rowCount || 0),
  ])

  res.json({
    success: true,
    data: { totalRows, completed, pending, rejected },
  })
})

/** 获取标注列表（分页） */
router.get('/:datasetId/annotations', authMiddleware, async (req: AuthRequest, res) => {
  const ds = await prisma.dataset.findFirst({ where: { id: req.params.datasetId, tenantId: req.tenantId } })
  if (!ds) return res.status(404).json({ success: false, message: 'Not found' })

  const versionId = (req.query.versionId as string) || ''
  if (!versionId) return res.status(400).json({ success: false, message: 'versionId is required' })

  const p = +(req.query.page || 1), ps = +(req.query.pageSize || 20)
  const statusFilter = req.query.status as string

  const where: any = { datasetId: ds.id, versionId }
  if (statusFilter && statusFilter !== 'ALL') where.status = statusFilter

  const [data, total] = await Promise.all([
    prisma.annotation.findMany({
      where,
      skip: (p - 1) * ps,
      take: ps,
      orderBy: { dataIndex: 'asc' },
      include: { annotator: { select: { id: true, name: true } } },
    }),
    prisma.annotation.count({ where }),
  ])

  res.json({
    success: true,
    data: { data, total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) },
  })
})

/** 创建/更新标注（upsert by datasetId + versionId + dataIndex） */
router.post('/:datasetId/annotations', authMiddleware, requireRole('ANNOTATOR'), async (req: AuthRequest, res) => {
  const ds = await prisma.dataset.findFirst({ where: { id: req.params.datasetId, tenantId: req.tenantId } })
  if (!ds) return res.status(404).json({ success: false, message: 'Not found' })

  const { versionId, dataIndex, annotationType, annotationData } = req.body
  if (versionId == null || dataIndex == null) {
    return res.status(400).json({ success: false, message: 'versionId and dataIndex are required' })
  }

  // 查找已有标注
  const existing = await prisma.annotation.findFirst({
    where: { datasetId: ds.id, versionId, dataIndex: Number(dataIndex) },
  })

  const annotationDataStr = annotationData ? JSON.stringify(annotationData) : '{}'

  let annotation
  if (existing) {
    annotation = await prisma.annotation.update({
      where: { id: existing.id },
      data: {
        annotationType: annotationType || existing.annotationType,
        annotationData: annotationDataStr,
        status: 'COMPLETED',
        annotatorId: req.userId as string,
      },
      include: { annotator: { select: { id: true, name: true } } },
    })
  } else {
    annotation = await prisma.annotation.create({
      data: {
        datasetId: ds.id,
        tenantId: ds.tenantId,
        versionId,
        dataIndex: Number(dataIndex),
        annotationType: annotationType || 'classification',
        annotationData: annotationDataStr,
        status: 'COMPLETED',
        annotatorId: req.userId as string,
      },
      include: { annotator: { select: { id: true, name: true } } },
    })
  }

  // 解析返回给前端
  if (annotation) {
    try { (annotation as Record<string, unknown>).annotationData = JSON.parse(annotation.annotationData) } catch (e) { logger.debug('annotationData parse failed: ' + (e as Error).message) }
  }

  res.json({ success: true, data: annotation })
})

/** 删除标注 */
router.delete('/:datasetId/annotations/:annotationId', authMiddleware, requireRole('ANNOTATOR'), async (req: AuthRequest, res) => {
  // P1 修复: 先验证 dataset 属于当前租户，防止越权删除他人标注
  const ds = await prisma.dataset.findFirst({ where: { id: req.params.datasetId, tenantId: req.tenantId } })
  if (!ds) return res.status(404).json({ success: false, message: 'Not found' })

  const a = await prisma.annotation.findFirst({
    where: { id: req.params.annotationId, datasetId: req.params.datasetId },
  })
  if (!a) return res.status(404).json({ success: false, message: 'Not found' })

  await prisma.annotation.delete({ where: { id: req.params.annotationId } })
  res.json({ success: true })
})

export default router
