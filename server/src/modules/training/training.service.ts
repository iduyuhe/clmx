/**
 * CLMX 训练引擎服务
 *
 * 管理训练任务生命周期，通过 child_process 调用 Python train_worker.py。
 * 支持：
 *   - 本地 CPU 训练（本机开发调试）
 *   - 本地 GPU 训练（有 GPU 的机器自动使用）
 *   - 远程 GPU Worker（部署到云端）
 */

import { ChildProcess, spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { prisma } from '../../utils/prisma'
import logger from '../../utils/logger'
import { TRAINING_DEFAULT_EPOCHS, TRAINING_DEFAULT_BATCH_SIZE, TRAINING_DEFAULT_LEARNING_RATE } from '../../utils/config'
import { buildWindowedSeries } from '../sensor-data/windowing'

// Python 解释器路径
const PYTHON_PATH = process.env.PYTHON_PATH || findPython()

// Worker 脚本路径（兼容源码运行 tsx 与编译后 dist 运行两种布局）
const WORKER_CANDIDATES = [
  path.resolve(__dirname, '../../worker/train_worker.py'),     // dist/worker 或 src/worker
  path.resolve(__dirname, '../../../src/worker/train_worker.py'), // 部署后 src/worker 仍在
  path.resolve(process.cwd(), 'src/worker/train_worker.py'),
  path.resolve(process.cwd(), 'worker/train_worker.py'),
]
const WORKER_SCRIPT = WORKER_CANDIDATES.find((p) => fs.existsSync(p)) || WORKER_CANDIDATES[0]

// 远程训练 Worker 端点
const REMOTE_TRAINING_URL = process.env.REMOTE_TRAINING_URL || ''

// 运行中的训练进程
const runningJobs = new Map<string, ChildProcess>()

// ─── 查找 Python ───────────────────────────────────

function findPython(): string {
  // 优先用项目 venv 里的 Python
  const candidates = [
    path.resolve(__dirname, '../../../../.workbuddy/binaries/python/envs/default/Scripts/python.exe'),
    process.env.HOME ? path.join(process.env.HOME, '.workbuddy/binaries/python/envs/default/Scripts/python.exe') : '',
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.workbuddy/binaries/python/envs/default/Scripts/python.exe') : '',
    'python',
    'python3',
  ]
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c
  }
  return 'python3'
}

// ─── 日志写入 ──────────────────────────────────────

async function appendLog(jobId: string, level: string, message: string, metadata?: Record<string, unknown>) {
  try {
    const job = await prisma.trainingJob.findUnique({ where: { id: jobId }, select: { tenantId: true } })
    await prisma.trainingLog.create({
      data: {
        trainingJobId: jobId,
        tenantId: job?.tenantId ?? null,
        level,
        message,
        metadata: metadata ? JSON.stringify(metadata) : undefined,
      },
    })
  } catch (err) {
    logger.error(`写入训练日志失败: ${jobId}`)
  }
}

// ─── 训练结果自动解读（P1-2，纯 TS 零依赖）───────────

/**
 * 将训练指标转换成人话摘要，降低决策门槛。
 * 覆盖工业时序（timeseries）与中文文本分类（text_classification）两类。
 */
export function summarizeTraining(ctx: {
  dataType?: string | null
  modelName?: string
  metrics?: Record<string, any>
}): string {
  const { dataType, modelName = '未命名模型', metrics = {} } = ctx
  const parts: string[] = []
  const isTs = dataType === 'timeseries' || metrics.model_type === 'timeseries'
  parts.push(`这是「${modelName}」的${isTs ? '工业时序异常检测' : '中文文本分类'}模型训练结果自动解读：`)

  const n = metrics.num_samples ?? metrics.sample_count
  if (n !== undefined) parts.push(`共使用 ${n} 个训练样本。`)

  if (isTs) {
    const thr = metrics.final_loss ?? metrics.threshold
    const wlen = metrics.window_size
    if (thr !== undefined) parts.push(`模型学习到的异常阈值（重建误差 95 分位）为 ${Number(thr).toFixed(4)}。`)
    if (wlen !== undefined) parts.push(`采用滑动窗口长度 ${wlen} 构造训练样本。`)
    parts.push('部署后，实时数据窗口的重建误差超过该阈值即判为异常，无需标注、纯 JS 边缘推理。')
  } else {
    const acc = metrics.accuracy ?? metrics.acc
    if (acc !== undefined) {
      const pct = (Number(acc) * 100).toFixed(1)
      parts.push(`训练准确率 ${pct}%。`)
      if (acc >= 0.85) parts.push('表现优秀，可直接投入生产推理。')
      else if (acc >= 0.7) parts.push('表现可用，建议补充更多标注样本以进一步提升。')
      else parts.push('准确率偏低，建议检查标注质量或增加训练样本后重新训练。')
    }
    const nc = metrics.num_classes
    if (nc !== undefined) parts.push(`模型覆盖 ${nc} 个分类标签。`)
    parts.push('部署后可用零依赖纯 JS 推理，无需深度学习框架。')
  }
  return parts.join('')
}

// ─── 核心：启动训练 ─────────────────────────────────

export async function startTrainingJob(jobId: string): Promise<void> {
  // 工业时序训练仅在本地执行（远端 Worker 暂不支持）
  const job = await prisma.trainingJob.findUnique({ where: { id: jobId }, select: { hyperparams: true } })
  const hp = job ? JSON.parse(job.hyperparams || '{}') : {}
  const modelType = hp.modelType || 'fasttext'
  const isTimeseries = hp.dataType === 'timeseries' || modelType === 'timeseries'
  // 中文文本分类为零依赖本地任务，不转发远端 GPU Worker
  const isLocalOnly = isTimeseries || modelType === 'text_classification'

  // 如果配置了远端 Worker 且非本地专属任务，转发到远端
  if (REMOTE_TRAINING_URL && !isLocalOnly) {
    return startRemoteTraining(jobId)
  }

  // 本地训练
  return startLocalTraining(jobId)
}

/**
 * 本地训练 — spawn Python 子进程
 */
async function startLocalTraining(jobId: string): Promise<void> {
  const job = await prisma.trainingJob.findUnique({
    where: { id: jobId },
    include: { datasetVersion: { include: { dataset: true } }, model: true },
  })

  if (!job) throw new Error(`训练任务不存在: ${jobId}`)

  // 解析超参，判定训练域
  const hyperparams = JSON.parse(job.hyperparams || '{}')
  const dataType: string = hyperparams.dataType || (hyperparams.modelType === 'timeseries' ? 'timeseries' : 'text')
  const epochs = job.totalEpochs || hyperparams.epochs || TRAINING_DEFAULT_EPOCHS
  const batchSize = hyperparams.batchSize || TRAINING_DEFAULT_BATCH_SIZE  // CPU 友好的 batch size
  const learningRate = hyperparams.learningRate || TRAINING_DEFAULT_LEARNING_RATE
  const maxSamples = hyperparams.maxSamples || 0

  // 工业时序训练：从 sensor-data 导出窗口序列，不依赖文本数据集
  let dataPath: string
  let modelType: string = hyperparams.modelType || 'fasttext'
  if (dataType === 'timeseries') {
    modelType = 'timeseries'
    if (!hyperparams.sensorId) throw new Error('时序训练需要 hyperparams.sensorId')
    const wsResult = await buildWindowedSeries(job.model.tenantId, {
      sensorId: hyperparams.sensorId,
      start: hyperparams.start,
      end: hyperparams.end,
      windowSize: hyperparams.windowSize,
      step: hyperparams.step,
    })
    if (wsResult.count === 0) throw new Error(`传感器 ${hyperparams.sensorId} 时序数据不足，无法构造训练窗口`)
    const outDir = path.resolve(__dirname, '../../../uploads/timeseries')
    await fs.promises.mkdir(outDir, { recursive: true })
    const outPath = path.join(outDir, `${jobId}.jsonl`)
    const lines = wsResult.windows.map((w: number[]) => JSON.stringify({ values: w }))
    await fs.promises.writeFile(outPath, lines.join('\n'), 'utf-8')
    dataPath = outPath
    await appendLog(jobId, 'INFO', `导出时序训练集: ${wsResult.count} 窗口, 窗口长度 ${wsResult.windowSize} -> ${outPath}`)
  } else {
    if (!job.datasetVersion?.filePath) throw new Error('数据集文件路径不存在')
    dataPath = job.datasetVersion.filePath
    if (!fs.existsSync(dataPath)) throw new Error(`数据集文件不存在: ${dataPath}`)
  }

  await appendLog(jobId, 'INFO', '正在初始化训练环境...')
  logger.info(`启动本地训练: ${jobId}`, { modelType, dataType, epochs, dataPath })

  // 更新状态
  await prisma.trainingJob.update({
    where: { id: jobId },
    data: { status: 'RUNNING', startedAt: new Date() },
  })

  // 构建命令行参数
  const args = [
    WORKER_SCRIPT,
    '--job-id', jobId,
    '--model-type', modelType,
    '--data-path', dataPath,
    '--text-col', hyperparams.textCol || 'text',
    '--label-col', hyperparams.labelCol || 'label',
    '--epochs', String(epochs),
    '--batch-size', String(batchSize),
    '--learning-rate', String(learningRate),
    '--checkpoint-dir', `./checkpoints/${jobId}`,
  ]
  if (maxSamples > 0) args.push('--max-samples', String(maxSamples))

  await appendLog(jobId, 'INFO', `训练命令: ${PYTHON_PATH} ${args.join(' ')}`)

  // 启动子进程
  const proc = spawn(PYTHON_PATH, args, {
    cwd: path.resolve(__dirname, '../../../'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  })

  runningJobs.set(jobId, proc)

  // 收集 stderr 作为训练日志
  proc.stderr?.on('data', async (data: Buffer) => {
    const text = data.toString()
    const lines = text.split('\n').filter(Boolean)
    for (const line of lines) {
      await appendLog(jobId, 'INFO', line)
    }
  })

  proc.on('close', async (code) => {
    runningJobs.delete(jobId)

    if (code === 0) {
      logger.info(`训练完成: ${jobId}`)
      await appendLog(jobId, 'INFO', '训练成功完成！')

      // 读取最终状态
      const stateFile = `logs/train_${jobId}.state.json`
      let metrics: Record<string, number> = {}
      let checkpointPath = ''

      if (fs.existsSync(stateFile)) {
        try {
          const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'))
          metrics = state.metrics || {}
          checkpointPath = state.checkpointPath || ''
        } catch (e) {
          logger.warn('Failed to parse training state file: ' + (e as Error).message)
        }
      }

      // 更新训练任务状态
      await prisma.trainingJob.update({
        where: { id: jobId },
        data: {
          status: 'COMPLETED',
          progress: 100,
          currentEpoch: job.totalEpochs,
          completedAt: new Date(),
          lossHistory: JSON.stringify(metrics),
        },
      })

      // 创建模型版本（含自动解读摘要）
      const vc = await prisma.modelVersion.count({ where: { modelId: job.modelId } })
      const interpretation = summarizeTraining({ dataType, modelName: job.model.name, metrics })
      const version = await prisma.modelVersion.create({
        data: {
          modelId: job.modelId,
          tenantId: job.model.tenantId,
          versionNumber: vc + 1,
          trainingJobId: jobId,
          status: 'TRAINED',
          dataType,
          checkpointPath: checkpointPath || `./checkpoints/${jobId}`,
          metrics: JSON.stringify(metrics),
          interpretation,
        },
      })

      // 回填 modelVersionId，使训练详情页能取到指标与摘要
      await prisma.trainingJob.update({
        where: { id: jobId },
        data: { modelVersionId: version.id, status: 'COMPLETED', progress: 100, currentEpoch: job.totalEpochs },
      })

      // 更新模型状态
      await prisma.aiModel.update({
        where: { id: job.modelId },
        data: { status: 'TRAINED' },
      })
    } else {
      logger.error(`训练失败: ${jobId}, exit code: ${code}`)
      await appendLog(jobId, 'ERROR', `训练进程异常退出，exit code: ${code}`)

      // 读取错误状态
      const stateFile = `logs/train_${jobId}.state.json`
      let errorMsg = '训练失败'
      if (fs.existsSync(stateFile)) {
        try {
          const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'))
          errorMsg = state.error || errorMsg
        } catch (e) {
          logger.warn('Failed to parse error state file: ' + (e as Error).message)
        }
      }

      await prisma.trainingJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', completedAt: new Date() },
      })
      await appendLog(jobId, 'ERROR', errorMsg)
    }
  })

  proc.on('error', async (err) => {
    runningJobs.delete(jobId)
    logger.error(`训练进程启动失败: ${jobId}`, { error: err.message })
    await appendLog(jobId, 'ERROR', `进程启动失败: ${err.message}`)
    await prisma.trainingJob.update({
      where: { id: jobId },
      data: { status: 'FAILED', completedAt: new Date() },
    })
  })
}

/**
 * 远端训练 — HTTP 转发到 GPU Worker
 */
async function startRemoteTraining(jobId: string): Promise<void> {
  const job = await prisma.trainingJob.findUnique({
    where: { id: jobId },
    include: { datasetVersion: true, model: true },
  })

  if (!job) throw new Error(`训练任务不存在: ${jobId}`)

  logger.info(`转发训练任务到远端: ${REMOTE_TRAINING_URL}`)
  await appendLog(jobId, 'INFO', `转发训练任务到远端 GPU Worker: ${REMOTE_TRAINING_URL}`)

  await prisma.trainingJob.update({
    where: { id: jobId },
    data: { status: 'RUNNING', startedAt: new Date() },
  })

  try {
    const res = await fetch(`${REMOTE_TRAINING_URL}/api/training/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId,
        modelId: job.modelId,
        dataPath: job.datasetVersion?.filePath,
        hyperparams: job.hyperparams,
        totalEpochs: job.totalEpochs,
        modelType: JSON.parse(job.hyperparams || '{}').modelType || 'fasttext',
        callbackUrl: `${process.env.SERVER_URL || 'http://localhost:3002'}/api/training/${jobId}/callback`,
      }),
    })
    if (!res.ok) throw new Error(`远端 Worker 返回错误: ${res.status}`)
    await appendLog(jobId, 'INFO', '远端 GPU Worker 已接受训练任务')
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err)
    logger.error(`远端训练启动失败: ${errMsg}`)
    await appendLog(jobId, 'ERROR', `远端启动失败: ${errMsg}`)
    await prisma.trainingJob.update({
      where: { id: jobId },
      data: { status: 'FAILED', completedAt: new Date() },
    })
  }
}

// ─── 任务控制 ───────────────────────────────────────

/**
 * 停止训练任务
 */
export async function stopTrainingJob(jobId: string): Promise<boolean> {
  const proc = runningJobs.get(jobId)
  if (proc) {
    proc.kill('SIGTERM')
    runningJobs.delete(jobId)
    await appendLog(jobId, 'INFO', '训练任务已被手动停止')
    await prisma.trainingJob.update({
      where: { id: jobId },
      data: { status: 'CANCELLED', completedAt: new Date() },
    })
    return true
  }

  // 如果是远端任务
  if (REMOTE_TRAINING_URL) {
    try {
      await fetch(`${REMOTE_TRAINING_URL}/api/training/${jobId}/stop`, { method: 'POST' })
    } catch (e) {
      logger.warn('Failed to stop remote training: ' + (e as Error).message)
    }
  }

  return false
}

/**
 * 暂停训练任务
 */
export async function pauseTrainingJob(jobId: string): Promise<boolean> {
  const proc = runningJobs.get(jobId)
  if (proc && process.platform === 'win32') {
    // Windows 不支持 SIGSTOP，用 SIGTERM + 存 checkpoint
    proc.kill('SIGTERM')
    runningJobs.delete(jobId)
    await appendLog(jobId, 'WARN', '训练任务已暂停（Windows 不支持信号暂停）')
    await prisma.trainingJob.update({
      where: { id: jobId },
      data: { status: 'PAUSED' },
    })
    return true
  }
  // Unix 系统可以用 SIGSTOP
  if (proc) {
    proc.kill('SIGTSTP')
    await prisma.trainingJob.update({
      where: { id: jobId },
      data: { status: 'PAUSED' },
    })
    return true
  }
  return false
}

/**
 * 恢复训练任务 — 重新启动 Python 进程
 */
export async function resumeTrainingJob(jobId: string): Promise<void> {
  await startTrainingJob(jobId)
}

// ─── 进度轮询 ──────────────────────────────────────

/**
 * 轮询训练进度（从 state.json 读取）
 */
export async function pollTrainingProgress(jobId: string) {
  const stateFile = `logs/train_${jobId}.state.json`
  if (!fs.existsSync(stateFile)) return null

  try {
    const raw = fs.readFileSync(stateFile, 'utf-8')
    return JSON.parse(raw)
  } catch (e) {
    logger.warn('Failed to read training progress state: ' + (e as Error).message)
    return null
  }
}
