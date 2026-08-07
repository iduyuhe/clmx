/**
 * clmx-inference —— 纯 JS 推理引擎
 *
 * 零依赖、不联网、训推同构。
 * 读入训练产出的 model_meta.json 即可推理。
 *
 * 用法:
 *   const { loadModel, predict } = require('clmx-inference')
 *   const model = loadModel('./model_meta.json')
 *   const result = predict(model, '产品质量很好，非常推荐')
 *   console.log(result.label) // '正面'
 */

// ─── 分词（与 Python 训练端 _tokenize_zh 完全一致）────
function tokenizeZh(text) {
  const lower = String(text).toLowerCase()
  const tokens = []
  const cn = lower.match(/[\u4e00-\u9fff]/g)
  if (cn) tokens.push(...cn)
  const en = lower.match(/[a-z0-9]+/g)
  if (en) tokens.push(...en)
  return tokens
}

// ─── 模型类型识别 ─────────────────────────
function detectModelType(meta) {
  if (meta.model_type === 'text_classification') return 'text_classification'
  if (meta.feature_mean && meta.window_size) return 'timeseries'
  return 'unknown'
}

// ─── 文本分类推理（朴素贝叶斯）──────────────
function predictTextClassification(meta, text) {
  const labels = meta.labels
  const classLogPrior = meta.class_log_prior
  const wordLogProb = meta.word_log_prob
  const unknownLogProb = meta.unknown_log_prob || {}

  const tokens = tokenizeZh(text)
  const scores = {}
  for (const l of labels) {
    let s = classLogPrior[l] ?? 0
    for (const w of tokens) {
      s += wordLogProb[l]?.[w] ?? unknownLogProb[l] ?? 0
    }
    scores[l] = s
  }

  const best = labels.reduce((a, b) => (scores[b] > scores[a] ? b : a))
  const maxS = Math.max(...labels.map((l) => scores[l]))
  const exps = labels.map((l) => Math.exp(scores[l] - maxS))
  const sumExp = exps.reduce((a, b) => a + b, 0)
  const probabilities = {}
  labels.forEach((l, i) => { probabilities[l] = exps[i] / sumExp })

  return { label: best, scores, probabilities }
}

// ─── 时序异常推理（标准化偏离度）────────────
function predictTimeseries(meta, window) {
  const meanVec = meta.feature_mean
  const stdVec = meta.feature_std
  const threshold = meta.threshold
  const wsize = meta.window_size

  if (!Array.isArray(window)) throw new Error('window 必须是数组')
  if (window.length !== wsize) throw new Error(`窗口长度不匹配: 期望 ${wsize}, 实际 ${window.length}`)

  let s = 0
  for (let i = 0; i < wsize; i++) {
    const std = stdVec[i] > 1e-9 ? stdVec[i] : 1e-9
    s += Math.abs(window[i] - meanVec[i]) / std
  }
  const score = +((s / wsize).toFixed(4))
  const severity = score > threshold * 1.5 ? 'CRITICAL' : score > threshold ? 'WARNING' : 'NORMAL'
  return { score, isAnomaly: score > threshold, severity }
}

// ─── 关键词提取（TF-IDF）────────────────────
function extractKeywords(docs, topN) {
  topN = topN || 10
  const N = docs.length
  const tokenized = docs.map(t => tokenizeZh(t))
  const allTokens = [...new Set(tokenized.flat())]

  const idf = allTokens.map(token => {
    const df = tokenized.filter(t => t.includes(token)).length
    return Math.log((N + 1) / (df + 1)) + 1
  })

  return docs.map((text, i) => {
    const toks = tokenized[i]
    const total = toks.length || 1
    const freq = new Map()
    for (const t of toks) freq.set(t, (freq.get(t) || 0) + 1)
    const scored = allTokens
      .filter((_, j) => freq.has(allTokens[j]))
      .map((word, j) => ({ word, score: ((freq.get(word) || 0) / total) * idf[j] }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topN)
    return { text, keywords: scored }
  })
}

// ─── 文本相似度（余弦）──────────────────────
function textSimilarity(text1, text2) {
  const t1 = tokenizeZh(text1)
  const t2 = tokenizeZh(text2)
  function addBigrams(toks) {
    const r = [...toks]
    for (let i = 0; i < toks.length - 1; i++) r.push(toks[i] + toks[i + 1])
    return r
  }
  const v1 = addBigrams(t1), v2 = addBigrams(t2)
  const all = new Set([...v1, ...v2])
  const f1 = new Map(), f2 = new Map()
  for (const w of v1) f1.set(w, (f1.get(w) || 0) + 1)
  for (const w of v2) f2.set(w, (f2.get(w) || 0) + 1)
  let dot = 0, n1 = 0, n2 = 0
  for (const w of all) {
    const a = f1.get(w) || 0, b = f2.get(w) || 0
    dot += a * b; n1 += a * a; n2 += b * b
  }
  const denom = Math.sqrt(n1) * Math.sqrt(n2)
  return +(denom > 0 ? dot / denom : 0).toFixed(4)
}

// ─── 文本聚类（TF-IDF + K-means）─────────────
function clusterTexts(texts, nClusters) {
  nClusters = nClusters || 2
  const N = texts.length
  const tokenized = texts.map(t => tokenizeZh(t))
  const allTokens = [...new Set(tokenized.flat())]
  const V = allTokens.length
  const idf = allTokens.map(t => Math.log((N + 1) / (tokenized.filter(d => d.includes(t)).length + 1)) + 1)
  const vectors = tokenized.map(tokens => {
    const tf = new Map(); for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1)
    return allTokens.map((token, i) => ((tf.get(token) || 0) / (tokens.length || 1)) * idf[i])
  })
  function cosineDist(a, b) {
    let dot = 0, na = 0, nb = 0
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
    const d = Math.sqrt(na) * Math.sqrt(nb)
    return d > 0 ? 1 - dot / d : 1
  }
  // K-means++
  const centers = [vectors[Math.floor(Math.random() * N)]]
  for (let c = 1; c < nClusters; c++) {
    const dists = vectors.map(v => Math.min(...centers.map(cc => cosineDist(v, cc))))
    const total = dists.reduce((a, b) => a + b, 0)
    let threshold = Math.random() * total
    for (let i = 0; i < N; i++) { threshold -= dists[i]; if (threshold <= 0) { centers.push(vectors[i]); break } }
  }
  const assignments = new Array(N).fill(0)
  for (let iter = 0; iter < 20; iter++) {
    let moved = 0
    for (let i = 0; i < N; i++) {
      let best = 0, bestDist = Infinity
      for (let c = 0; c < nClusters; c++) { const d = cosineDist(vectors[i], centers[c]); if (d < bestDist) { bestDist = d; best = c } }
      assignments[i] = best
    }
    for (let c = 0; c < nClusters; c++) {
      const members = vectors.filter((_, i) => assignments[i] === c)
      if (members.length === 0) continue
      const nc = members[0].map((_, dim) => members.reduce((s, v) => s + v[dim], 0) / members.length)
      if (cosineDist(centers[c], nc) > 0.001) moved++
      centers[c] = nc
    }
    if (moved === 0) break
    for (let c = 0; c < nClusters; c++) {
      if (vectors.filter((_, i) => assignments[i] === c).length === 0) {
        const dists = vectors.map(v => Math.min(...centers.map(cc => cosineDist(v, cc))))
        centers[c] = [...vectors[dists.indexOf(Math.max(...dists))]]
      }
    }
  }
  // 类关键词
  const keywords = []
  for (let c = 0; c < nClusters; c++) {
    const members = texts.filter((_, i) => assignments[i] === c)
    const ct = members.map(t => tokenizeZh(t))
    const ca = [...new Set(ct.flat())]
    const cidf = ca.map(t => Math.log((members.length + 1) / (ct.filter(d => d.includes(t)).length + 1)) + 1)
    const cs = ca.map((t, i) => {
      const tf = ct.reduce((s, d) => s + d.filter(x => x === t).length, 0)
      return { word: t, score: (tf / (ct.flat().length || 1)) * cidf[i] }
    }).sort((a, b) => b.score - a.score).slice(0, 5)
    keywords.push({ cluster: c, words: cs })
  }
  return { nClusters, assignments, keywords }
}

// ─── 公开 API ─────────────────────────────

/**
 * 加载训练产出的 model_meta.json 文件
 * @param {string} metaPath - 模型文件的路径
 * @returns {object} model - 模型对象
 */
function loadModel(metaPath) {
  const meta = JSON.parse(require('fs').readFileSync(metaPath, 'utf-8'))
  const type = detectModelType(meta)
  if (type === 'unknown') throw new Error('无法识别的模型类型')
  return { meta, type }
}

/**
 * 对输入文本/窗口执行推理
 * @param {object} model - loadModel 返回的模型对象
 * @param {string|number[]} input - 文本分类: 字符串; 时序异常: number[] 数组
 * @param {object} [options] - 额外选项
 * @returns {object} 推理结果
 */
function predict(model, input, options) {
  const start = Date.now()
  let result
  if (model.type === 'text_classification') {
    result = predictTextClassification(model.meta, input)
  } else if (model.type === 'timeseries') {
    result = predictTimeseries(model.meta, input)
  }
  return { ...result, latencyMs: Date.now() - start }
}

/**
 * 批量推理
 * @param {object} model - loadModel 返回的模型对象
 * @param {string[]|number[][]} inputs - 输入数组
 * @returns {object[]} 推理结果数组
 */
function predictBatch(model, inputs) {
  return inputs.map(input => predict(model, input))
}

module.exports = {
  loadModel,
  predict,
  predictBatch,
  tokenizeZh,
  extractKeywords,
  textSimilarity,
  clusterTexts,
}
