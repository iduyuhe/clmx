/**
 * 采集驱动自测（HubPort 思想融合 · 阶段5）
 *
 * 用 new Function 在进程内执行生成的 collect()（零依赖、确定性、无网络），
 * 验证驱动能正确从报文提取有限数值——这就是「创建时充分测试、运行时零 AI」的闭环验证。
 */
import type { IngestPoint } from './generator'

export interface SelfTestResult {
  passed: boolean
  expectedCount: number
  gotCount: number
  readings: { key: string; name?: string; unit?: string; value: number }[]
  missing: string[] // 期望点位但未产出
  errors: string[]
}

function buildSyntheticPayload(points: IngestPoint[]): Record<string, number> {
  // 用常见量程给每个点位一个可测样本值
  const sampleByKey: Record<string, number> = {
    temperature: 25.3,
    humidity: 58,
    pressure: 1.2,
    vibration: 3.4,
    rotation_speed: 1480,
    current: 12.5,
    voltage: 380,
    power: 45.2,
    flow: 120,
    level: 76,
    frequency: 50,
    torque: 88,
  }
  const payload: Record<string, number> = {}
  for (const p of points) payload[p.key] = sampleByKey[p.key] ?? 42
  return payload
}

export function runSelfTest(args: {
  driverCode: string
  thingModel: IngestPoint[]
  sampleData?: string | null
}): SelfTestResult {
  const { driverCode, thingModel, sampleData } = args
  const errors: string[] = []
  const result: SelfTestResult = {
    passed: false,
    expectedCount: thingModel.length,
    gotCount: 0,
    readings: [],
    missing: [],
    errors,
  }

  if (!thingModel.length) {
    errors.push('物模型为空，无点位可测。')
    return result
  }

  // 解析执行驱动
  let collect: (ctx: any) => any
  try {
    // eslint-disable-next-line no-new-func
    collect = new Function('ctx', `${driverCode}\n return collect(ctx);`) as any
  } catch (e: any) {
    errors.push('驱动代码编译失败：' + (e?.message || String(e)))
    return result
  }

  let payload: Record<string, unknown>
  if (sampleData && sampleData.trim()) {
    try {
      payload = JSON.parse(sampleData)
    } catch {
      errors.push('sampleData 不是合法 JSON，改用语义样本。')
      payload = buildSyntheticPayload(thingModel)
    }
  } else {
    payload = buildSyntheticPayload(thingModel)
  }

  let readings: any
  try {
    readings = collect({ payload, now: Date.now() })
  } catch (e: any) {
    errors.push('驱动执行异常：' + (e?.message || String(e)))
    return result
  }
  if (!Array.isArray(readings)) {
    errors.push('collect() 未返回数组。')
    return result
  }

  result.readings = readings
    .filter((r) => r && typeof r.value === 'number' && isFinite(r.value))
    .map((r) => ({ key: r.key, name: r.name, unit: r.unit, value: r.value }))
  result.gotCount = result.readings.length

  const gotKeys = new Set(result.readings.map((r) => r.key))
  result.missing = thingModel.map((p) => p.key).filter((k) => !gotKeys.has(k))
  if (result.missing.length) errors.push('以下点位未产出读数：' + result.missing.join(', '))

  result.passed = result.gotCount > 0 && result.missing.length === 0 && errors.length === 0
  return result
}
