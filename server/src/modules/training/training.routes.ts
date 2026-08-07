import { Router } from 'express'
import { prisma } from '../../utils/prisma'
import { authMiddleware, requireRole, AuthRequest } from '../../middleware/auth.middleware'
import {
  startTrainingJob,
  stopTrainingJob,
  pauseTrainingJob,
  resumeTrainingJob,
  pollTrainingProgress,
} from './training.service'
import logger from '../../utils/logger'
import { TRAINING_DEFAULT_EPOCHS } from '../../utils/config'
import { v4 } from 'uuid'

const router = Router()

/**
 * GET /api/training
 * 训练任务列表
 */
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  const p = +(req.query.page || 1)
  const ps = +(req.query.pageSize || 20)
  const status = req.query.status as string | undefined
  const search = req.query.search as string | undefined

  const where: any = { model: { tenantId: req.tenantId } }
  if (status) where.status = status
  if (search) {
    where.OR = [
      { model: { name: { contains: search, mode: 'insensitive' } } },
      { model: { baseModel: { contains: search, mode: 'insensitive' } } },
    ]
  }

  const [data, total] = await Promise.all([
    prisma.trainingJob.findMany({
      where,
      skip: (p - 1) * ps,
      take: ps,
      orderBy: { createdAt: 'desc' },
      include: {
        model: true,
        logs: { take: 10, orderBy: { timestamp: 'desc' } },
      },
    }),
    prisma.trainingJob.count({ where }),
  ])

  res.json({
    success: true,
    data: { data, total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) },
  })
})

/**
 * GET /api/training/:id
 * 训练任务详情（含实时进度）
 */
router.get('/:id', authMiddleware, async (req: AuthRequest, res) => {
  const job = await prisma.trainingJob.findFirst({
    where: { id: req.params.id, model: { tenantId: req.tenantId } },
    include: {
      model: true,
      logs: { orderBy: { timestamp: 'desc' }, take: 50 },
    },
  })

  if (!job) {
    return res.status(404).json({ success: false, message: '任务不存在' })
  }

  // 实时进度（从 Python worker 的状态文件读取）
  let liveProgress = null
  if (job.status === 'RUNNING') {
    liveProgress = await pollTrainingProgress(req.params.id)
  }

  // 解析 JSON 字符串字段
  const parsedJob = { ...job } as Record<string, unknown>
  if (parsedJob.hyperparams) { try { parsedJob.hyperparams = JSON.parse(parsedJob.hyperparams as string) } catch (e) { logger.debug('hyperparams parse failed: ' + (e as Error).message) } }
  if (parsedJob.lossHistory) { try { parsedJob.lossHistory = JSON.parse(parsedJob.lossHistory as string) } catch (e) { logger.debug('lossHistory parse failed: ' + (e as Error).message) } }
  const logs = parsedJob.logs as Array<Record<string, unknown>> | undefined
  logs?.forEach((log) => {
    if (log.metadata) { try { log.metadata = JSON.parse(log.metadata as string) } catch (e) { logger.debug('log metadata parse failed: ' + (e as Error).message) } }
  })

  res.json({ success: true, data: { ...parsedJob, liveProgress } })
})

/**
 * POST /api/training
 * 创建并启动训练任务
 */
router.post('/', authMiddleware, requireRole('MANAGER'), async (req: AuthRequest, res) => {
  try {
    const { modelId, datasetVersionId, hyperparams } = req.body

    if (!modelId) {
      return res.status(400).json({ success: false, message: '缺少 modelId' })
    }

    const hparams = hyperparams || {}
    const isTimeseries = hparams.dataType === 'timeseries' || hparams.modelType === 'timeseries'
    // 工业时序训练不依赖文本数据集，datasetVersionId 可省略
    if (!isTimeseries && !datasetVersionId) {
      return res.status(400).json({ success: false, message: '缺少 datasetVersionId' })
    }

    // P0 修复: 验证 modelId 属于当前租户
    const model = await prisma.aiModel.findFirst({ where: { id: modelId, tenantId: req.tenantId } })
    if (!model) {
      return res.status(404).json({ success: false, message: '模型不存在' })
    }

    const job = await prisma.trainingJob.create({
      data: {
        modelId,
        tenantId: model.tenantId,
        datasetVersionId: datasetVersionId ?? null,
        hyperparams: JSON.stringify(hparams),
        callbackToken: v4(),
        totalEpochs: hparams.epochs || TRAINING_DEFAULT_EPOCHS,
        status: 'QUEUED',
      },
    })

    // 异步启动训练，不阻塞 HTTP 响应
    startTrainingJob(job.id).catch(err => {
      logger.error(`训练启动失败 ${job.id}:`, { error: err.message })
      prisma.trainingJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', completedAt: new Date() },
      }).catch(() => {})
    })

    res.json({ success: true, data: job, message: '训练任务已创建并启动' })
  } catch (err: any) {
    logger.error('创建训练任务失败', { error: err.message })
    res.status(500).json({ success: false, message: `创建失败: ${err.message}` })
  }
})

/**
 * POST /api/training/:id/:action
 * 控制训练任务：pause / resume / stop
 */
router.post('/:id/:action(pause|resume|stop)', authMiddleware, requireRole('MANAGER'), async (req: AuthRequest, res) => {
  const { id, action } = req.params

  // P0 修复: 验证训练任务属于当前租户
  const jobCheck = await prisma.trainingJob.findFirst({
    where: { id, model: { tenantId: req.tenantId } },
    select: { id: true },
  })
  if (!jobCheck) {
    return res.status(404).json({ success: false, message: '任务不存在' })
  }

  try {
    if (action === 'pause') {
      const ok = await pauseTrainingJob(id)
      res.json({ success: ok, message: ok ? '已暂停' : '暂停失败（进程不存在）' })
    } else if (action === 'resume') {
      await resumeTrainingJob(id)
      res.json({ success: true, message: '已恢复训练' })
    } else if (action === 'stop') {
      const ok = await stopTrainingJob(id)
      if (!ok) {
        // 进程不存在但可能已结束，直接更新数据库
        await prisma.trainingJob.update({
          where: { id },
          data: { status: 'CANCELLED', completedAt: new Date() },
        })
      }
      res.json({ success: true, message: '已停止' })
    }
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message })
  }
})

/**
 * GET /api/training/:id/progress-stream
 * SSE 实时进度推送 — 前端订阅训练进度
 */
router.get('/:id/progress-stream', authMiddleware, async (req: AuthRequest, res) => {
  const jobId = req.params.id

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  // 每 1 秒推送一次进度
  const sendProgress = async () => {
    const progress = await pollTrainingProgress(jobId)
    if (progress) {
      res.write(`data: ${JSON.stringify(progress)}\n\n`)
    }
    // 训练完成或失败时关闭连接
    if (progress?.status === 'COMPLETED' || progress?.status === 'FAILED' || progress?.status === 'CANCELLED') {
      res.write(`event: done\ndata: ${JSON.stringify(progress)}\n\n`)
      res.end()
      return
    }
  }

  await sendProgress()
  const timer = setInterval(sendProgress, 1000)

  req.on('close', () => {
    clearInterval(timer)
  })
})

/**
 * POST /api/training/:id/callback
 * 远端 Worker 回调接口 — 接收远端训练进度更新
 */
router.post('/:id/callback', async (req, res) => {
  const { id } = req.params
  const callbackToken = req.headers['x-callback-token'] as string

  // Validate callback token
  if (!callbackToken) {
    return res.status(401).json({ success: false, message: '缺少 x-callback-token 请求头' })
  }

  const job = await prisma.trainingJob.findUnique({ where: { id } })
  if (!job || job.callbackToken !== callbackToken) {
    return res.status(401).json({ success: false, message: '无效的回调令牌' })
  }
  const { status, progress, currentEpoch, metrics, error } = req.body

  try {
    await prisma.trainingJob.update({
      where: { id },
      data: {
        ...(status && { status }),
        ...(progress !== undefined && { progress }),
        ...(currentEpoch !== undefined && { currentEpoch }),
        ...(metrics && { lossHistory: JSON.stringify(metrics) }),
        ...(status === 'COMPLETED' && { completedAt: new Date() }),
      },
    })

    if (error) {
      await prisma.trainingLog.create({
        data: { trainingJobId: id, tenantId: job.tenantId, level: 'ERROR', message: error },
      })
    }

    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message })
  }
})

export default router
