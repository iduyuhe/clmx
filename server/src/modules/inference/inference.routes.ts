import { Router } from 'express'
import { authMiddleware, requireRole, AuthRequest } from '../../middleware/auth.middleware'
import { runInference, runTimeseriesInference, runTextClassificationInference, extractKeywords, computeTextSimilarity, clusterTexts, getLoadedModels, unloadModel, warmupModels } from './inference.service'
import { prisma } from '../../utils/prisma'
import logger from '../../utils/logger'

const router = Router()

/**
 * POST /api/inference/predict
 * 执行推理
 * Body: { task, texts, model?, parameters? }
 */
router.post('/predict', authMiddleware, requireRole('MANAGER'), async (req: AuthRequest, res) => {
  try {
    const { task, texts, model, parameters } = req.body

    if (!task) {
      return res.status(400).json({ success: false, message: '缺少 task 参数' })
    }
    if (!texts || (Array.isArray(texts) && texts.length === 0) || texts === '') {
      return res.status(400).json({ success: false, message: '缺少 texts 参数' })
    }

    // 限制一次最多 50 条文本
    const textArray = Array.isArray(texts) ? texts : [texts]
    if (textArray.length > 50) {
      return res.status(400).json({ success: false, message: '单次最多 50 条文本' })
    }

    const result = await runInference({ task, texts, model, parameters })
    res.json({ success: true, data: result })
  } catch (err: any) {
    logger.error('推理失败', { error: err.message })
    res.status(500).json({ success: false, message: `推理失败: ${err.message}` })
  }
})

/**
 * POST /api/inference/timeseries
 * 工业时序异常推理：输入一组定长窗口序列，返回每窗口异常分与严重度
 * Body: { modelVersionId, windows: number[][] }
 */
router.post('/timeseries', authMiddleware, requireRole('MANAGER'), async (req: AuthRequest, res) => {
  try {
    const { modelVersionId, windows } = req.body
    if (!modelVersionId || !Array.isArray(windows) || windows.length === 0) {
      return res.status(400).json({ success: false, message: '缺少 modelVersionId 或 windows' })
    }
    const result = await runTimeseriesInference({
      modelVersionId,
      tenantId: req.tenantId as string,
      windows: windows as number[][],
    })
    res.json({ success: true, data: result })
  } catch (err: any) {
    logger.error('工业时序推理失败', { error: err.message })
    res.status(500).json({ success: false, message: `推理失败: ${err.message}` })
  }
})

/**
 * POST /api/inference/text-classification
 * NLP 文本分类推理：用训练产出的纯 JSON 模型（ModelVersion.checkpointPath/model_meta.json）做推理
 * Body: { modelVersionId, texts: string | string[] }
 */
router.post('/text-classification', authMiddleware, requireRole('MANAGER'), async (req: AuthRequest, res) => {
  try {
    const { modelVersionId, texts } = req.body
    if (!modelVersionId || !texts) {
      return res.status(400).json({ success: false, message: '缺少 modelVersionId 或 texts' })
    }
    const result = await runTextClassificationInference({
      modelVersionId,
      tenantId: req.tenantId as string,
      texts: texts as string | string[],
    })
    res.json({ success: true, data: result })
  } catch (err: any) {
    logger.error('文本分类推理失败', { error: err.message })
    res.status(500).json({ success: false, message: `推理失败: ${err.message}` })
  }
})

/**
 * GET /api/inference/text-classification/models
 * 列出当前租户已训练完成、可用于中文文本分类推理的模型版本
 * 返回 [{ modelVersionId, modelName, versionNumber, status }]
 */
router.get('/text-classification/models', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const models = await prisma.aiModel.findMany({
      where: { tenantId: req.tenantId as string, baseModel: 'text_classification' },
      include: {
        versions: {
          where: { status: { in: ['TRAINED', 'COMPLETED', 'DEPLOYED'] }, checkpointPath: { not: null } },
          orderBy: { createdAt: 'desc' },
        },
      },
    })
    const list = models.flatMap((m) =>
      m.versions.map((v) => ({
        modelVersionId: v.id,
        modelName: m.name,
        versionNumber: v.versionNumber,
        status: v.status,
      })),
    )
    res.json({ success: true, data: list })
  } catch (err: any) {
    logger.error('获取文本分类模型列表失败', { error: err.message })
    res.status(500).json({ success: false, message: `获取失败: ${err.message}` })
  }
})

/**
 * POST /api/inference/keywords
 * 关键词提取：从一段或多段中文文本中提取 TF-IDF 关键词（纯 JS，零依赖）
 * Body: { texts: string | string[], topN?: number }
 */
router.post('/keywords', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { texts, topN } = req.body
    if (!texts) return res.status(400).json({ success: false, message: '缺少 texts 参数' })
    const result = extractKeywords({ texts, topN: topN || 10 })
    res.json({ success: true, data: result })
  } catch (err: any) {
    logger.error('关键词提取失败', { error: err.message })
    res.status(500).json({ success: false, message: `关键词提取失败: ${err.message}` })
  }
})

/**
 * POST /api/inference/text-similarity
 * 文本相似度：计算两段中文文本之间的余弦相似度（纯 JS，零依赖）
 * Body: { text1: string, text2: string }
 */
router.post('/text-similarity', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { text1, text2 } = req.body
    if (!text1 || !text2) return res.status(400).json({ success: false, message: '缺少 text1 或 text2 参数' })
    const result = computeTextSimilarity({ text1, text2 })
    res.json({ success: true, data: result })
  } catch (err: any) {
    logger.error('文本相似度计算失败', { error: err.message })
    res.status(500).json({ success: false, message: `文本相似度计算失败: ${err.message}` })
  }
})

/**
 * POST /api/inference/text-clustering
 * 文本聚类：TF-IDF + K-means，将多段文本分组（纯 JS，零依赖）
 * Body: { texts: string | string[], nClusters?: number, maxIter?: number }
 */
router.post('/text-clustering', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { texts, nClusters, maxIter } = req.body
    if (!texts) return res.status(400).json({ success: false, message: '缺少 texts 参数' })
    const result = clusterTexts({ texts, nClusters: nClusters || 2, maxIter })
    res.json({ success: true, data: result })
  } catch (err: any) {
    logger.error('文本聚类失败', { error: err.message })
    res.status(500).json({ success: false, message: `文本聚类失败: ${err.message}` })
  }
})

/**
 * POST /api/inference/batch
 * 批量推理（前端传入多条数据，后台排队处理）
 */
router.post('/batch', authMiddleware, requireRole('MANAGER'), async (req: AuthRequest, res) => {
  try {
    const { task, items, model, parameters } = req.body
    // items: [{ text: "..." }, { text: "..." }, ...]

    if (!task || !items || !Array.isArray(items)) {
      return res.status(400).json({ success: false, message: '缺少 task 或 items' })
    }

    const texts = items.map((item: any) => item.text || item.content || String(item))
    const result = await runInference({ task, texts, model, parameters })
    res.json({ success: true, data: result })
  } catch (err: any) {
    logger.error('批量推理失败', { error: err.message })
    res.status(500).json({ success: false, message: `批量推理失败: ${err.message}` })
  }
})

/**
 * GET /api/inference/models
 * 列出已加载的模型
 */
router.get('/models', authMiddleware, async (req: AuthRequest, res) => {
  const models = getLoadedModels()
  res.json({ success: true, data: models })
})

/**
 * POST /api/inference/warmup
 * 预热模型（管理员操作）
 */
router.post('/warmup', authMiddleware, requireRole('MANAGER'), async (req: AuthRequest, res) => {
  try {
    await warmupModels()
    res.json({ success: true, message: '模型预热完成', data: getLoadedModels() })
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message })
  }
})

/**
 * POST /api/inference/unload
 * 卸载模型释放内存
 * Body: { task, model? }
 */
router.post('/unload', authMiddleware, requireRole('MANAGER'), async (req: AuthRequest, res) => {
  const { task, model } = req.body
  const removed = unloadModel(task, model)
  res.json({ success: true, data: removed, message: `已卸载 ${removed.length} 个模型` })
})

export default router
