import { Router } from "express"
import { prisma } from "../../utils/prisma"
import { authMiddleware, AuthRequest } from "../../middleware/auth.middleware"
import { asyncHandler } from "../../utils/asyncHandler"
const router = Router()

router.get("/", authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  if (!req.tenantId) return res.status(401).json({ success: false, message: "未登录" })
  const tenantId = req.tenantId
  const [modelCount, trainingCount, deployedCount] = await Promise.all([
    prisma.aiModel.count({ where: { tenantId } }),
    prisma.trainingJob.count({ where: { model: { tenantId }, status: "RUNNING" } }),
    prisma.deployment.count({ where: { modelVersion: { model: { tenantId } }, status: "RUNNING" } }),
  ])
  const recentTrainingJobs = await prisma.trainingJob.findMany({
    where: { model: { tenantId } }, orderBy: { createdAt: "desc" }, take: 5, include: { model: true },
  })
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const todayApiCalls = await prisma.apiUsage.count({
    where: { deployment: { modelVersion: { model: { tenantId } } }, timestamp: { gte: todayStart } },
  })

  // N+1 fix: single raw query replaces 7-iteration loop
  const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7); sevenDaysAgo.setHours(0, 0, 0, 0)
  const apiCallTrendRaw = await prisma.$queryRawUnsafe<{ date: string; calls: number }[]>(
    `SELECT
  strftime("%m/%d", "createdAt") as date,
  COUNT(*) as calls
FROM "ApiUsage"
WHERE "createdAt" >= ?1
  AND "deploymentId" IN (
    SELECT d.id FROM "Deployment" d
    JOIN "ModelVersion" mv ON mv.id = d."modelVersionId"
    JOIN "AiModel" m ON m.id = mv."modelId"
    WHERE m."tenantId" = ?2
  )
GROUP BY strftime("%m/%d", "createdAt"), date("createdAt")
ORDER BY date("createdAt") ASC
LIMIT 7`,
    sevenDaysAgo.toISOString(), tenantId
  )

  // Fill missing days
  const now = new Date()
  const apiCallTrend: { date: string; calls: number }[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
    const label = (d.getMonth() + 1) + "/" + d.getDate()
    const found = apiCallTrendRaw.find(r => r.date === label)
    apiCallTrend.push(found || { date: label, calls: 0 })
  }

  res.json({ success: true, data: { modelCount, trainingCount, deployedCount, todayApiCalls, recentTrainingJobs, apiCallTrend } })
}))

export default router
