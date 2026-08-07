import { Router } from "express"
import { prisma } from "../../utils/prisma"
import { authMiddleware, requireRole, AuthRequest } from "../../middleware/auth.middleware"
import { asyncHandler } from "../../utils/asyncHandler"

const router = Router()

// ─── 列表 ───────────────────────────────────────────
router.get("/", authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  if (!req.tenantId) return res.status(401).json({ success: false, message: "未登录" })
  const page = Number(req.query.page) || 1
  const pageSize = Number(req.query.pageSize) || 20

  const [models, total] = await Promise.all([
    prisma.aiModel.findMany({
      where: { tenantId: req.tenantId },
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
    }),
    prisma.aiModel.count({ where: { tenantId: req.tenantId } }),
  ])

  res.json({
    success: true,
    data: { data: models, total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
  })
}))

// ─── 详情 ───────────────────────────────────────────
router.get("/:id", authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  if (!req.tenantId) return res.status(401).json({ success: false, message: "未登录" })
  const model = await prisma.aiModel.findFirst({
    where: { id: req.params.id, tenantId: req.tenantId },
    include: { versions: { orderBy: { versionNumber: "desc" } } },
  })
  if (!model) return res.status(404).json({ success: false, message: "模型不存在" })
  res.json({ success: true, data: model })
}))

// ─── 创建 ───────────────────────────────────────────
router.post("/", authMiddleware, requireRole("MANAGER"), asyncHandler(async (req: AuthRequest, res) => {
  if (!req.tenantId) return res.status(401).json({ success: false, message: "未登录" })
  const { name, description, industry, scenario, baseModel } = req.body
  const model = await prisma.aiModel.create({
    data: { tenantId: req.tenantId, name, description, industry, scenario, baseModel },
  })
  res.json({ success: true, data: model })
}))

// ─── 更新 ───────────────────────────────────────────
router.put("/:id", authMiddleware, requireRole("MANAGER"), asyncHandler(async (req: AuthRequest, res) => {
  if (!req.tenantId) return res.status(401).json({ success: false, message: "未登录" })
  const existing = await prisma.aiModel.findFirst({
    where: { id: req.params.id, tenantId: req.tenantId },
  })
  if (!existing) return res.status(404).json({ success: false, message: "模型不存在" })

  const { name, description, industry, scenario, baseModel } = req.body
  const updated = await prisma.aiModel.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(industry !== undefined && { industry }),
      ...(scenario !== undefined && { scenario }),
      ...(baseModel !== undefined && { baseModel }),
    },
  })
  res.json({ success: true, data: updated })
}))

// ─── 删除 ───────────────────────────────────────────
router.delete("/:id", authMiddleware, requireRole("MANAGER"), asyncHandler(async (req: AuthRequest, res) => {
  if (!req.tenantId) return res.status(401).json({ success: false, message: "未登录" })
  await prisma.aiModel.deleteMany({
    where: { id: req.params.id, tenantId: req.tenantId },
  })
  res.json({ success: true, data: null })
}))

// ─── 模型版本列表 ───────────────────────────────────
router.get("/:id/versions", authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  if (!req.tenantId) return res.status(401).json({ success: false, message: "未登录" })
  const versions = await prisma.modelVersion.findMany({
    where: { modelId: req.params.id },
    orderBy: { versionNumber: "desc" },
  })
  res.json({ success: true, data: versions })
}))

export default router
