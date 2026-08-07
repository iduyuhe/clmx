import { Router } from "express"
import multer from "multer"
import { prisma } from "../../utils/prisma"
import { authMiddleware, requireRole, AuthRequest } from "../../middleware/auth.middleware"
import { config } from "../../utils/config"
import { asyncHandler } from "../../utils/asyncHandler"
import { parseDatasetFile } from "../../utils/fileParser"
import logger from "../../utils/logger"
const router = Router()
const upload = multer({ dest: config.uploadDir, limits: { fileSize: 500 * 1024 * 1024 } })

router.get("/", authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const p = +(req.query.page || 1), ps = +(req.query.pageSize || 20)
  const [data, t] = await Promise.all([
    prisma.dataset.findMany({ where: { tenantId: req.tenantId }, skip: (p-1)*ps, take: ps, orderBy: { createdAt: "desc" } }),
    prisma.dataset.count({ where: { tenantId: req.tenantId } }),
  ])
  res.json({ success: true, data: { data, total: t, page: p, pageSize: ps, totalPages: Math.ceil(t/ps) } })
}))

router.post("/", authMiddleware, requireRole("MANAGER"), asyncHandler(async (req: AuthRequest, res) => {
  if (!req.tenantId) return res.status(401).json({ success: false, message: "未登录" })
  const { name, description, industry, scenario } = req.body
  const ds = await prisma.dataset.create({ data: { tenantId: req.tenantId, name, description, industry, scenario, status: "PROCESSING" } })
  const v = await prisma.dataVersion.create({ data: { datasetId: ds.id, tenantId: ds.tenantId, versionNumber: 1, rowCount: 0 } })
  res.json({ success: true, data: { ...ds, versions: [v] } })
}))

router.post("/:id/upload", authMiddleware, requireRole("MANAGER"), upload.single("file"), asyncHandler(async (req: AuthRequest, res) => {
  const ds = await prisma.dataset.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } })
  if (!ds) return res.status(404).json({ success: false, message: "Not found" })
  if (!req.file) return res.status(400).json({ success: false, message: "No file" })

  // 解析文件内容
  const parsed = parseDatasetFile(req.file.path, req.file.originalname || "")
  const fileSize = req.file.size  // 安全类型：直接用 number

  const updated = await prisma.dataset.update({
    where: { id: ds.id },
    data: {
      format: parsed.format,
      filePath: req.file.path,
      fileSize: BigInt(fileSize),
      rowCount: parsed.rowCount,
      status: "READY",
    },
  })
  await prisma.dataVersion.updateMany({
    where: { datasetId: ds.id, versionNumber: 1 },
    data: { filePath: req.file.path, rowCount: parsed.rowCount },
  })
  res.json({ success: true, data: { ...updated, preview: parsed.preview, headers: parsed.headers } })
}))

router.put("/:id", authMiddleware, requireRole("MANAGER"), asyncHandler(async (req: AuthRequest, res) => {
  const ds = await prisma.dataset.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } })
  if (!ds) return res.status(404).json({ success: false, message: "Not found" })
  const { name, description, industry, scenario } = req.body
  const updated = await prisma.dataset.update({
    where: { id: req.params.id },
    data: { ...(name !== undefined && { name }), ...(description !== undefined && { description }), ...(industry !== undefined && { industry }), ...(scenario !== undefined && { scenario }) },
  })
  res.json({ success: true, data: updated })
}))

router.delete("/:id", authMiddleware, requireRole("MANAGER"), asyncHandler(async (req: AuthRequest, res) => {
  await prisma.dataset.deleteMany({ where: { id: req.params.id, tenantId: req.tenantId } })
  res.json({ success: true, data: null })
}))

/* ---- 版本列表 ---- */
router.get("/:id/versions", authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const versions = await prisma.dataVersion.findMany({
    where: { datasetId: req.params.id, tenantId: req.tenantId },
    orderBy: { versionNumber: "desc" },
  })
  res.json({ success: true, data: versions })
}))

/* ---- 数据预览 ---- */
router.get("/:id/preview", authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const ds = await prisma.dataset.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } })
  if (!ds) return res.status(404).json({ success: false, message: "Not found" })
  if (!ds.filePath) return res.json({ success: true, data: { rowCount: 0, preview: [], headers: [] } })

  try {
    const parsed = parseDatasetFile(ds.filePath, ds.name)
    res.json({ success: true, data: { rowCount: parsed.rowCount, preview: parsed.preview, headers: parsed.headers } })
  } catch (e) {
    logger.warn("Dataset preview parse failed: " + (e as Error).message)
    res.json({ success: true, data: { rowCount: ds.rowCount, preview: [], headers: [] } })
  }
}))

router.get("/:id", authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const ds = await prisma.dataset.findFirst({ where: { id: req.params.id, tenantId: req.tenantId }, include: { versions: { orderBy: { versionNumber: "desc" } } } })
  ds ? res.json({ success: true, data: ds }) : res.status(404).json({ success: false, message: "Not found" })
}))

export default router
