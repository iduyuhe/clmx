import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const PRESET_INDUSTRIES = [
  {
    name: '智能制造',
    code: 'manufacturing',
    description: '工业质检、预测性维护、工艺优化',
    icon: 'factory',
    scenarios: [
      { name: '产品质检', code: 'qa', description: '缺陷检测与质量控制', promptTemplate: '请分析以下产品图片/数据，判断是否存在缺陷并给出置信度评分。' },
      { name: '工艺优化', code: 'doc', description: '生产参数优化建议', promptTemplate: '基于历史生产数据，提供最优工艺参数配置。' },
      { name: '设备预防性维修', code: 'maintenance', description: '基于传感器数据的设备健康监测与故障预警', promptTemplate: '请分析以下设备传感器数据（振动/温度/压力/电流），评估设备健康状况，判断是否存在异常趋势并给出维修建议。' },
    ],
  },
  {
    name: '医疗健康',
    code: 'healthcare',
    description: '辅助诊断、医学影像、药物研发',
    icon: 'stethoscope',
    scenarios: [
      { name: '辅助诊断', code: 'qa', description: '症状分析与诊断建议', promptTemplate: '请基于患者症状描述，提供可能的诊断方向和建议检查项目。' },
      { name: '医学影像', code: 'doc', description: '影像报告自动生成', promptTemplate: '请分析医学影像，生成结构化诊断报告。' },
    ],
  },
  {
    name: '金融科技',
    code: 'fintech',
    description: '风控评估、智能投顾、反欺诈',
    icon: 'banknote',
    scenarios: [
      { name: '风控评估', code: 'qa', description: '信用风险与合规分析', promptTemplate: '请分析客户资料，评估信用风险等级。' },
      { name: '智能报告', code: 'report', description: '财务报告与趋势分析', promptTemplate: '请基于财务数据生成分析报告。' },
    ],
  },
  {
    name: '电商零售',
    code: 'ecommerce',
    description: '智能推荐、客户画像、供应链优化',
    icon: 'shopping-bag',
    scenarios: [
      { name: '智能客服', code: 'qa', description: '商品咨询与售后问答', promptTemplate: '请回答客户关于商品的问题。' },
      { name: '商品知识库', code: 'kb', description: '商品信息管理与检索', promptTemplate: '请检索并提供相关商品信息。' },
    ],
  },
  {
    name: '金融',
    code: 'finance',
    description: '信贷审批、投资分析、合规审查',
    icon: 'landmark',
    scenarios: [
      { name: '信贷审批', code: 'qa', description: '贷款申请智能审批', promptTemplate: '请分析申请人资信信息，给出信贷审批建议及风险提示。' },
      { name: '投资分析', code: 'report', description: '投资组合与市场分析', promptTemplate: '请基于市场数据与投资组合，生成投资分析报告。' },
      { name: '合规审查', code: 'kb', description: '法规合规知识检索', promptTemplate: '请根据相关法规条款，审查业务行为的合规性。' },
    ],
  },
  {
    name: '软件',
    code: 'software',
    description: '代码审查、技术文档、需求分析',
    icon: 'code',
    scenarios: [
      { name: '代码审查', code: 'qa', description: '代码质量与安全审查', promptTemplate: '请审查以下代码，指出潜在问题、安全风险及改进建议。' },
      { name: '技术文档', code: 'doc', description: 'API文档与技术方案生成', promptTemplate: '请根据代码或需求描述，生成结构化的技术文档。' },
      { name: '需求分析', code: 'report', description: '需求拆解与评估', promptTemplate: '请分析产品需求，拆解功能模块并评估工作量。' },
    ],
  },
  {
    name: '通用服务',
    code: 'general',
    description: '文档处理、知识管理、数据分析',
    icon: 'globe',
    scenarios: [
      { name: '文档问答', code: 'qa', description: '基于文档的智能问答', promptTemplate: '请根据提供的文档内容回答用户问题。' },
      { name: '知识管理', code: 'kb', description: '企业知识库构建', promptTemplate: '请整理并结构化处理企业知识。' },
      { name: '数据分析', code: 'report', description: '业务报表生成', promptTemplate: '请分析业务数据并生成报表。' },
    ],
  },
]

async function main() {
  let createdCount = 0
  let skippedCount = 0

  for (const ind of PRESET_INDUSTRIES) {
    // 按代码检查是否已存在，避免重复创建
    const existing = await prisma.industry.findFirst({
      where: { code: ind.code },
    })
    if (existing) {
      console.log(`跳过已存在行业: ${ind.name} (${ind.code})`)
      skippedCount++
      continue
    }

    const created = await prisma.industry.create({
      data: {
        name: ind.name,
        code: ind.code,
        description: ind.description,
        icon: ind.icon,
        isPreset: true,
        tenantId: null, // 预置数据不绑定租户
        scenarios: {
          create: ind.scenarios.map((sc) => ({
            name: sc.name,
            code: sc.code,
            description: sc.description,
            promptTemplate: sc.promptTemplate,
            isPreset: true,
            tenantId: null,
          })),
        },
      },
      include: { scenarios: true },
    })
    console.log(`创建行业: ${created.name} (${created.scenarios.length} 个场景)`)
    createdCount++
  }
  console.log(`预置行业数据完成 — 新增 ${createdCount} 个，跳过 ${skippedCount} 个`)
}

main()
  .catch((err) => { console.error(err); process.exit(1) })
  .finally(() => prisma.$disconnect())
