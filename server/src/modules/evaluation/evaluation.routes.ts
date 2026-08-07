import { Router, Response } from "express"
import { prisma } from "../../utils/prisma"
import { authMiddleware, requireRole, AuthRequest } from "../../middleware/auth.middleware"
import { asyncHandler } from "../../utils/asyncHandler"
import logger from "../../utils/logger"

const router = Router()
router.use(authMiddleware)

router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    const page = +(req.query.page || 1), pageSize = +(req.query.pageSize || 20)
    const modelVersionId = req.query.modelVersionId as string | undefined
    const datasetVersionId = req.query.datasetVersionId as string | undefined
    const status = req.query.status as string | undefined
    const where: Record<string, unknown> = {}
    if (modelVersionId) where.modelVersionId = modelVersionId
    if (datasetVersionId) where.datasetVersionId = datasetVersionId
    if (status) where.status = status
    if (req.tenantId) { where.modelVersion = { model: { tenantId: req.tenantId } } }
    const [items, total] = await Promise.all([
      prisma.evaluation.findMany({ where, include: { modelVersion: { include: { model: true } }, datasetVersion: true }, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.evaluation.count({ where }),
    ])
    res.json({ success: true, data: { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) } })
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown"
    logger.error("获取评估列表失败", { error: message })
    res.status(500).json({ success: false, message: "获取评估列表失败" })
  }
})

router.get("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const evaluation = await prisma.evaluation.findUnique({ where: { id: req.params.id }, include: { modelVersion: { include: { model: true } }, datasetVersion: true } })
    if (!evaluation) return res.status(404).json({ success: false, message: "评估记录不存在" })
    if (req.tenantId && evaluation.modelVersion?.model?.tenantId !== req.tenantId) return res.status(404).json({ success: false, message: "评估记录不存在" })
    res.json({ success: true, data: evaluation })
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown"
    logger.error("获取评估详情失败", { error: message })
    res.status(500).json({ success: false, message: "获取评估详情失败" })
  }
})

router.post("/", requireRole("MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { modelVersionId, datasetVersionId, evalType } = req.body
    if (!modelVersionId || !datasetVersionId) return res.status(400).json({ success: false, message: "modelVersionId 和 datasetVersionId 为必填项" })
    const modelVersion = await prisma.modelVersion.findUnique({ where: { id: modelVersionId }, include: { model: true } })
    if (!modelVersion) return res.status(404).json({ success: false, message: "模型版本不存在" })
    if (req.tenantId && modelVersion.model.tenantId !== req.tenantId) return res.status(403).json({ success: false, message: "无权访问该模型版本" })
    const datasetVersion = await prisma.dataVersion.findUnique({ where: { id: datasetVersionId } })
    if (!datasetVersion) return res.status(404).json({ success: false, message: "数据版本不存在" })
    const evaluation = await prisma.evaluation.create({
      data: { modelVersionId, tenantId: modelVersion.model.tenantId, datasetVersionId, evalType: evalType || "AUTO", status: "PENDING" },
      include: { modelVersion: { include: { model: true } }, datasetVersion: true },
    })
    logger.info("评估创建成功: " + evaluation.id, { modelVersionId, datasetVersionId, evalType: evalType || "AUTO" })
    res.json({ success: true, data: evaluation, message: "评估创建成功" })
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown"
    logger.error("创建评估失败", { error: message })
    res.status(500).json({ success: false, message: "创建评估失败" })
  }
})

router.put("/:id", requireRole("MANAGER"), asyncHandler(async (req: AuthRequest, res: Response) => {
  try {
    const { evalType, status } = req.body
    const evaluation = await prisma.evaluation.findUnique({ where: { id: req.params.id }, include: { modelVersion: { include: { model: true } } } })
    if (!evaluation) return res.status(404).json({ success: false, message: "评估记录不存在" })
    if (req.tenantId && evaluation.modelVersion?.model?.tenantId !== req.tenantId) return res.status(404).json({ success: false, message: "评估记录不存在" })
    const updated = await prisma.evaluation.update({
      where: { id: req.params.id },
      data: { ...(evalType !== undefined && { evalType }), ...(status !== undefined && { status }) },
      include: { modelVersion: { include: { model: true } }, datasetVersion: true },
    })
    res.json({ success: true, data: updated })
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown"
    logger.error("更新评估失败", { error: message })
    res.status(500).json({ success: false, message: "更新评估失败" })
  }
}))

router.delete("/:id", requireRole("MANAGER"), asyncHandler(async (req: AuthRequest, res: Response) => {
  try {
    const evaluation = await prisma.evaluation.findUnique({ where: { id: req.params.id }, include: { modelVersion: { include: { model: true } } } })
    if (!evaluation) return res.status(404).json({ success: false, message: "评估记录不存在" })
    if (req.tenantId && evaluation.modelVersion?.model?.tenantId !== req.tenantId) return res.status(404).json({ success: false, message: "评估记录不存在" })
    await prisma.evaluation.delete({ where: { id: req.params.id } })
    res.json({ success: true, data: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown"
    logger.error("删除评估失败", { error: message })
    res.status(500).json({ success: false, message: "删除评估失败" })
  }
}))

export default router
