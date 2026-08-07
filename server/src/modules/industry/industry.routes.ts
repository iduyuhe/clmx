import { Router } from "express"
import { prisma } from "../../utils/prisma"
import { authMiddleware, AuthRequest, requireAdmin } from "../../middleware/auth.middleware"
import { asyncHandler } from "../../utils/asyncHandler"
const router = Router()

/* ---- 行业列表（所有用户可查看）---- */
router.get("/", authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const where = { OR: [{ tenantId: req.tenantId }, { isPreset: true }] }
  res.json({ success: true, data: await prisma.industry.findMany({ where, include: { scenarios: true } }) })
}))

router.get("/:id", authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  // P1 修复: 允许查看预置行业或本租户行业
  const r = await prisma.industry.findFirst({
    where: { id: req.params.id, OR: [{ tenantId: req.tenantId }, { isPreset: true }] },
    include: { scenarios: true },
  })
  if (!r) return res.status(404).json({ success: false, message: "Not found" })
  res.json({ success: true, data: r })
}))

/* ---- 行业管理（管理员）---- */
router.post("/", authMiddleware, requireAdmin, asyncHandler(async (req: AuthRequest, res) => {
  const { name, code, description, icon } = req.body
  if (!name || !code) return res.status(400).json({ success: false, message: "名称和编码不能为空" })
  try {
    const r = await prisma.industry.create({
      data: {
        name, code, description: description || "",
        icon: icon || "factory",
        isPreset: false,
        tenantId: req.tenantId,
      },
    })
    res.json({ success: true, data: r })
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err)
    const isDuplicate = err instanceof Error && (err as any).code === "P2002"
    res.status(400).json({ success: false, message: isDuplicate ? "编码已存在" : errMsg })
  }
}))

router.put("/:id", authMiddleware, requireAdmin, asyncHandler(async (req: AuthRequest, res) => {
  const { name, description, icon } = req.body
  const r = await prisma.industry.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } })
  if (!r) return res.status(404).json({ success: false, message: "Not found" })
  const updated = await prisma.industry.update({
    where: { id: req.params.id },
    data: { name, description, icon },
  })
  res.json({ success: true, data: updated })
}))

router.delete("/:id", authMiddleware, requireAdmin, asyncHandler(async (req: AuthRequest, res) => {
  const r = await prisma.industry.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } })
  if (!r) return res.status(404).json({ success: false, message: "Not found" })
  if (r.isPreset) return res.status(403).json({ success: false, message: "预置行业不可删除" })
  await prisma.scenario.deleteMany({ where: { industryId: req.params.id } })
  await prisma.industry.delete({ where: { id: req.params.id } })
  res.json({ success: true })
}))

/* ---- 场景管理（管理员，嵌套在行业下）---- */
router.post("/:industryId/scenarios", authMiddleware, requireAdmin, asyncHandler(async (req: AuthRequest, res) => {
  const { name, code, description, promptTemplate } = req.body
  if (!name || !code) return res.status(400).json({ success: false, message: "名称和编码不能为空" })
  const industry = await prisma.industry.findFirst({ where: { id: req.params.industryId, tenantId: req.tenantId } })
  if (!industry) return res.status(404).json({ success: false, message: "行业不存在" })
  const r = await prisma.scenario.create({
    data: {
      name, code, description: description || "",
      promptTemplate: promptTemplate || "",
      industryId: req.params.industryId,
      isPreset: false,
      tenantId: req.tenantId,
    },
  })
  res.json({ success: true, data: r })
}))

router.put("/:industryId/scenarios/:scenarioId", authMiddleware, requireAdmin, asyncHandler(async (req: AuthRequest, res) => {
  const { name, description, promptTemplate } = req.body
  // P1 修复: 验证 scenario 所属 industry 属于当前租户
  const r = await prisma.scenario.findFirst({
    where: { id: req.params.scenarioId, industryId: req.params.industryId, industry: { tenantId: req.tenantId } },
  })
  if (!r) return res.status(404).json({ success: false, message: "Not found" })
  const updated = await prisma.scenario.update({
    where: { id: req.params.scenarioId },
    data: { name, description, promptTemplate },
  })
  res.json({ success: true, data: updated })
}))

router.delete("/:industryId/scenarios/:scenarioId", authMiddleware, requireAdmin, asyncHandler(async (req: AuthRequest, res) => {
  // P1 修复: 验证 scenario 所属 industry 属于当前租户
  const r = await prisma.scenario.findFirst({
    where: { id: req.params.scenarioId, industryId: req.params.industryId, industry: { tenantId: req.tenantId } },
  })
  if (!r) return res.status(404).json({ success: false, message: "Not found" })
  if (r.isPreset) return res.status(403).json({ success: false, message: "预置场景不可删除" })
  await prisma.scenario.delete({ where: { id: req.params.scenarioId } })
  res.json({ success: true })
}))

export default router
