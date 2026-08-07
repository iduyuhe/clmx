/**
 * AI 原生接入生成器内核（HubPort 思想融合 · 阶段5）
 *
 * 设计原则（T2：创建时生成 / 运行时零依赖）：
 * - 这里产出的「物模型 + 采集驱动」是确定性 JS，运行时只执行 collect()，绝不调用 LLM。
 * - LLM 仅「生成时」可选参与点位提取，且默认关闭（零依赖运行）；缺省走规则/启发式/样本推断。
 *
 * 输入：接入需求（自由文本描述 / 结构化 JSON / 样本数据）
 * 输出：{ thingModel, driverCode, points, from, notes }
 */

export interface IngestPoint {
  key: string // 点位通道键，如 temperature
  name: string // 显示名，如 温度
  unit: string
  type: string // 目前统一 number
}

export interface GenerateResult {
  thingModel: IngestPoint[]
  driverCode: string
  points: IngestPoint[]
  from: 'json' | 'sample' | 'heuristic' | 'llm' | 'empty'
  notes: string[]
}

export interface GenerateInput {
  name: string
  description: string
  sourceType: string
  sourceUrl?: string | null
  rawSpec: string
  sampleData?: string | null
}

// ─── 工具：清洗点位键（仅字母数字下划线，首字符非数字） ────────────
export function sanitizeKey(s: string): string {
  let k = (s || '')
    .trim()
    .replace(/[\s\-./]+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .toLowerCase()
  if (!k) k = 'point'
  if (/^[0-9]/.test(k)) k = '_' + k
  return k
}

function normalizePoint(raw: any): IngestPoint | null {
  if (!raw) return null
  const name = String(raw.name || raw.key || raw.label || '').trim()
  if (!name) return null
  const key = sanitizeKey(String(raw.key || raw.name))
  return {
    key,
    name,
    unit: String(raw.unit || '').trim(),
    type: String(raw.type || 'number'),
  }
}

// ─── 常见工业测点词典（启发式提取用，零 LLM） ───────────────────
const TERM_MAP: { re: RegExp; key: string; name: string; unit: string }[] = [
  { re: /温度|temperature|temp/i, key: 'temperature', name: '温度', unit: '℃' },
  { re: /湿度|humidity/i, key: 'humidity', name: '湿度', unit: '%' },
  { re: /压力|pressure/i, key: 'pressure', name: '压力', unit: 'MPa' },
  { re: /振动|vibration|震幅|加速度/i, key: 'vibration', name: '振动', unit: 'mm/s' },
  { re: /转速|rpm|speed|转(速|数)/i, key: 'rotation_speed', name: '转速', unit: 'rpm' },
  { re: /电流|current/i, key: 'current', name: '电流', unit: 'A' },
  { re: /电压|voltage/i, key: 'voltage', name: '电压', unit: 'V' },
  { re: /功率|power|kw\b/i, key: 'power', name: '功率', unit: 'kW' },
  { re: /流量|flow/i, key: 'flow', name: '流量', unit: 'm³/h' },
  { re: /液位|料位|level/i, key: 'level', name: '液位', unit: '%' },
  { re: /频率|frequency|freq/i, key: 'frequency', name: '频率', unit: 'Hz' },
  { re: /扭矩|torque/i, key: 'torque', name: '扭矩', unit: 'N·m' },
]

function heuristicFromText(text: string): IngestPoint[] {
  const points: IngestPoint[] = []
  const seen = new Set<string>()
  for (const t of TERM_MAP) {
    if (t.re.test(text) && !seen.has(t.key)) {
      seen.add(t.key)
      points.push({ key: t.key, name: t.name, unit: t.unit, type: 'number' })
    }
  }
  return points
}

function deriveFromSample(sample: any): IngestPoint[] {
  const points: IngestPoint[] = []
  const seen = new Set<string>()
  const pick = (obj: any, prefix = '') => {
    if (!obj || typeof obj !== 'object') return
    for (const k of Object.keys(obj)) {
      const v = obj[k]
      const full = prefix ? `${prefix}_${k}` : k
      if (typeof v === 'number' && isFinite(v)) {
        const key = sanitizeKey(full)
        if (!seen.has(key)) {
          seen.add(key)
          points.push({ key, name: full, unit: '', type: 'number' })
        }
      } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        pick(v, full) // 一层嵌套展平
      }
    }
  }
  pick(sample)
  return points
}

// ─── 可选 LLM 点位提取（生成时使用，缺省关闭） ───────────────────
// 仅当 CLMX_LLM_BASE_URL / CLMX_LLM_API_KEY / CLMX_LLM_MODEL 全部配置时启用。
// 使用 OpenAI 兼容 Chat Completions 协议，零额外 npm 依赖（Node 全局 fetch）。
interface LlmPoint {
  name: string
  unit?: string
}
export async function llmExtractPoints(text: string): Promise<IngestPoint[] | null> {
  const base = process.env.CLMX_LLM_BASE_URL
  const key = process.env.CLMX_LLM_API_KEY
  const model = process.env.CLMX_LLM_MODEL
  if (!base || !key || !model) return null
  try {
    const prompt =
      '你是从设备协议/描述中提取工业测点的助手。请从下列文本中提取所有可量化的测点，' +
      '返回严格 JSON 数组，元素形如 {"name":"温度","unit":"℃"}。只返回 JSON，不要解释。\n\n文本：\n' +
      text
    const resp = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
      }),
    })
    if (!resp.ok) return null
    const json = (await resp.json()) as any
    const content = json?.choices?.[0]?.message?.content || ''
    const arr = JSON.parse(content.replace(/```json|```/g, '').trim()) as LlmPoint[]
    if (!Array.isArray(arr)) return null
    return arr.map(normalizePoint).filter((p): p is IngestPoint => p !== null)
  } catch {
    return null
  }
}

// ─── 驱动代码生成（零依赖确定性 JS） ────────────────────────────
export function buildDriverCode(points: IngestPoint[]): string {
  const lines = points.map(
    (p) =>
      `  out.push({ key: ${JSON.stringify(p.key)}, name: ${JSON.stringify(p.name)}, unit: ${JSON.stringify(
        p.unit,
      )}, value: Number(p[${JSON.stringify(p.key)}]), ts: now });`,
  )
  return `// CLMX 自动生成的采集驱动（零依赖 · 确定性）
// 运行时仅执行 collect()，不调用任何 LLM / 外部 AI 服务。
// ctx: { payload: <解析后的报文对象>, now: <毫秒时间戳(可选)> }
function collect(ctx) {
  const p = (ctx && ctx.payload) || {};
  const now = (ctx && ctx.now) || Date.now();
  const out = [];
${lines.join('\n')}
  // 过滤掉非有限数值，保证入库质量
  return out.filter(function (r) { return typeof r.value === 'number' && isFinite(r.value); });
}`
}

// ─── 主入口：从接入需求生成物模型 + 驱动 ────────────────────────
export async function generateFromSpec(input: GenerateInput): Promise<GenerateResult> {
  const notes: string[] = []
  let points: IngestPoint[] = []
  let from: GenerateResult['from'] = 'empty'

  // 1) 结构化 JSON 直接给出点位
  if (input.rawSpec && input.rawSpec.trim()) {
    try {
      const obj = JSON.parse(input.rawSpec)
      if (Array.isArray(obj.points) && obj.points.length) {
        const pts = obj.points.map(normalizePoint).filter((p: IngestPoint | null): p is IngestPoint => p !== null)
        if (pts.length) {
          points = pts
          from = 'json'
        }
      } else if (obj.payloadSample) {
        const s = deriveFromSample(obj.payloadSample)
        if (s.length) {
          points = s
          from = 'sample'
          notes.push('从 rawSpec.payloadSample 推断点位。')
        }
      }
    } catch {
      /* 不是 JSON，走后续启发式 */
    }
  }

  // 2) 样本数据推断
  if (!points.length && input.sampleData && input.sampleData.trim()) {
    try {
      const s = deriveFromSample(JSON.parse(input.sampleData))
      if (s.length) {
        points = s
        from = 'sample'
        notes.push('从样本数据推断点位。')
      }
    } catch {
      /* ignore */
    }
  }

  // 3) 描述启发式（零 LLM）
  if (!points.length && input.description) {
    const h = heuristicFromText(input.description)
    if (h.length) {
      points = h
      from = 'heuristic'
      notes.push('已从描述启发式提取测点；如需更精确，可在 rawSpec 提供结构化点位或样本数据。')
    }
  }

  // 4) 可选 LLM（生成时使用）
  if (!points.length && input.description) {
    const llm = await llmExtractPoints(input.description)
    if (llm && llm.length) {
      points = llm
      from = 'llm'
      notes.push('已使用可选 LLM 提取测点（仅生成阶段）。')
    }
  }

  if (!points.length) {
    notes.push('未能提取到任何测点：请提供结构化 rawSpec（含 points 数组）、样本数据，或在描述中包含已知测点（温度/压力/振动等）。')
  }

  const driverCode = points.length ? buildDriverCode(points) : buildDriverCode([])
  return { thingModel: points, driverCode, points, from, notes }
}
