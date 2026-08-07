/**
 * CLMX MCP 北向 - 工具定义
 *
 * 每个工具都是对 CLMX 主服务既有 REST API 的「纯封装」：
 * - 不引入新业务逻辑，只做协议翻译 + 参数整理。
 * - description 中的 [只读] / [需MANAGER权限] 是对 MCP 客户端的权限提示；
 *   真实权限边界仍由主服务 authMiddleware（JWT 角色）强制。
 */
import { ClmxClientConfig, ClmxCallResult, clmxCall } from './client'

export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, any>
  needManager?: boolean
  handler: (args: Record<string, any>, cfg: ClmxClientConfig) => Promise<ClmxCallResult>
}

/** 把可选参数拼成 query string */
function qs(params: Record<string, any>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export const MCP_TOOLS: McpTool[] = [
  // 1) 自然语言总入口（最通用：查数据 / 触发动作）
  {
    name: 'clmx_nl_command',
    description:
      '用自然语言操作 CLMX 平台（例如「查 3 号机床健康分」「最近有哪些异常」「训练电机振动模型」）。' +
      '这是最通用的入口，会自动路由到对应的查询或触发动作。[只读/触发，取决于指令内容]',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: '自然语言指令，例如「列出所有设备」' },
      },
      required: ['message'],
    },
    handler: (args, cfg) => clmxCall(cfg, 'POST', '/api/nl-command', { message: args.message }),
  },

  // 2) 设备列表
  {
    name: 'clmx_list_devices',
    description: '列出当前租户的设备（分页）。可按关键字/状态/类别筛选。[只读]',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'number', description: '页码，默认 1' },
        pageSize: { type: 'number', description: '每页条数，默认 20' },
        keyword: { type: 'string', description: '按设备名称模糊搜索' },
        status: { type: 'string', description: 'RUNNING | STOPPED | MAINTENANCE | FAULT' },
        category: { type: 'string', description: '设备类别' },
      },
    },
    handler: (args, cfg) =>
      clmxCall(cfg, 'GET', `/api/devices${qs({ page: args.page, pageSize: args.pageSize, keyword: args.keyword, status: args.status, category: args.category })}`),
  },

  // 3) 设备详情
  {
    name: 'clmx_device_detail',
    description: '查看单个设备的详情（含传感器、健康分历史、维修工单）。[只读]',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: '设备 ID' },
      },
      required: ['deviceId'],
    },
    handler: (args, cfg) => clmxCall(cfg, 'GET', `/api/devices/${args.deviceId}`),
  },

  // 4) 健康概览看板
  {
    name: 'clmx_health_dashboard',
    description: '获取设备健康概览：所有设备最新健康分、近期预警工单、健康分低于 60 的临界设备数。[只读]',
    inputSchema: { type: 'object', properties: {} },
    handler: (args, cfg) => clmxCall(cfg, 'GET', '/api/health/dashboard'),
  },

  // 5) 计算设备健康分（写，可能自动建工单）
  {
    name: 'clmx_calculate_health',
    description:
      '手动计算并记录某设备的健康评分（规则 + 可选工业模型混合）。若评分 < 60 会自动创建维修工单并推送告警。[需MANAGER权限]',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: '设备 ID' },
        modelVersionId: { type: 'string', description: '可选：用于模型评分的模型版本 ID' },
      },
      required: ['deviceId'],
    },
    needManager: true,
    handler: (args, cfg) =>
      clmxCall(cfg, 'POST', `/api/health/device/${args.deviceId}/calculate`, {
        modelVersionId: args.modelVersionId,
      }),
  },

  // 6) 训练任务列表
  {
    name: 'clmx_list_training',
    description: '列出训练任务（分页），可按状态/关键字筛选。[只读]',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'number', description: '页码，默认 1' },
        pageSize: { type: 'number', description: '每页条数，默认 20' },
        status: { type: 'string', description: 'QUEUED | RUNNING | COMPLETED | FAILED | CANCELLED' },
        search: { type: 'string', description: '按模型名称/类型搜索' },
      },
    },
    handler: (args, cfg) =>
      clmxCall(cfg, 'GET', `/api/training${qs({ page: args.page, pageSize: args.pageSize, status: args.status, search: args.search })}`),
  },

  // 7) 触发训练
  {
    name: 'clmx_trigger_training',
    description: '创建并启动一个训练任务。[需MANAGER权限]',
    inputSchema: {
      type: 'object',
      properties: {
        modelId: { type: 'string', description: '要训练的模型 ID（必须属于当前租户）' },
        datasetVersionId: { type: 'string', description: '数据集版本 ID（工业时序训练可省略）' },
        hyperparams: {
          type: 'object',
          description: '超参，例如 {"epochs": 20, "dataType": "timeseries", "modelType": "timeseries"}',
        },
      },
      required: ['modelId'],
    },
    needManager: true,
    handler: (args, cfg) =>
      clmxCall(cfg, 'POST', '/api/training', {
        modelId: args.modelId,
        datasetVersionId: args.datasetVersionId,
        hyperparams: args.hyperparams,
      }),
  },

  // 8) 模型推理
  {
    name: 'clmx_run_inference',
    description: '执行 NLP/通用推理任务（task 类型取决于已训练模型）。[需MANAGER权限]',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '推理任务类型，例如 text_classification / sentiment 等' },
        texts: {
          type: 'array',
          items: { type: 'string' },
          description: '待推理文本数组（单次最多 50 条）',
        },
        model: { type: 'string', description: '可选：指定模型标识' },
        parameters: { type: 'object', description: '可选额外参数' },
      },
      required: ['task', 'texts'],
    },
    needManager: true,
    handler: (args, cfg) =>
      clmxCall(cfg, 'POST', '/api/inference/predict', {
        task: args.task,
        texts: args.texts,
        model: args.model,
        parameters: args.parameters,
      }),
  },

  // 9) 关键词提取（纯 JS，零依赖）
  {
    name: 'clmx_keywords',
    description: '从一段或多段中文文本中提取 TF-IDF 关键词（纯 JS，零依赖）。[只读]',
    inputSchema: {
      type: 'object',
      properties: {
        texts: { type: ['string', 'array'], description: '文本或文本数组' },
        topN: { type: 'number', description: '返回关键词数量，默认 10' },
      },
      required: ['texts'],
    },
    handler: (args, cfg) =>
      clmxCall(cfg, 'POST', '/api/inference/keywords', { texts: args.texts, topN: args.topN }),
  },

  // 10) 告警规则列表
  {
    name: 'clmx_list_alert_rules',
    description: '列出当前租户已配置的告警规则（阈值/条件）。[只读]',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: '可选：按设备过滤' },
      },
    },
    handler: (args, cfg) =>
      clmxCall(cfg, 'GET', `/api/health/rules${qs({ deviceId: args.deviceId })}`),
  },
]
