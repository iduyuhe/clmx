/**
 * CLMX 推理引擎服务
 *
 * 使用 @huggingface/transformers (Transformers.js) 实现 CPU 兼容推理。
 * 支持远程 GPU 推理端点回退。
 *
 * 架构:
 *   本地 CPU → Transformers.js (ONNX Runtime 后端)
 *   远端 GPU → HTTP 转发到远程推理 Worker
 */

import { pipeline, env, PipelineType } from "@huggingface/transformers"

// Type for cached pipeline instances (the pipeline() function returns various pipeline types)
// Pipeline instances have varied call signatures depending on task type;
// we use unknown for the cache and cast at usage site for type safety.
import logger from "../../utils/logger"
import fs from "fs"
import path from "path"
import os from "os"
import { prisma } from "../../utils/prisma"

// 模型缓存目录
const MODEL_CACHE_DIR = process.env.MODEL_CACHE_DIR || path.join(os.tmpdir(), "clmx-models")

// 配置 Transformers.js 环境
env.cacheDir = MODEL_CACHE_DIR
env.allowLocalModels = false
// 优先使用 ONNX Runtime 后端（比 WASM 快）
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.numThreads = Math.max(1, os.cpus().length - 1)
}

// 远程推理端点（部署到 GPU 机器后配置）
const REMOTE_INFERENCE_URL = process.env.REMOTE_INFERENCE_URL || ""

// 任务到模型的默认映射
const TASK_MODEL_MAP: Record<string, string> = {
  "text-classification": "Xenova/distilbert-base-uncased-finetuned-sst-2-english",
  "sentiment-analysis": "Xenova/distilbert-base-uncased-finetuned-sst-2-english",
  "ner": "Xenova/bert-base-NER",
  "summarization": "Xenova/distilbart-cnn-6-6",
  "zero-shot-classification": "Xenova/bart-large-mnli",
  "feature-extraction": "Xenova/all-MiniLM-L6-v2",
}

// 模型加载缓存（避免重复加载）— 使用 Pipeline 类型替代 any
// 限制最大缓存数量，防止内存泄漏
const MAX_PIPELINE_CACHE_SIZE = 5
const pipelineCache = new Map<string, unknown>()

/** 清理最旧的缓存项（简单的 FIFO 策略） */
function evictOldestPipeline() {
  if (pipelineCache.size <= MAX_PIPELINE_CACHE_SIZE) return
  const oldestKey = pipelineCache.keys().next().value
  if (oldestKey) {
    pipelineCache.delete(oldestKey)
    logger.info("缓存已满，自动卸载最旧模型: " + oldestKey)
  }
}

async function getPipeline(task: string, model?: string): Promise<unknown> {
  // 归一化任务名：前端可能用下划线（text_classification），Transformers.js 要求连字符（text-classification）
  task = task.replace(/_/g, "-")
  const modelName = model || TASK_MODEL_MAP[task] || TASK_MODEL_MAP["text-classification"]
  const cacheKey = task + ":" + modelName

  if (pipelineCache.has(cacheKey)) {
    return pipelineCache.get(cacheKey)!
  }

  // 缓存满时清理最旧的模型
  evictOldestPipeline()

  logger.info("加载推理模型: " + modelName + " (任务: " + task + ")")

  try {
    const pipe = await pipeline(task as PipelineType, modelName, {
      progress_callback: (info: { status?: string; file?: string; progress?: number }) => {
        if (info.status === "progress") {
          logger.debug("模型下载: " + info.file + " " + Math.round((info.progress || 0) * 100) + "%")
        }
      },
    })
    pipelineCache.set(cacheKey, pipe)
    logger.info("模型加载完成: " + modelName)
    return pipe
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error("模型加载失败: " + modelName, { error: message })
    throw new Error("模型加载失败: " + message)
  }
}

// ─── 推理接口 ───────────────────────────────────────

export interface InferenceRequest {
  task: string           // 任务类型
  model?: string         // 自定义模型名
  texts: string | string[]  // 输入文本
  parameters?: Record<string, unknown>  // 额外参数
}

export interface InferenceResult {
  task: string
  model: string
  results: unknown[]
  latencyMs: number
}

/**
 * 执行本地推理
 */
export async function runLocalInference(req: InferenceRequest): Promise<InferenceResult> {
  const startTime = Date.now()
  const texts = Array.isArray(req.texts) ? req.texts : [req.texts]
  const pipe = await getPipeline(req.task, req.model) as (input: string, params?: Record<string, unknown>) => Promise<unknown>

  const results: unknown[] = []
  for (const text of texts) {
    const output = await pipe(text, req.parameters || {})
    results.push(output)
  }

  const latencyMs = Date.now() - startTime
  logger.info("推理完成: " + req.task + ", " + texts.length + "条, " + latencyMs + "ms")

  return {
    task: req.task,
    model: req.model || TASK_MODEL_MAP[req.task] || "default",
    results,
    latencyMs,
  }
}

/**
 * 执行推理（自动选择本地或远端）
 */
export async function runInference(req: InferenceRequest): Promise<InferenceResult> {
  // 如果配置了远端推理端点，且任务需要 GPU 加速
  if (REMOTE_INFERENCE_URL && (req.task === "text-generation" || req.parameters?.useRemote)) {
    try {
      const res = await fetch(REMOTE_INFERENCE_URL + "/api/inference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
        signal: AbortSignal.timeout(60000),
      })
      if (res.ok) {
        return res.json() as Promise<InferenceResult>
      }
      logger.warn("远端推理失败，回退到本地")
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn("远端推理不可用: " + message + "，回退到本地")
    }
  }

  return runLocalInference(req)
}

// ─── 工业时序异常推理 ───────────────────────────────

export interface TimeseriesInferenceRequest {
  modelVersionId: string
  tenantId: string
  windows: number[][]
}

export interface TimeseriesInferenceResult {
  modelVersionId: string
  threshold: number
  windowSize: number
  results: Array<{ score: number; isAnomaly: boolean; severity: 'NORMAL' | 'WARNING' | 'CRITICAL' }>
  latencyMs: number
}

/**
 * 工业时序异常推理（Node 侧纯 JS 实现，读取模型训练时产出的 model_meta.json，零外部依赖）
 * 算法与 train_worker.py 的 compute_window_score 完全一致：逐位置标准化偏离度均值。
 */
export async function runTimeseriesInference(req: TimeseriesInferenceRequest): Promise<TimeseriesInferenceResult> {
  const startTime = Date.now()

  const version = await prisma.modelVersion.findUnique({
    where: { id: req.modelVersionId },
    include: { model: true },
  })
  if (!version) throw new Error('模型版本不存在')
  // 多租户校验：模型版本所属模型必须属于当前租户
  if (version.model?.tenantId !== req.tenantId) {
    throw new Error('无权访问该模型版本')
  }
  if (!version.checkpointPath) throw new Error('模型版本缺少 checkpoint 路径')

  const metaPath = path.join(version.checkpointPath, 'model_meta.json')
  if (!fs.existsSync(metaPath)) {
    throw new Error(`模型元数据文件不存在: ${metaPath}`)
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
  const meanVec: number[] = meta.feature_mean
  const stdVec: number[] = meta.feature_std
  const threshold: number = meta.threshold
  const wsize: number = meta.window_size

  const results = req.windows.map(w => {
    if (w.length !== wsize) {
      throw new Error(`窗口长度不一致: 期望 ${wsize}, 实际 ${w.length}`)
    }
    let s = 0
    for (let i = 0; i < wsize; i++) {
      const std = stdVec[i] > 1e-9 ? stdVec[i] : 1e-9
      s += Math.abs(w[i] - meanVec[i]) / std
    }
    const score = s / wsize
    const severity: 'NORMAL' | 'WARNING' | 'CRITICAL' =
      score > threshold * 1.5 ? 'CRITICAL' : score > threshold ? 'WARNING' : 'NORMAL'
    return {
      score: +score.toFixed(4),
      isAnomaly: score > threshold,
      severity,
    }
  })

  logger.info(`工业时序推理完成: ${req.windows.length} 窗口, 阈值 ${threshold}`)
  return {
    modelVersionId: req.modelVersionId,
    threshold,
    windowSize: wsize,
    results,
    latencyMs: Date.now() - startTime,
  }
}

/**
 * 预热模型（服务启动时调用，提前加载常用模型）
 */
export async function warmupModels() {
  const defaultTasks = ["text-classification", "ner"]
  logger.info("推理引擎预热中...")
  for (const task of defaultTasks) {
    try {
      await getPipeline(task)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn("预热失败 " + task + ": " + message)
    }
  }
  logger.info("推理引擎预热完成")
}

/**
 * 列出已加载的模型
 */
export function getLoadedModels() {
  return Array.from(pipelineCache.keys()).map(key => {
    const [task, model] = key.split(":")
    return { task, model }
  })
}

/**
 * 卸载模型（释放内存）
 */
export function unloadModel(task: string, modelName?: string) {
  const key = modelName ? task + ":" + modelName : task
  const matched = Array.from(pipelineCache.keys()).filter(k => k.startsWith(key))
  for (const k of matched) {
    pipelineCache.delete(k)
    logger.info("模型已卸载: " + k)
  }
  return matched
}

// ─── NLP 文本聚类（纯 JS TF-IDF + K-means，零依赖、不联网）───

export interface ClusteringRequest {
  texts: string | string[]
  nClusters?: number   // 默认 2
  maxIter?: number     // 默认 20
}

export interface ClusteringResult {
  nClusters: number
  assignments: number[]            // 每篇文本所属聚类索引
  keywords: Array<{ cluster: number; words: Array<{ word: string; score: number }> }>
  latencyMs: number
}

/**
 * K-means 文本聚类：TF-IDF 向量化 → K-means 迭代 → 返回分配结果和每类关键词。
 * 纯 JS，零外部依赖，不联网。
 */
export function clusterTexts(req: ClusteringRequest): ClusteringResult {
  const startTime = Date.now()
  const nClusters = Math.max(2, req.nClusters || 2)
  const maxIter = Math.max(5, req.maxIter || 20)
  const docs = Array.isArray(req.texts) ? req.texts : [req.texts]
  const N = docs.length

  if (N < nClusters) throw new Error(`文档数量(${N})少于聚类数(${nClusters})`)

  // 1) Tokenize 每篇文档
  const tokenized = docs.map(t => tokenizeZh(t))
  const allTokens = [...new Set(tokenized.flat())]
  const V = allTokens.length

  // 2) TF-IDF 向量
  const idf: number[] = allTokens.map(token => {
    const df = tokenized.filter(t => t.includes(token)).length
    return Math.log((N + 1) / (df + 1)) + 1
  })

  const vectors: number[][] = tokenized.map(tokens => {
    const tf = new Map<string, number>()
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1)
    const total = tokens.length || 1
    return allTokens.map((token, i) => ((tf.get(token) || 0) / total) * idf[i])
  })

  // 3) K-means（K-means++ 初始化）
  const centers: number[][] = []
  // 第一个中心随机选
  centers.push(vectors[Math.floor(Math.random() * N)])
  for (let c = 1; c < nClusters; c++) {
    const dists = vectors.map(v => Math.min(...centers.map(cc => cosineDist(v, cc))))
    const totalDist = dists.reduce((a, b) => a + b, 0)
    let threshold = Math.random() * totalDist
    for (let i = 0; i < N; i++) {
      threshold -= dists[i]
      if (threshold <= 0) { centers.push(vectors[i]); break }
    }
  }

  const assignments: number[] = new Array(N).fill(0)

  for (let iter = 0; iter < maxIter; iter++) {
    // 分配
    for (let i = 0; i < N; i++) {
      let best = 0, bestDist = Infinity
      for (let c = 0; c < nClusters; c++) {
        const d = cosineDist(vectors[i], centers[c])
        if (d < bestDist) { bestDist = d; best = c }
      }
      assignments[i] = best
    }
    // 更新中心
    let moved = 0
    for (let c = 0; c < nClusters; c++) {
      const members = vectors.filter((_, i) => assignments[i] === c)
      if (members.length === 0) continue
      const newCenter = members[0].map((_, dim) => members.reduce((s, v) => s + v[dim], 0) / members.length)
      if (cosineDist(centers[c], newCenter) > 0.001) moved++
      centers[c] = newCenter
    }
    if (moved === 0) break
    // 处理空聚类：重新初始化为最远文档
    for (let c = 0; c < nClusters; c++) {
      if (vectors.filter((_, i) => assignments[i] === c).length === 0) {
        const dists = vectors.map(v => Math.min(...centers.map(cc => cosineDist(v, cc))))
        const farthest = dists.indexOf(Math.max(...dists))
        centers[c] = [...vectors[farthest]]
      }
    }
  }

  // 4) 每类关键词提取
  const keywords: ClusteringResult['keywords'] = []
  for (let c = 0; c < nClusters; c++) {
    const members = docs.filter((_, i) => assignments[i] === c)
    if (members.length === 0) continue
    // 对类内文档做 TF-IDF 取 top 词
    const classTokenized = members.map(t => tokenizeZh(t))
    const classAllTokens = [...new Set(classTokenized.flat())]
    const classIdf = classAllTokens.map(t => {
      const df = classTokenized.filter(d => d.includes(t)).length
      return Math.log((members.length + 1) / (df + 1)) + 1
    })
    const classScores: Array<{ word: string; score: number }> = classAllTokens.map((token, i) => {
      const tf = classTokenized.reduce((s, d) => s + d.filter(t => t === token).length, 0)
      return { word: token, score: (tf / (classTokenized.flat().length || 1)) * classIdf[i] }
    })
    classScores.sort((a, b) => b.score - a.score)
    keywords.push({ cluster: c, words: classScores.slice(0, 10) })
  }

  return { nClusters, assignments, keywords, latencyMs: Date.now() - startTime }
}

function cosineDist(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom > 0 ? 1 - dot / denom : 1
}

// ─── NLP 关键词提取（纯 JS TF-IDF，零依赖、不联网）───

export interface KeywordRequest {
  texts: string | string[]
  topN?: number       // 默认 10
}

export interface KeywordSingleResult {
  text: string
  keywords: Array<{ word: string; score: number }>
}

export interface KeywordResult {
  results: KeywordSingleResult[]
  latencyMs: number
}

/**
 * TF-IDF 关键词提取：将多篇文档作为语料库，计算每个文档中 token 的 TF-IDF 分，
 * 返回每篇文档得分最高的 topN 个关键词。
 * 纯 JS 实现，零外部依赖，不联网。
 */
export function extractKeywords(req: KeywordRequest): KeywordResult {
  const startTime = Date.now()
  const topN = req.topN || 10
  const docs = Array.isArray(req.texts) ? req.texts : [req.texts]
  const N = docs.length

  // 1) 每篇文档的词频
  const docFreqs = docs.map(text => {
    const toks = tokenizeZh(text)
    const freq = new Map<string, number>()
    const seen = new Set<string>()
    for (const t of toks) {
      freq.set(t, (freq.get(t) || 0) + 1)
      seen.add(t)
    }
    return { freq, seen } as { freq: Map<string, number>; seen: Set<string> }
  })

  // 2) 全局 DF（包含某词的文档数）
  const globalDf = new Map<string, number>()
  for (const { seen } of docFreqs) {
    for (const t of seen) {
      globalDf.set(t, (globalDf.get(t) || 0) + 1)
    }
  }

  // 3) 每篇文档 TF-IDF
  const results: KeywordSingleResult[] = docs.map((text, i) => {
    const { freq } = docFreqs[i]
    const totalTerms = Array.from(freq.values()).reduce((a: number, b: number) => a + b, 0) || 1
    const scored: Array<{ word: string; score: number }> = []
    for (const [word, tf] of freq) {
      const df = globalDf.get(word) || 0
      const idf = Math.log((N + 1) / (df + 1)) + 1
      scored.push({ word, score: ((tf as number) / totalTerms) * idf })
    }
    scored.sort((a, b) => b.score - a.score)
    return { text, keywords: scored.slice(0, topN) }
  })

  return { results, latencyMs: Date.now() - startTime }
}

// ─── NLP 文本相似度（纯 JS 余弦相似度，零依赖、不联网）───

export interface TextSimilarityRequest {
  text1: string
  text2: string
}

export interface TextSimilarityResult {
  similarity: number
  latencyMs: number
}

/**
 * 中文文本余弦相似度：将两段文本分别切分为字符 n-gram（unigram + bigram），
 * 构建词袋向量，计算余弦相似度。
 * 纯 JS，零外部依赖，不联网。
 */
export function computeTextSimilarity(req: TextSimilarityRequest): TextSimilarityResult {
  const startTime = Date.now()
  const t1 = tokenizeZh(req.text1).filter(t => t.length > 0)
  const t2 = tokenizeZh(req.text2).filter(t => t.length > 0)

  // 补充 bigram
  function addBigrams(toks: string[]): string[] {
    const result = [...toks]
    for (let i = 0; i < toks.length - 1; i++) {
      result.push(toks[i] + toks[i + 1])
    }
    return result
  }

  const vec1 = addBigrams(t1)
  const vec2 = addBigrams(t2)

  // 构建词袋
  const allWords = new Set([...vec1, ...vec2])
  const f1 = new Map<string, number>()
  const f2 = new Map<string, number>()
  for (const w of vec1) f1.set(w, (f1.get(w) || 0) + 1)
  for (const w of vec2) f2.set(w, (f2.get(w) || 0) + 1)

  // 余弦相似度
  let dot = 0, norm1 = 0, norm2 = 0
  for (const w of allWords) {
    const a = f1.get(w) || 0
    const b = f2.get(w) || 0
    dot += a * b
    norm1 += a * a
    norm2 += b * b
  }
  const denom = Math.sqrt(norm1) * Math.sqrt(norm2)
  const similarity = denom > 0 ? dot / denom : 0

  return { similarity: +similarity.toFixed(4), latencyMs: Date.now() - startTime }
}

// ─── NLP 文本分类推理（纯 JS 复现训练端朴素贝叶斯，零依赖、不联网）───

/**
 * 中英文统一分词：中文按字、英文/数字按词（小写），去标点。
 * 与 train_worker.py 的 _tokenize_zh 完全一致，保证训推同构。
 */
function tokenizeZh(text: string): string[] {
  const lower = String(text).toLowerCase()
  const tokens: string[] = []
  const cn = lower.match(/[一-鿿]/g)
  if (cn) tokens.push(...cn)
  const en = lower.match(/[a-z0-9]+/g)
  if (en) tokens.push(...en)
  return tokens
}

export interface TextClassificationRequest {
  modelVersionId: string
  tenantId: string
  texts: string | string[]
  threshold?: number   // 多标签阈值：> threshold 的标签全部返回（默认 undefined=单标签取最高）
}

export interface TextClassificationSingleResult {
  text: string
  label: string        // 最高概率标签（兼容单标签）
  labels: string[]     // 多标签：概率 > threshold 的所有标签
  scores: Record<string, number>
  probabilities: Record<string, number>
}

export interface TextClassificationResult {
  modelVersionId: string
  labels: string[]
  results: TextClassificationSingleResult[]
  latencyMs: number
}

/**
 * 中文文本分类推理：读取训练产出的纯 JSON 模型（model_meta.json），
 * 用纯 JS 复现多项朴素贝叶斯打分。零外部依赖、不联网、与训练端同模型。
 */
export async function runTextClassificationInference(req: TextClassificationRequest): Promise<TextClassificationResult> {
  const startTime = Date.now()
  const version = await prisma.modelVersion.findUnique({
    where: { id: req.modelVersionId },
    include: { model: true },
  })
  if (!version) throw new Error('模型版本不存在')
  if (version.model?.tenantId !== req.tenantId) throw new Error('无权访问该模型版本')
  if (!version.checkpointPath) throw new Error('模型版本缺少 checkpoint 路径')

  const metaPath = path.join(version.checkpointPath, 'model_meta.json')
  if (!fs.existsSync(metaPath)) throw new Error(`模型元数据文件不存在: ${metaPath}`)
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
  if (meta.model_type !== 'text_classification') throw new Error('该模型版本不是文本分类模型')

  const labels: string[] = meta.labels
  const classLogPrior: Record<string, number> = meta.class_log_prior
  const wordLogProb: Record<string, Record<string, number>> = meta.word_log_prob
  const unknownLogProb: Record<string, number> = meta.unknown_log_prob || {}

  const textArr = Array.isArray(req.texts) ? req.texts : [req.texts]
  const results: TextClassificationSingleResult[] = textArr.map((text) => {
    const toks = tokenizeZh(text)
    const scores: Record<string, number> = {}
    for (const l of labels) {
      let s = classLogPrior[l] ?? 0
      for (const w of toks) {
        s += wordLogProb[l]?.[w] ?? unknownLogProb[l] ?? 0
      }
      scores[l] = s
    }
    const best = labels.reduce((a, b) => (scores[b] > scores[a] ? b : a))
    const maxS = Math.max(...labels.map((l) => scores[l]))
    const exps = labels.map((l) => Math.exp(scores[l] - maxS))
    const sumExp = exps.reduce((a, b) => a + b, 0)
    const probabilities: Record<string, number> = {}
    labels.forEach((l, i) => { probabilities[l] = exps[i] / sumExp })
    // 多标签：概率 > threshold 的所有标签
    const threshold = req.threshold ?? 0
    const labelsAboveThreshold = threshold > 0 ? labels.filter((l) => probabilities[l] >= threshold) : [best]
    return { text, label: best, labels: labelsAboveThreshold.length > 0 ? labelsAboveThreshold : [best], scores, probabilities }
  })

  return {
    modelVersionId: req.modelVersionId,
    labels,
    results,
    latencyMs: Date.now() - startTime,
  }
}
