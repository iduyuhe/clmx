/**
 * NL-Command 自然语言交互（P1-1，零依赖）
 *
 * 用规则 + 关键词槽位填充解析用户话术，路由到现有数据查询或接口。
 * 覆盖高频「只读查询」与部分「触发指令」，不替代完整 UI。
 */
import { prisma } from '../../utils/prisma'
import logger from '../../utils/logger'

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3002'

export interface NlContext {
  tenantId?: string | null
  userId?: string
  authHeader?: string | undefined
}
export interface NlResult {
  reply: string
  action?: string
  data?: unknown
}

function levelFromScore(score: number | null): string {
  if (score == null) return '未知'
  if (score >= 80) return '健康'
  if (score >= 60) return '预警'
  if (score >= 40) return '危险'
  return '严重'
}

function has(text: string, keys: string[]): boolean {
  return keys.some((k) => text.includes(k))
}

function helpText(): string {
  return [
    '我可以帮你用话术操作平台，试试这些：',
    '· 整体概览 / 平台整体情况',
    '· 设备有哪些 / 设备列表',
    '· 健康分最低的是哪台',
    '· 查设备健康（如「查电机A健康」）',
    '· 查某某设备最新读数',
    '· 最近有哪些异常 / 有没有告警',
    '· 待处理工单 / 通知消息',
    '· 训练任务进度 / 有哪些模型',
    '· 重算所有设备健康分（触发）',
    '· 给某某设备建工单（触发）',
  ].join('\n')
}

async function findDevice(ctx: NlContext, text: string) {
  const devices = await prisma.device.findMany({
    where: { tenantId: ctx.tenantId || undefined },
    select: { id: true, name: true, code: true, lastHealthScore: true },
  })
  return devices.find((d) => text.includes(d.name) || text.includes(d.code)) || null
}

function fmtDevice(d: { name: string; code?: string | null; lastHealthScore: number | null }): string {
  const sc = d.lastHealthScore == null ? '暂无评分' : `${d.lastHealthScore}（${levelFromScore(d.lastHealthScore)}）`
  return `${d.name}${d.code ? `（${d.code}）` : ''}：${sc}`
}

export async function handleNlCommand(text: string, ctx: NlContext): Promise<NlResult> {
  const t = (text || '').trim()
  if (!t) return { reply: '请输入你想查询或执行的操作，例如「整体概览」「查设备健康」「最近有哪些异常」。' }

  // 1) 帮助
  if (has(t, ['帮助', '你能', '怎么用', '你会', '干什么', '能做什么'])) {
    return { reply: helpText() }
  }

  const device = await findDevice(ctx, t)

  // 2) 计算 / 重算健康分（指定设备）
  if (has(t, ['计算', '重算', '评']) && device && !has(t, ['所有', '全部'])) {
    try {
      const res = await fetch(`${SERVER_URL}/api/health/device/${device.id}/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: ctx.authHeader || '' },
      })
      const json = (await res.json()) as {
        success?: boolean
        message?: string
        data?: { score?: number; level?: string; id?: string; autoWorkOrder?: { created?: boolean; skipped?: boolean } }
      }
      if (json.success && json.data) {
        const d = json.data
        let reply = `${device.name} 健康分已重算：${d.score}（${d.level}）`
        if (d.autoWorkOrder?.created) reply += '，已自动创建维修工单。'
        else if (d.autoWorkOrder?.skipped) reply += '，近 1 小时已有未关闭工单，已防重复建单。'
        return { reply, action: 'calculate', data: { ...d, name: device.name } }
      }
      return { reply: `重算失败：${json.message || '未知错误'}` }
    } catch (e) {
      logger.warn('NL 计算健康分失败: ' + (e as Error).message)
      return { reply: '重算请求失败，请稍后在设备详情页手动计算。' }
    }
  }

  // 3) 触发：重算所有设备健康分（须先于设备列表判断，避免「所有设备」命中列表意图）
  if (has(t, ['所有', '全部']) && has(t, ['重算', '计算', '刷新', '评'])) {
    const devices = await prisma.device.findMany({
      where: { tenantId: ctx.tenantId || undefined },
      select: { id: true, name: true },
    })
    let created = 0
    let skipped = 0
    let ok = 0
    for (const d of devices) {
      try {
        const res = await fetch(`${SERVER_URL}/api/health/device/${d.id}/calculate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: ctx.authHeader || '' },
        })
        const json = (await res.json()) as { data?: { autoWorkOrder?: { created?: boolean; skipped?: boolean } } }
        if (json.data?.autoWorkOrder?.created) created++
        else if (json.data?.autoWorkOrder?.skipped) skipped++
        else ok++
      } catch {
        /* ignore single device failure */
      }
    }
    return {
      reply: `已完成全部 ${devices.length} 台设备的健康分重算：新建工单 ${created} 个，防重复跳过 ${skipped} 个，无异常 ${ok} 个。`,
      action: 'recalc-all',
      data: { total: devices.length, created, skipped, ok },
    }
  }

  // 4) 整体概览（dashboard）
  if (has(t, ['概览', '整体', '总览', '大盘', '总体', '平台情况', '全网'])) {
    const [devices, openOrders, jobs, models, notifs] = await Promise.all([
      prisma.device.findMany({ where: { tenantId: ctx.tenantId || undefined }, select: { lastHealthScore: true } }),
      prisma.maintenanceOrder.count({
        where: { tenantId: ctx.tenantId || undefined, status: { in: ['PENDING', 'ASSIGNED', 'IN_PROGRESS'] } },
      }),
      prisma.trainingJob.count({ where: { tenantId: ctx.tenantId || undefined, status: { in: ['RUNNING', 'PENDING'] } } }),
      prisma.aiModel.count({ where: { tenantId: ctx.tenantId || undefined } }),
      prisma.notification.count({ where: { tenantId: ctx.tenantId || undefined, read: false } }),
    ])
    const scored = devices.map((d) => d.lastHealthScore).filter((s): s is number => s != null)
    const anomaly = scored.filter((s) => s < 60).length
    const healthy = scored.filter((s) => s >= 60).length
    const reply =
      `平台整体概览：共 ${devices.length} 台设备，其中健康 ${healthy} 台、异常 ${anomaly} 台；` +
      `待处理工单 ${openOrders} 个，未读通知 ${notifs} 条；进行中训练 ${jobs} 个，模型总数 ${models} 个。`
    return {
      reply,
      action: 'dashboard',
      data: { devices: devices.length, healthy, anomaly, openOrders, trainings: jobs, models, unread: notifs },
    }
  }

  // 4) 设备列表
  if (has(t, ['设备有哪些', '设备列表', '所有设备', '几台设备', '一共有', '设备一共', '有哪些设备'])) {
    const devices = await prisma.device.findMany({
      where: { tenantId: ctx.tenantId || undefined },
      select: { id: true, name: true, code: true, lastHealthScore: true, status: true },
      orderBy: { lastHealthScore: 'asc' },
    })
    if (devices.length === 0) return { reply: '当前租户下还没有设备。' }
    const lines = devices.map((d, i) => `${i + 1}. ${fmtDevice(d)}`).join('\n')
    return { reply: `设备列表（共 ${devices.length} 台）：\n${lines}`, action: 'device-list', data: devices }
  }

  // 5) 健康分最低的设备
  if (has(t, ['最低', '最差', '最不健康', '最不好', '哪台最', '最危险'])) {
    const devices = await prisma.device.findMany({
      where: { tenantId: ctx.tenantId || undefined, lastHealthScore: { not: null } },
      select: { id: true, name: true, code: true, lastHealthScore: true },
      orderBy: { lastHealthScore: 'asc' },
      take: 1,
    })
    if (devices.length === 0) return { reply: '还没有设备计算过健康分，先去设备详情点「计算健康分」。' }
    const d = devices[0]
    return {
      reply: `健康分最低的是 ${d.name}：${d.lastHealthScore}（${levelFromScore(d.lastHealthScore)}），建议优先排查。`,
      action: 'worst-device',
      data: { id: d.id, name: d.name, code: d.code, lastHealthScore: d.lastHealthScore },
    }
  }

  // 6) 最新读数 / 实时传感器数据
  if (has(t, ['最新读数', '实时数据', '实时', '传感器数据', '最新数据', '当前读数']) && device) {
    const sensors = await prisma.sensor.findMany({
      where: { deviceId: device.id, status: 'ACTIVE' },
      select: { id: true, name: true, unit: true, channel: true },
    })
    const sensorsWithReading = await Promise.all(
      sensors.map(async (s) => {
        const latest = await prisma.sensorData.findFirst({ where: { sensorId: s.id }, orderBy: { timestamp: 'desc' } })
        return { id: s.id, name: s.name, unit: s.unit, channel: s.channel, value: latest?.value ?? null, timestamp: latest?.timestamp ?? null }
      }),
    )
    if (sensorsWithReading.length === 0) return { reply: `${device.name} 暂无可用的传感器或读数。` }
    const reply = `${device.name} 最新读数：\n` + sensorsWithReading.map((s) => `· ${s.name}：${s.value ?? '—'}${s.unit || ''}`).join('\n')
    return { reply, action: 'latest-reading', data: { deviceName: device.name, sensors: sensorsWithReading } }
  }

  // 8) 触发：给指定设备建工单
  if (has(t, ['建工单', '报修', '开工单', '派单', '创建工单']) && device) {
    const order = await prisma.maintenanceOrder.create({
      data: {
        tenantId: ctx.tenantId!,
        deviceId: device.id,
        type: 'PREVENTIVE',
        priority: 'MEDIUM',
        title: `${device.name} 报修工单`,
        description: `由 CLMX 智能助手手动创建。`,
        healthScore: device.lastHealthScore ?? undefined,
      },
    })
    return {
      reply: `已为 ${device.name} 创建报修工单（${order.id.slice(0, 8)}），可在「维修工单」查看与跟进。`,
      action: 'create-ticket',
      data: { orderId: order.id, title: order.title, deviceName: device.name },
    }
  }

  // 9) 设备健康查询（指定设备 / 全部列表）
  if (has(t, ['健康', '评分', '分数', '状态'])) {
    if (device) return { reply: fmtDevice(device), action: 'device-health', data: { ...device } }
    const devices = await prisma.device.findMany({
      where: { tenantId: ctx.tenantId || undefined },
      select: { id: true, name: true, code: true, lastHealthScore: true },
      orderBy: { lastHealthScore: 'asc' },
      take: 8,
    })
    if (devices.length === 0) return { reply: '当前租户下还没有设备。' }
    const lines = devices.filter((d) => d.lastHealthScore != null).map((d, i) => `${i + 1}. ${fmtDevice(d)}`)
    return {
      reply: lines.length ? '设备健康分（由低到高）：\n' + lines.join('\n') : '设备尚未计算健康分，先去设备详情点「计算健康分」。',
      action: 'device-health-list',
      data: devices,
    }
  }

  // 10) 异常 / 告警
  if (has(t, ['异常', '告警', '报警', '危险', '严重'])) {
    const bad = await prisma.device.findMany({
      where: { tenantId: ctx.tenantId || undefined, lastHealthScore: { lt: 60 } },
      select: { name: true, lastHealthScore: true },
    })
    const openOrders = await prisma.maintenanceOrder.count({
      where: { tenantId: ctx.tenantId || undefined, status: { in: ['PENDING', 'ASSIGNED', 'IN_PROGRESS'] } },
    })
    if (bad.length === 0 && openOrders === 0) return { reply: '当前没有严重异常，设备整体健康。' }
    const lines = bad.map((d) => `· ${d.name}：健康分 ${d.lastHealthScore}（${levelFromScore(d.lastHealthScore)}）`)
    return {
      reply: `检测到 ${bad.length} 台设备健康分低于 60，未关闭工单 ${openOrders} 个。\n` + (lines.join('\n') || ''),
      action: 'anomaly',
      data: { bad, openOrders },
    }
  }

  // 11) 通知 / 消息
  if (has(t, ['通知', '消息', '提醒', '站内信', '未读'])) {
    const notifs = await prisma.notification.findMany({
      where: { tenantId: ctx.tenantId || undefined },
      orderBy: { createdAt: 'desc' },
      take: 8,
    })
    if (notifs.length === 0) return { reply: '暂无通知消息。' }
    const lines = notifs.map(
      (n, i) => `${i + 1}. [${n.read ? '已读' : '未读'}] ${n.title}：${n.body.slice(0, 40)}`,
    )
    return { reply: `最近通知（${notifs.length} 条）：\n` + lines.join('\n'), action: 'notifications', data: notifs }
  }

  // 12) 工单
  if (has(t, ['工单'])) {
    const orders = await prisma.maintenanceOrder.findMany({
      where: { tenantId: ctx.tenantId || undefined, status: { in: ['PENDING', 'ASSIGNED', 'IN_PROGRESS'] } },
      include: { device: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })
    if (orders.length === 0) return { reply: '当前没有待处理工单。' }
    const lines = orders.map((o, i) => `${i + 1}. [${o.status}] ${o.title}（${o.device?.name || '-'}）`)
    return { reply: `待处理工单 ${orders.length} 个：\n` + lines.join('\n'), action: 'orders', data: orders }
  }

  // 13) 训练
  if (has(t, ['训练'])) {
    const jobs = await prisma.trainingJob.findMany({
      where: { tenantId: ctx.tenantId || undefined },
      include: { model: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    })
    if (jobs.length === 0) return { reply: '还没有训练任务。' }
    const lines = jobs.map((j, i) => `${i + 1}. ${j.model?.name || '-'}：${j.status}（进度 ${j.progress}%）`)
    return { reply: '近期训练任务：\n' + lines.join('\n'), action: 'training', data: jobs }
  }

  // 14) 模型
  if (has(t, ['模型'])) {
    const models = await prisma.aiModel.findMany({
      where: { tenantId: ctx.tenantId || undefined },
      select: { id: true, name: true, status: true, baseModel: true },
      take: 10,
    })
    if (models.length === 0) return { reply: '还没有模型，先去模型管理创建并训练一个。' }
    const lines = models.map((m, i) => `${i + 1}. ${m.name}（${m.baseModel}）· ${m.status}`)
    return { reply: '已有模型：\n' + lines.join('\n'), action: 'models', data: models }
  }

  // 15) 兜底
  return {
    reply: '我还不太理解这句话。可以试试：「整体概览」「设备有哪些」「健康分最低的是哪台」「查设备健康」「最近有哪些异常」「待处理工单」「训练任务进度」「有哪些模型」。输入「帮助」看全部能力。',
  }
}
