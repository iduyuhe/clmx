import { Router } from 'express'
import { prisma } from '../../utils/prisma'
import { authMiddleware, requireRole, AuthRequest } from '../../middleware/auth.middleware'
import { runInference } from '../inference/inference.service'
import { checkApiQuota } from '../tenant/quota'
import crypto from 'crypto'
import { v4 } from 'uuid'
import logger from '../../utils/logger'

const router = Router()

/**
 * GET /api/deployments
 * 部署列表
 */
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  const p = +(req.query.page || 1)
  const ps = +(req.query.pageSize || 20)
  const status = req.query.status as string | undefined

  const where: any = { modelVersion: { model: { tenantId: req.tenantId } } }
  if (status) where.status = status

  const [data, total] = await Promise.all([
    prisma.deployment.findMany({
      where,
      skip: (p - 1) * ps,
      take: ps,
      orderBy: { createdAt: 'desc' },
      include: { modelVersion: { include: { model: true } }, apiKeys: true },
    }),
    prisma.deployment.count({ where }),
  ])

  res.json({
    success: true,
    data: { data, total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) },
  })
})

/**
 * GET /api/deployments/:id
 * 部署详情
 */
router.get('/:id', authMiddleware, async (req: AuthRequest, res) => {
  const d = await prisma.deployment.findFirst({
    where: { id: req.params.id, modelVersion: { model: { tenantId: req.tenantId } } },
    include: {
      modelVersion: { include: { model: true } },
      apiKeys: true,
    },
  })

  if (!d) return res.status(404).json({ success: false, message: '部署不存在' })

  // 统计用量
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const [totalUses, todayUses] = await Promise.all([
    prisma.apiUsage.count({ where: { deploymentId: d.id } }),
    prisma.apiUsage.count({ where: { deploymentId: d.id, timestamp: { gte: today } } }),
  ])

  res.json({ success: true, data: { ...d, stats: { totalUses, todayUses } } })
})

/**
 * POST /api/deployments
 * 创建部署
 */
router.post('/', authMiddleware, requireRole('MANAGER'), async (req: AuthRequest, res) => {
  try {
    const { modelVersionId, name, gpuType, instanceCount } = req.body

    // 校验模型版本存在且属于当前租户（P0 多租户隔离）
    const modelVersion = await prisma.modelVersion.findUnique({ where: { id: modelVersionId }, include: { model: true } })
    if (!modelVersion) return res.status(404).json({ success: false, message: '模型版本不存在' })
    if (req.tenantId && modelVersion.model.tenantId !== req.tenantId) return res.status(403).json({ success: false, message: '无权部署该模型版本' })

    // 生成本地推理端点 URL
    const endpointUrl = `/api/deployments/${modelVersionId}/infer`

    const d = await prisma.deployment.create({
      data: {
        modelVersionId,
        tenantId: modelVersion.model.tenantId,
        name: name || `部署-${Date.now()}`,
        endpointUrl,
        status: 'RUNNING',
        gpuType: gpuType || 'CPU',
        instanceCount: instanceCount || 1,
      },
    })

    if (!req.tenantId) return res.status(401).json({ success: false, message: '未登录' })
    // 自动创建 API Key (SHA256 hashed)
    const key = v4()
    const hash1 = crypto.createHash("sha256").update(key).digest("hex")
    const kp = `sk-${key.substring(0, 8)}...`
    await prisma.apiKey.create({
      data: {
        tenantId: req.tenantId,
        deploymentId: d.id,
        keyHash: hash1,
        keyPreview: kp,
        name: '默认密钥',
        rateLimit: 100,
      },
    })

    logger.info(`部署创建成功: ${d.id}`, { modelVersionId, apiKey: kp })

    res.json({ success: true, data: { ...d, apiKey: key } })
  } catch (err: any) {
    res.status(500).json({ success: false, message: `创建失败: ${err.message}` })
  }
})

/**
 * DELETE /api/deployments/:id
 * 删除部署
 */
router.delete('/:id', authMiddleware, requireRole('MANAGER'), async (req: AuthRequest, res) => {
  await prisma.deployment.deleteMany({
    where: { id: req.params.id, modelVersion: { model: { tenantId: req.tenantId } } },
  })
  res.json({ success: true, data: null })
})

/**
 * POST /api/deployments/:id/api-keys
 * 创建 API Key
 */
router.post('/:id/api-keys', authMiddleware, requireRole('MANAGER'), async (req: AuthRequest, res) => {
  const { name, rateLimit } = req.body
  const key = v4()
  const hash2 = crypto.createHash("sha256").update(key).digest("hex")
  if (!req.tenantId) return res.status(401).json({ success: false, message: "未登录" })
  const k = await prisma.apiKey.create({
    data: {
      tenantId: req.tenantId,
      deploymentId: req.params.id,
      keyHash: hash2,
      keyPreview: `sk-${key.substring(0, 8)}...`,
      name: name || 'API Key',
      rateLimit: rateLimit || 100,
    },
  })
  res.json({ success: true, data: k, apiKey: key })
})

/**
 * DELETE /api/deployments/:id/api-keys/:keyId
 * 删除 API Key
 */
router.delete('/:id/api-keys/:keyId', authMiddleware, requireRole('MANAGER'), async (req: AuthRequest, res) => {
  await prisma.apiKey.deleteMany({
    where: { id: req.params.keyId, deploymentId: req.params.id },
  })
  res.json({ success: true, data: null })
})

/**
 * POST /api/deployments/:id/test
 * 测试部署 — 调用真实推理引擎
 */
router.post('/:id/test', authMiddleware, requireRole('MANAGER'), async (req: AuthRequest, res) => {
  try {
    const { input, task } = req.body
    const deployment = await prisma.deployment.findFirst({
      where: { id: req.params.id, modelVersion: { model: { tenantId: req.tenantId } } },
      include: { modelVersion: { include: { model: true } }, apiKeys: true },
    })

    if (!deployment) {
      return res.status(404).json({ success: false, message: '部署不存在' })
    }

    // 取部署的默认 API Key 用于用量记录（避免外键错误）
    const apiKeyRec = deployment.apiKeys?.[0]
    const usageApiKeyId = apiKeyRec ? apiKeyRec.id : (await prisma.apiKey.create({
      data: { tenantId: deployment.modelVersion.model.tenantId, deploymentId: deployment.id, keyHash: 'test', keyPreview: 'sk-test', name: '测试密钥' },
    })).id

    const startTime = Date.now()

    // API 配额检查（推理前计费，按调用次数计量）
    try {
      await checkApiQuota(deployment.modelVersion.model.tenantId)
    } catch (e: any) {
      if (e && e.kind === 'api') {
        // 超配额熔断：明确返回 429 + Retry-After，便于客户端退避重试
        res.setHeader('Retry-After', '60')
        return res.status(429).json({ success: false, message: e.message, code: 'QUOTA_EXCEEDED' })
      }
      throw e
    }

    // 记录用量（推理前计费，确保每次调用都计入配额）
    await prisma.apiUsage.create({
      data: {
        apiKeyId: usageApiKeyId,
        deploymentId: req.params.id,
        tenantId: deployment.modelVersion.model.tenantId,
        requestTokens: (input || '').length,
        responseTokens: 0,
        latencyMs: 0,
        statusCode: 200,
      },
    })

    // 调用真实推理引擎
    const result = await runInference({
      task: task || 'text-classification',
      texts: [input || '你好，请问如何使用？'],
    })

    const latencyMs = Date.now() - startTime

    res.json({
      success: true,
      data: {
        output: result.results[0],
        task: result.task,
        model: result.model,
        latencyMs,
        modelInfo: deployment.modelVersion.model.name,
      },
    })
  } catch (err: any) {
    logger.error('部署测试失败', { error: err.message })
    res.status(500).json({ success: false, message: `测试失败: ${err.message}` })
  }
})

// ─── 公开推理端点（API Key 鉴权） ──────────────────

/**
 * POST /api/deployments/:versionId/infer
 * 公开推理端点 — 无需 JWT，使用 API Key 鉴权
 * 外部用户通过此端点调用已部署的模型
 */
router.post('/:versionId/infer', async (req, res) => {
  try {
    const { versionId } = req.params
    const { input, task } = req.body
    const apiKey = req.headers['x-api-key'] as string

    if (!apiKey) {
      return res.status(401).json({ success: false, message: '缺少 x-api-key 请求头' })
    }

    if (!input) {
      return res.status(400).json({ success: false, message: '缺少 input 参数' })
    }

    // Hash the incoming key for comparison
    const incomingHash = crypto.createHash("sha256").update(apiKey).digest("hex")
    // 验证 API Key
    const deployment = await prisma.deployment.findFirst({
      where: {
        modelVersionId: versionId,
        status: 'RUNNING',
        apiKeys: { some: { keyHash: incomingHash, isActive: true } },
      },
      include: { apiKeys: true, modelVersion: { include: { model: true } } },
    })

    if (!deployment) {
      return res.status(401).json({ success: false, message: '无效的 API Key 或部署不可用' })
    }

    const matchedKey = deployment.apiKeys.find(k => k.keyHash === incomingHash)
    if (!matchedKey) {
      return res.status(401).json({ success: false, message: '无效的 API Key' })
    }

    // 检查速率限制
    const oneMinAgo = new Date(Date.now() - 60000)
    const recentUsages = await prisma.apiUsage.count({
      where: {
        apiKeyId: matchedKey.id,
        timestamp: { gte: oneMinAgo },
      },
    })
    if (recentUsages >= matchedKey.rateLimit) {
      return res.status(429).json({
        success: false,
        message: `请求频率超限 (${matchedKey.rateLimit}次/分钟)`,
      })
    }

    const startTime = Date.now()

    // API 配额检查（推理前计费，按调用次数计量）
    try {
      await checkApiQuota(deployment.modelVersion.model.tenantId)
    } catch (e: any) {
      if (e && e.kind === 'api') {
        // 超配额熔断：明确返回 429 + Retry-After，便于客户端退避重试
        res.setHeader('Retry-After', '60')
        return res.status(429).json({ success: false, message: e.message, code: 'QUOTA_EXCEEDED' })
      }
      throw e
    }

    // 记录用量（推理前计费，确保每次调用都计入配额）
    await prisma.apiUsage.create({
      data: {
        apiKeyId: matchedKey.id,
        deploymentId: deployment.id,
        tenantId: deployment.modelVersion.model.tenantId,
        requestTokens: (input || '').length,
        responseTokens: 0,
        latencyMs: 0,
        statusCode: 200,
      },
    })

    // 真实推理
    const result = await runInference({
      task: task || 'text-classification',
      texts: [input],
    })

    const latencyMs = Date.now() - startTime

    res.json({
      success: true,
      data: {
        output: result.results[0],
        task: result.task,
        model: result.model,
        latencyMs,
      },
    })
  } catch (err: any) {
    logger.error('推理失败', { error: err.message })
    res.status(500).json({ success: false, message: `推理失败: ${err.message}` })
  }
})

export default router
