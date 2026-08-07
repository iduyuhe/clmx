/**
 * CLMX 演示数据生成器
 *
 * 用途：给空白租户一键灌入"看起来真实"的工业设备 + 时序遥测 + 健康分 + 工单 +
 *       告警规则 + 通知，便于演示与销售讲解。
 *
 * 设计要点：
 *  - 全部资源以 `DEMO-` 前缀（设备 code / 工单 title / 告警 name）或固定标记
 *    （通知 relatedId='DEMO'）写入，clear() 只删这些标记数据，绝不碰用户真实数据。
 *  - generate() 幂等：每次先 clear 再重建，重复点击不堆积。
 *  - 时序数据为"基线 + 日周期正弦 + 退化趋势 + 噪声"，使趋势图有看头，并让部分设备
 *    在末端出现健康分下滑，演示"预警 → 工单"场景。
 *  - 遥测写入按批 createMany，避免逐条 insert；并按行数累加 Tenant.storageUsed。
 */
import { Router } from 'express'
import { prisma } from '../../utils/prisma'
import { authMiddleware, requireRole, AuthRequest } from '../../middleware/auth.middleware'
import { asyncHandler } from '../../utils/asyncHandler'
import logger from '../../utils/logger'
import fs from 'fs'
import path from 'path'

const router = Router()

type Scale = 'small' | 'medium' | 'large'

interface ScaleCfg {
  devices: number
  sensorsPer: number
  historyDays: number
  pointsPerDay: number
}
const SCALES: Record<Scale, ScaleCfg> = {
  small: { devices: 3, sensorsPer: 3, historyDays: 14, pointsPerDay: 4 },
  medium: { devices: 5, sensorsPer: 4, historyDays: 30, pointsPerDay: 8 },
  large: { devices: 8, sensorsPer: 5, historyDays: 60, pointsPerDay: 12 },
}

interface SensorDef {
  name: string
  channel: string
  unit: string
  base: number
  amp: number
  min: number
  max: number
  degr: number // 退化系数：正=越用越糟，负=越用越低
  isVib?: boolean
}

const SENSOR_DEFS: SensorDef[] = [
  { name: '振动', channel: 'vib', unit: 'mm/s', base: 2.4, amp: 1.2, min: 0, max: 8, degr: 1.0, isVib: true },
  { name: '温度', channel: 'temp', unit: '℃', base: 55, amp: 8, min: 0, max: 95, degr: 0.4 },
  { name: '压力', channel: 'pres', unit: 'bar', base: 6.0, amp: 1.0, min: 0, max: 12, degr: 0.2 },
  { name: '电流', channel: 'amp', unit: 'A', base: 12, amp: 2, min: 0, max: 30, degr: 0.5 },
  { name: '转速', channel: 'rpm', unit: 'rpm', base: 1480, amp: 60, min: 0, max: 2000, degr: -0.3 },
]

const DEVICE_TEMPLATES = [
  { name: '1# 主风机', code: 'DEMO-FAN-01', category: 'fan', manu: '沈鼓集团', model: 'G4-73', endHealth: 52 },
  { name: '2# 冷却泵', code: 'DEMO-PUMP-02', category: 'pump', manu: '凯泉泵业', model: 'KQSN', endHealth: 68 },
  { name: '3# 空压机', code: 'DEMO-COMP-03', category: 'compressor', manu: '阿特拉斯', model: 'GA90', endHealth: 74 },
  { name: '4# 传送带电机', code: 'DEMO-MOTOR-04', category: 'motor', manu: 'ABB', model: 'M3BP', endHealth: 88 },
  { name: '5# 液压站', code: 'DEMO-HYD-05', category: 'hydraulic', manu: '力士乐', model: 'A10VSO', endHealth: 91 },
  { name: '6# 齿轮箱', code: 'DEMO-GEAR-06', category: 'gearbox', manu: 'SEW', model: 'R97', endHealth: 83 },
  { name: '7# 离心机', code: 'DEMO-CENT-07', category: 'centrifuge', manu: 'Andritz', model: 'CVX', endHealth: 90 },
  { name: '8# 引风机', code: 'DEMO-IDF-08', category: 'fan', manu: '豪顿', model: 'AVN', endHealth: 79 },
]

function pickSensors(sensorsPer: number): SensorDef[] {
  // 优先包含振动，再从其余随机补足
  const rest = SENSOR_DEFS.filter((s) => !s.isVib)
  const picked: SensorDef[] = [SENSOR_DEFS[0]]
  for (const s of rest) {
    if (picked.length >= sensorsPer) break
    picked.push(s)
  }
  return picked
}

function genValue(def: SensorDef, i: number, N: number, pointsPerDay: number): number {
  const t = N <= 1 ? 0 : i / (N - 1) // 0 → 1 进度
  const daily = Math.sin((i / pointsPerDay) * 2 * Math.PI) * def.amp
  const degr = def.degr * def.amp * t
  const noise = (Math.random() - 0.5) * def.amp * 0.4
  let v = def.base + daily + degr + noise
  v = Math.max(def.min, Math.min(def.max, v))
  return Math.round(v * 100) / 100
}

function healthLevel(score: number): string {
  if (score >= 80) return 'HEALTHY'
  if (score >= 60) return 'WARNING'
  return 'RISK'
}

/** 只删除本租户中以 DEMO 标记的资源，安全幂等（严格按外键依赖逆序删除） */
async function clearDemo(tenantId: string) {
  await prisma.maintenanceOrder.deleteMany({ where: { tenantId, title: { startsWith: 'DEMO-' } } })
  await prisma.alertRule.deleteMany({ where: { tenantId, name: { startsWith: 'DEMO-' } } })
  await prisma.notification.deleteMany({ where: { tenantId, relatedId: 'DEMO' } })
  // 训练日志 → 训练任务（trainingLog 依赖 trainingJob）
  await prisma.trainingLog.deleteMany({ where: { trainingJob: { model: { tenantId, name: { startsWith: 'DEMO-' } } } } })
  // 标注 → 数据集版本/数据集
  await prisma.annotation.deleteMany({ where: { dataset: { tenantId, name: { startsWith: 'DEMO-' } } } })
  // 模型版本 → 模型（modelVersion 依赖 aiModel）
  await prisma.modelVersion.deleteMany({ where: { model: { tenantId, name: { startsWith: 'DEMO-' } } } })
  // 训练任务 → 模型 + 数据集版本（trainingJob 依赖 aiModel 与 dataVersion，须在二者之前删除）
  await prisma.trainingJob.deleteMany({ where: { model: { tenantId, name: { startsWith: 'DEMO-' } } } })
  // 数据集版本 → 数据集
  await prisma.dataVersion.deleteMany({ where: { dataset: { tenantId, name: { startsWith: 'DEMO-' } } } })
  await prisma.dataset.deleteMany({ where: { tenantId, name: { startsWith: 'DEMO-' } } })
  await prisma.aiModel.deleteMany({ where: { tenantId, name: { startsWith: 'DEMO-' } } })
  await prisma.device.deleteMany({ where: { tenantId, code: { startsWith: 'DEMO-' } } })
}

/** 创建 NLP 中文文本分类演示模型（幂等：DEMO 前缀，重复点击不堆积） */
async function createDemoNlpModel(tenantId: string): Promise<string | null> {
  const name = 'DEMO-中文情感分析模型'
  const existing = await prisma.aiModel.findFirst({ where: { tenantId, name } })
  if (existing) return existing.id
  const model = await prisma.aiModel.create({
    data: {
      tenantId,
      name,
      description: '演示用中文情感分析（正/负向）文本分类模型，使用零依赖朴素贝叶斯训练，可在「模型训练」中一键训练。',
      industry: 'general',
      scenario: 'sentiment',
      baseModel: 'text_classification',
      domain: 'NLP',
      status: 'DRAFT',
    },
  })
  return model.id
}

/** 生成 NLP 文本分类（情感分析）示例数据集，返回样本数 */
async function createDemoNlpDataset(tenantId: string, userId: string | null): Promise<number> {
  const annotator = !userId ? await prisma.user.findFirst({ where: { tenantId } }) : null
  const annotatorId = userId || annotator?.id || ''
  const SAMPLES: { text: string; label: string }[] = [
    // 原有 20 条（保留）
    { text: '这台设备运行非常稳定，噪音很小，我们对这次采购很满意。', label: '正面' },
    { text: '客服响应速度太慢，问题三天都没解决，体验很差。', label: '负面' },
    { text: '产品做工精致，包装也很用心，值得推荐给同行。', label: '正面' },
    { text: '到货就发现外壳有裂痕，明显是运输中受损，很失望。', label: '负面' },
    { text: '工程师上门调试很专业，设备故障很快就排除了。', label: '正面' },
    { text: '说明书含糊不清，参数对不上，浪费了我们很多时间。', label: '负面' },
    { text: '性价比很高，同等配置比竞品便宜不少。', label: '正面' },
    { text: '售后推诿扯皮，保修期内还要收费，完全不能接受。', label: '负面' },
    { text: '系统升级后界面更顺手了，日常操作效率提升明显。', label: '正面' },
    { text: '频繁死机重启，严重影响生产，要求退货。', label: '负面' },
    { text: '传感器精度不错，长期运行数据很平稳。', label: '正面' },
    { text: '配件缺货等了两周，产线被迫停产，损失很大。', label: '负面' },
    { text: '培训服务到位，员工很快就能独立操作了。', label: '正面' },
    { text: '软件 bug 太多，导出报表经常报错。', label: '负面' },
    { text: '整体方案切合我们的工艺，落地效果超出预期。', label: '正面' },
    { text: '承诺的交期一拖再拖，项目进度严重滞后。', label: '负面' },
    { text: '远程诊断功能很实用，省去了不少现场出差。', label: '正面' },
    { text: '噪音超标，现场工人投诉不断，必须整改。', label: '负面' },
    { text: '能耗比老设备低了约两成，电费省下不少。', label: '正面' },
    { text: '合同里写的免费维护根本没兑现，纯属虚假宣传。', label: '负面' },
    // 扩展正面样本（+40 条，总数 50）
    { text: '安装非常顺利，技术人员全程指导，开机一次成功。', label: '正面' },
    { text: '这个平台的自动化程度超出预期，人工干预大幅减少。', label: '正面' },
    { text: '数据可视化做得很好，管理层一目了然。', label: '正面' },
    { text: '用了三个月，设备几乎没有停过机，可靠性一流。', label: '正面' },
    { text: '售后服务响应很快，电话过去半小时就有人联系。', label: '正面' },
    { text: '移动端监控很方便，随时随地查看设备状态。', label: '正面' },
    { text: '客户成功经理很负责，每周主动跟进使用情况。', label: '正面' },
    { text: '预警功能很准，提前三天发现了轴承异常。', label: '正面' },
    { text: '这个平台的 API 对接文档写得非常清楚。', label: '正面' },
    { text: '部署后故障率下降了六成，效果非常明显。', label: '正面' },
    { text: '操作界面设计得很直观，新手上手很快。', label: '正面' },
    { text: '历史数据查询功能很强大，想看什么都有。', label: '正面' },
    { text: '系统运行十分流畅，从没出现过卡顿。', label: '正面' },
    { text: '报表导出格式规范，直接可以拿来汇报。', label: '正面' },
    { text: '第三方系统集成很方便，一周就完成了对接。', label: '正面' },
    { text: '平台稳定性很好，连续运行一个月没重启过。', label: '正面' },
    { text: '培训视频做得很用心，每个功能都有操作演示。', label: '正面' },
    { text: '设备利用率提升了一倍，投资回报非常划算。', label: '正面' },
    { text: '自动化报表每天早上准时推送，不用再手工统计了。', label: '正面' },
    { text: '多租户权限控制很灵活，不同角色看到的刚刚好。', label: '正面' },
    { text: '客服团队专业素养很高，技术问题回答得很准确。', label: '正面' },
    { text: '这个方案帮我们节省了大量人力，五年回本没问题。', label: '正面' },
    { text: '设备出现异常时系统自动发短信提醒，很及时。', label: '正面' },
    { text: '数据库查询速度很快，几千万条数据秒级响应。', label: '正面' },
    { text: '配置简单明了，不需要专门的 IT 人员也能搞定。', label: '正面' },
    { text: '软件升级很顺利，没有出现兼容性问题。', label: '正面' },
    { text: '成本控制功能很实用，备件采购费用下降了四成。', label: '正面' },
    { text: '这个平台已经推荐给了好几家同行，都说好用。', label: '正面' },
    { text: '大屏看板效果很好，领导参观时很满意。', label: '正面' },
    { text: '用了半年多，系统依然稳定，维护成本很低。', label: '正面' },
    { text: '技术人员响应及时，远程协助很快就解决了问题。', label: '正面' },
    { text: '方案设计得很合理，完全贴合我们的业务流程。', label: '正面' },
    { text: '平台的容错机制好，网络中断后自动恢复。', label: '正面' },
    { text: '设备台账管理得井井有条，查找非常方便。', label: '正面' },
    { text: '决策支持模块分析得很到位，帮我们做了优化调整。', label: '正面' },
    { text: '传感器数据校准很简单，误差范围很小。', label: '正面' },
    { text: '升级到新版本后系统性能明显提升。', label: '正面' },
    { text: '实时监控大屏很直观，生产进度一目了然。', label: '正面' },
    { text: '这家供应商的售后保障很不错，配件供应及时。', label: '正面' },
    { text: '平台的开放性很好，支持多种协议接入。', label: '正面' },
    // 扩展负面样本（+40 条，总数 50）
    { text: '系统登录页面经常加载失败，要刷新好几次才行。', label: '负面' },
    { text: '数据同步有延迟，设备停了一小时报表才显示。', label: '负面' },
    { text: '产品价格比竞品贵了一半，功能却没多什么。', label: '负面' },
    { text: '安装调试拖了整整两周，项目进度严重受影响。', label: '负面' },
    { text: '售后服务电话永远打不通，工单没人处理。', label: '负面' },
    { text: '界面设计风格陈旧，操作路径很长，效率低下。', label: '负面' },
    { text: '设备经常误报警，造成了很多不必要的停机检查。', label: '负面' },
    { text: 'API 接口文档陈旧，照着写根本跑不通。', label: '负面' },
    { text: '系统半夜自动重启，没有任何通知，数据都没保存。', label: '负面' },
    { text: '安全漏洞太多，三个月内更新了五次补丁。', label: '负面' },
    { text: '培训效果很差，讲师自己都不熟悉系统功能。', label: '负面' },
    { text: '数据迁移过程中丢失了一周的记录，找不回来。', label: '负面' },
    { text: '承诺的定制功能上线半年了还没开发完。', label: '负面' },
    { text: '浏览器兼容性差，只能用特定版本才能正常使用。', label: '负面' },
    { text: '升级到新版后之前配好的规则全部丢失了。', label: '负面' },
    { text: '系统权限设计太死板，想调整一下要层层审批。', label: '负面' },
    { text: '收费模式不透明，结算时发现很多隐藏费用。', label: '负面' },
    { text: '设备连接经常断线，稳定性太差了。', label: '负面' },
    { text: '搜索功能很慢，大数据量下基本不可用。', label: '负面' },
    { text: '导出报表的格式经常乱，每次都要手动调整。', label: '负面' },
    { text: '厂家不提供试用期，买了才知道不好用。', label: '负面' },
    { text: '工单流转流程太复杂，一线操作员根本不会用。', label: '负面' },
    { text: '产品文档翻译质量差，很多专业术语翻错了。', label: '负面' },
    { text: '技术支持的响应时间超过合同约定的四倍。', label: '负面' },
    { text: '业务高峰时系统响应极慢，严重影响工作效率。', label: '负面' },
    { text: '新版本功能越来越少，反而去掉了很多实用的功能。', label: '负面' },
    { text: '硬件质量堪忧，传感器换了三次还是不准。', label: '负面' },
    { text: '客户成功经理换了五个人，每次都要重新沟通。', label: '负面' },
    { text: '退费流程极其复杂，提交了两周还没处理好。', label: '负面' },
    { text: '产品承诺的功能和实际交付的对不上，虚假宣传。', label: '负面' },
    { text: '现场勘查不仔细，设备安装位置选错了。', label: '负面' },
    { text: '验收流程走了三个月，拖延了很多后续工作。', label: '负面' },
    { text: '巡检提醒设置有问题，凌晨三点发通知。', label: '负面' },
    { text: 'App 闪退频繁，iOS 版本完全没法用。', label: '负面' },
    { text: '说是终身维护，结果第二年就开始收费。', label: '负面' },
    { text: '供应商对行业标准不了解，方案不接地气。', label: '负面' },
    { text: '培训资料还是五年前的版本，很多功能都对不上。', label: '负面' },
    { text: '项目实施团队频繁换人，交接文档缺失严重。', label: '负面' },
    { text: '设备铭牌参数和系统显示不一致，误导操作。', label: '负面' },
    { text: '等了两个月才拿到正式合同，效率太低了。', label: '负面' },
  ]

  // 写出真实可训练文件（jsonl，text/label 列），供文本分类训练读取
  const uploadDir = path.resolve(process.cwd(), 'uploads', 'nlp')
  await fs.promises.mkdir(uploadDir, { recursive: true })
  const realPath = path.join(uploadDir, `demo-sentiment-${tenantId}.jsonl`)
  const jsonl = SAMPLES.map((s) => JSON.stringify({ text: s.text, label: s.label })).join('\n')
  await fs.promises.writeFile(realPath, jsonl, 'utf-8')

  const dataset = await prisma.dataset.create({
    data: {
      tenantId,
      name: 'DEMO-情感分析示例',
      description: '演示用中文情感分析数据集（正/负向点评），供 NLP 文本分类训练与推理演示。',
      industry: 'general',
      scenario: 'sentiment',
      format: 'JSONL',
      filePath: realPath,
      fileSize: BigInt(Buffer.byteLength(jsonl, 'utf-8')),
      rowCount: SAMPLES.length,
      status: 'READY',
    },
  })

  const version = await prisma.dataVersion.create({
    data: {
      tenantId,
      datasetId: dataset.id,
      versionNumber: 1,
      filePath: realPath,
      rowCount: SAMPLES.length,
      changeSummary: '初始演示样本',
    },
  })

  await prisma.annotation.createMany({
    data: SAMPLES.map((s, i) => ({
      tenantId,
      datasetId: dataset.id,
      versionId: version.id,
      annotatorId,
      dataIndex: i,
      annotationType: 'TEXT_CLASSIFICATION',
      annotationData: JSON.stringify({ text: s.text, label: s.label }),
      status: 'DONE',
    })),
  })

  return SAMPLES.length
}

router.post('/generate', authMiddleware, requireRole('ADMIN'), asyncHandler(async (req: AuthRequest, res) => {
  const scale: Scale = (req.body && (req.body.scale as Scale)) || 'medium'
  const cfg = SCALES[scale] || SCALES.medium
  const tenantId = req.tenantId!

  await clearDemo(tenantId)

  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000
  const intervalMs = dayMs / cfg.pointsPerDay
  const totalPoints = cfg.historyDays * cfg.pointsPerDay

  const deviceTemplates = DEVICE_TEMPLATES.slice(0, cfg.devices)
  const createdDevices: { id: string; code: string; name: string; endHealth: number }[] = []
  const sensorDataRows: { sensorId: string; tenantId: string; value: number; quality: string; timestamp: Date }[] = []
  const healthRows: { tenantId: string; deviceId: string; score: number; level: string; createdAt: Date }[] = []
  const alertRules: { tenantId: string; deviceId: string; sensorId: string; name: string; ruleType: string; condition: string; severity: string }[] = []
  const maintenanceOrders: { tenantId: string; deviceId: string; type: string; priority: string; title: string; description: string; status: string; healthScore: number; dueDate: Date }[] = []

  for (const dt of deviceTemplates) {
    const device = await prisma.device.create({
      data: {
        tenantId,
        name: dt.name,
        code: dt.code,
        category: dt.category,
        manufacturer: dt.manu,
        modelNumber: dt.model,
        location: '生产车间 A 区',
        status: 'RUNNING',
        installDate: new Date(now - 365 * dayMs),
      },
    })
    createdDevices.push({ id: device.id, code: device.code, name: device.name, endHealth: dt.endHealth })

    const sensors = pickSensors(cfg.sensorsPer)
    let vibSensorId: string | null = null

    for (const sd of sensors) {
      const sensor = await prisma.sensor.create({
        data: {
          tenantId,
          deviceId: device.id,
          name: sd.name,
          channel: sd.channel,
          unit: sd.unit,
          samplingRate: cfg.pointsPerDay,
          minThreshold: sd.min,
          maxThreshold: sd.max,
          status: 'ACTIVE',
        },
      })
      if (sd.isVib) vibSensorId = sensor.id

      // 时序遥测
      for (let i = 0; i < totalPoints; i++) {
        const ts = new Date(now - (totalPoints - 1 - i) * intervalMs)
        sensorDataRows.push({
          sensorId: sensor.id,
          tenantId,
          value: genValue(sd, i, totalPoints, cfg.pointsPerDay),
          quality: 'GOOD',
          timestamp: ts,
        })
      }
    }

    // 每日健康分（末端逼近 endHealth，演示退化）
    for (let d = 0; d < cfg.historyDays; d++) {
      const t = cfg.historyDays <= 1 ? 0 : d / (cfg.historyDays - 1)
      const start = 96
      const score = Math.round((start + (dt.endHealth - start) * t + (Math.random() - 0.5) * 3) * 10) / 10
      healthRows.push({
        tenantId,
        deviceId: device.id,
        score: Math.max(20, Math.min(100, score)),
        level: healthLevel(score),
        createdAt: new Date(now - (cfg.historyDays - 1 - d) * dayMs),
      })
    }
    // 同步设备当前健康分到 lastHealthScore
    await prisma.device.update({
      where: { id: device.id },
      data: { lastHealthScore: dt.endHealth },
    })

    // 告警规则：振动超限
    if (vibSensorId) {
      alertRules.push({
        tenantId,
        deviceId: device.id,
        sensorId: vibSensorId,
        name: 'DEMO-振动超限告警',
        ruleType: 'THRESHOLD',
        condition: JSON.stringify({ operator: '>', threshold: 7.0, window: '5m' }),
        severity: 'WARNING',
      })
    }

    // 维护工单：末端健康分偏低 → 生成待处理工单；设备1 再补一条已完成
    if (dt.endHealth < 75) {
      maintenanceOrders.push({
        tenantId,
        deviceId: device.id,
        type: dt.endHealth < 60 ? 'CORRECTIVE' : 'PREVENTIVE',
        priority: dt.endHealth < 60 ? 'HIGH' : 'MEDIUM',
        title: `DEMO-${dt.name}健康分预警处理`,
        description: `系统检测到 ${dt.name} 近期健康分下滑至 ${dt.endHealth}，建议安排巡检与预测性维护。`,
        status: 'PENDING',
        healthScore: dt.endHealth,
        dueDate: new Date(now + 3 * dayMs),
      })
    }
    if (dt.code === 'DEMO-FAN-01') {
      maintenanceOrders.push({
        tenantId,
        deviceId: device.id,
        type: 'PREVENTIVE',
        priority: 'LOW',
        title: 'DEMO-主风机季度保养',
        description: '已完成叶轮动平衡校验与轴承润滑。',
        status: 'COMPLETED',
        healthScore: 90,
        dueDate: new Date(now - 10 * dayMs),
      })
    }
  }

  // 批量写入遥测（分批避免单次过大）
  for (let i = 0; i < sensorDataRows.length; i += 1000) {
    await prisma.sensorData.createMany({ data: sensorDataRows.slice(i, i + 1000) })
  }
  if (healthRows.length) await prisma.healthScore.createMany({ data: healthRows })
  if (alertRules.length) await prisma.alertRule.createMany({ data: alertRules })
  if (maintenanceOrders.length) await prisma.maintenanceOrder.createMany({ data: maintenanceOrders })

  // NLP 文本分类示例数据集（让 NLP 分支在「数据集」页有可演示内容）
  const nlpSamples = await createDemoNlpDataset(tenantId, req.userId ?? null)
  // 同步创建 NLP 文本分类模型，用户可在「模型训练」中直接训练该演示模型
  const nlpModelId = await createDemoNlpModel(tenantId)

  // 演示通知
  await prisma.notification.create({
    data: {
      tenantId,
      userId: req.userId ?? null,
      type: 'SYSTEM',
      title: '演示数据已生成',
      body: `已为本租户生成 ${createdDevices.length} 台设备、${sensorDataRows.length} 条遥测、${alertRules.length} 条告警规则，以及 ${nlpSamples} 条 NLP 情感分析样本。`,
      level: 'INFO',
      relatedId: 'DEMO',
    },
  })

  // 累加存储用量（粗略按遥测行数计）
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { storageUsed: { increment: BigInt(sensorDataRows.length) } },
  })

  logger.info('演示数据生成完成', { tenantId, scale, devices: createdDevices.length, points: sensorDataRows.length })

  res.json({
    success: true,
    data: {
      devices: createdDevices.length,
      sensors: createdDevices.length * cfg.sensorsPer,
      sensorDataPoints: sensorDataRows.length,
      healthScores: healthRows.length,
      alertRules: alertRules.length,
      maintenanceOrders: maintenanceOrders.length,
      nlpSamples,
      nlpModelId,
      scale,
    },
    message: '演示数据生成成功',
  })
}))

router.post('/clear', authMiddleware, requireRole('ADMIN'), asyncHandler(async (req: AuthRequest, res) => {
  const tenantId = req.tenantId!
  // 统计并回退存储用量（demo 遥测行数），避免为负
  const demoDevices = await prisma.device.findMany({
    where: { tenantId, code: { startsWith: 'DEMO-' } },
    select: { id: true },
  })
  let demoPoints = 0
  if (demoDevices.length) {
    demoPoints = await prisma.sensorData.count({
      where: { sensor: { deviceId: { in: demoDevices.map((d) => d.id) } } },
    })
  }
  await clearDemo(tenantId)
  if (demoPoints > 0) {
    const cur = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { storageUsed: true } })
    const dec = BigInt(Math.min(Number(cur?.storageUsed ?? 0n), demoPoints))
    await prisma.tenant.update({ where: { id: tenantId }, data: { storageUsed: { decrement: dec } } })
  }
  res.json({ success: true, message: '演示数据已清空' })
}))

export default router
