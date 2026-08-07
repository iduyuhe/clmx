import apiClient from './client'
import type { ApiResponse, PaginatedResponse } from '@/types/common'
import type {
  LoginRequest, LoginResponse, RegisterRequest,
  CreateDatasetRequest, CreateModelRequest, CreateTrainingRequest,
  CreateDeploymentRequest, CreateApiKeyRequest, CreateApiKeyResponse, UpdateBrandingRequest,
  CreateChannelRequest, UpdateChannelRequest
} from '@/types/api'
import type {
  User, Dataset, AiModel, ModelVersion, DataVersion,
  TrainingJob, Deployment, AuditLog, Industry,
  Annotation, AnnotationSummary,
  DashboardStats, Tenant, Evaluation, UsageData, ApiUsageRecord, PlanDef,
  Notification, AlertChannel, NotificationInbox
} from '@/types/models'

function unwrap<T>(res: { data: ApiResponse<T> }) { return res.data }

/** 直接从分页响应中提取 PaginatedResponse，避免前端 data?.data?.data 嵌套 */
async function unwrapPage<T>(promise: Promise<{ data: ApiResponse<PaginatedResponse<T>> }>): Promise<PaginatedResponse<T>> {
  const wrapped = await promise
  return wrapped.data.data || { data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }
}

export const authApi = {
  login: (req: LoginRequest) => apiClient.post<ApiResponse<LoginResponse>>('/auth/login', req).then(unwrap),
  register: (req: RegisterRequest) => apiClient.post<ApiResponse<LoginResponse>>('/auth/register', req).then(unwrap),
  me: () => apiClient.get<ApiResponse<User>>('/auth/me').then(unwrap),
  changePassword: (req: { oldPassword: string; newPassword: string }) => apiClient.post<ApiResponse<void>>('/auth/change-password', req).then(unwrap),
}

export const dashboardApi = {
  getStats: () => apiClient.get<ApiResponse<DashboardStats>>('/dashboard').then(unwrap),
}

export const industriesApi = {
  list: () => apiClient.get<ApiResponse<Industry[]>>('/industries').then(unwrap),
  get: (id: string) => apiClient.get<ApiResponse<unknown>>(`/industries/${id}`).then(unwrap),
  create: (req: { name: string; code: string; description?: string; icon?: string }) =>
    apiClient.post<ApiResponse<unknown>>('/industries', req).then(unwrap),
  update: (id: string, req: { name?: string; description?: string; icon?: string }) =>
    apiClient.put<ApiResponse<unknown>>(`/industries/${id}`, req).then(unwrap),
  remove: (id: string) =>
    apiClient.delete<ApiResponse<void>>(`/industries/${id}`).then(unwrap),
  createScenario: (industryId: string, req: { name: string; code: string; description?: string; promptTemplate?: string }) =>
    apiClient.post<ApiResponse<unknown>>(`/industries/${industryId}/scenarios`, req).then(unwrap),
  updateScenario: (industryId: string, scenarioId: string, req: { name?: string; description?: string; promptTemplate?: string }) =>
    apiClient.put<ApiResponse<unknown>>(`/industries/${industryId}/scenarios/${scenarioId}`, req).then(unwrap),
  removeScenario: (industryId: string, scenarioId: string) =>
    apiClient.delete<ApiResponse<void>>(`/industries/${industryId}/scenarios/${scenarioId}`).then(unwrap),
}

export const datasetsApi = {
  list: (params?: Record<string, unknown>) => unwrapPage(apiClient.get<ApiResponse<PaginatedResponse<Dataset>>>('/datasets', { params })),
  get: (id: string) => apiClient.get<ApiResponse<Dataset>>(`/datasets/${id}`).then(unwrap),
  create: (req: CreateDatasetRequest) => apiClient.post<ApiResponse<Dataset>>('/datasets', req).then(unwrap),
  upload: (id: string, file: File, onProgress?: (pct: number) => void) => {
    const form = new FormData()
    form.append('file', file)
    return apiClient.post<ApiResponse<Dataset>>(`/datasets/${id}/upload`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => { if (e.total && onProgress) onProgress(Math.round((e.loaded * 100) / e.total)) },
    }).then(unwrap)
  },
  remove: (id: string) => apiClient.delete<ApiResponse<void>>(`/datasets/${id}`).then(unwrap),
  getVersions: (id: string) => apiClient.get<ApiResponse<DataVersion[]>>(`/datasets/${id}/versions`).then(unwrap),
  getPreview: (id: string) => apiClient.get<ApiResponse<{ rowCount: number; preview: Record<string, unknown>[]; headers?: string[] }>>(`/datasets/${id}/preview`).then(unwrap),
  // 标注管理
  getAnnotationSummary: (id: string, versionId: string) =>
    apiClient.get<ApiResponse<AnnotationSummary>>(`/datasets/${id}/annotations/summary`, { params: { versionId } }).then(unwrap),
  getAnnotations: (id: string, versionId: string, params?: Record<string, unknown>) =>
    unwrapPage(apiClient.get<ApiResponse<PaginatedResponse<Annotation>>>(`/datasets/${id}/annotations`, { params: { ...params, versionId } })),
  createAnnotation: (datasetId: string, req: { versionId: string; dataIndex: number; annotationType: string; annotationData: Record<string, unknown> }) =>
    apiClient.post<ApiResponse<Annotation>>(`/datasets/${datasetId}/annotations`, req).then(unwrap),
  deleteAnnotation: (datasetId: string, annotationId: string) =>
    apiClient.delete<ApiResponse<void>>(`/datasets/${datasetId}/annotations/${annotationId}`).then(unwrap),
}

export const modelsApi = {
  list: (params?: Record<string, unknown>) => unwrapPage(apiClient.get<ApiResponse<PaginatedResponse<AiModel>>>('/models', { params })),
  get: (id: string) => apiClient.get<ApiResponse<AiModel>>(`/models/${id}`).then(unwrap),
  create: (req: CreateModelRequest) => apiClient.post<ApiResponse<AiModel>>('/models', req).then(unwrap),
  remove: (id: string) => apiClient.delete<ApiResponse<void>>(`/models/${id}`).then(unwrap),
  getVersions: (id: string) => apiClient.get<ApiResponse<ModelVersion[]>>(`/models/${id}/versions`).then(unwrap),
}

export const trainingApi = {
  list: (params?: Record<string, unknown>) => unwrapPage(apiClient.get<ApiResponse<PaginatedResponse<TrainingJob>>>('/training', { params })),
  get: (id: string) => apiClient.get<ApiResponse<TrainingJob>>(`/training/${id}`).then(unwrap),
  create: (req: CreateTrainingRequest) => apiClient.post<ApiResponse<TrainingJob>>('/training', req).then(unwrap),
  control: (id: string, action: string) => apiClient.post<ApiResponse<TrainingJob>>(`/training/${id}/${action}`).then(unwrap),
  /** 连接训练进度 SSE 流，返回 EventSource 对象 */
  progressStream: (id: string) => {
    const token = sessionStorage.getItem('token')
    const baseUrl = import.meta.env.VITE_API_URL || '/api'
    const url = `${baseUrl}/training/${id}/progress-stream`
    // SSE 需要通过 query param 传递 token（EventSource 不支持自定义 header）
    const eventSource = new EventSource(`${url}?token=${encodeURIComponent(token || '')}`)
    return eventSource
  },
  // 远端 Worker 回调
  callback: (id: string, payload: { progress: number; epoch: number; loss: number; status: string; log?: string }) =>
    apiClient.post<ApiResponse<void>>(`/training/${id}/callback`, payload).then(unwrap),
}

export const deploymentsApi = {
  list: (params?: Record<string, unknown>) => unwrapPage(apiClient.get<ApiResponse<PaginatedResponse<Deployment>>>('/deployments', { params })),
  get: (id: string) => apiClient.get<ApiResponse<Deployment>>(`/deployments/${id}`).then(unwrap),
  create: (req: CreateDeploymentRequest) => apiClient.post<ApiResponse<Deployment>>('/deployments', req).then(unwrap),
  remove: (id: string) => apiClient.delete<ApiResponse<void>>(`/deployments/${id}`).then(unwrap),
  createApiKey: (deploymentId: string, req: CreateApiKeyRequest) => apiClient.post<ApiResponse<CreateApiKeyResponse>>(`/deployments/${deploymentId}/api-keys`, req).then(unwrap),
  deleteApiKey: (deploymentId: string, keyId: string) => apiClient.delete<ApiResponse<void>>(`/deployments/${deploymentId}/api-keys/${keyId}`).then(unwrap),
  testCall: (deploymentId: string, input: string, task?: string) =>
    apiClient.post<ApiResponse<{ output: string; task: string; model: string; latencyMs: number }>>(`/deployments/${deploymentId}/test`, { input, task }).then(unwrap),
  // 公开推理端点（使用 api-key 鉴权，客户端直接调用）
  infer: (versionId: string, input: string, apiKey: string) =>
    apiClient.post<ApiResponse<{ output: unknown }>>(`/deployments/${versionId}/infer`, { input }, {
      headers: { 'x-api-key': apiKey },
    }).then(unwrap),
}

export const inferenceApi = {
  predict: (req: { task: string; texts: string | string[]; model?: string; parameters?: Record<string, unknown> }) =>
    apiClient.post<ApiResponse<{ task: string; model: string; results: unknown[]; latencyMs: number }>>('/inference/predict', req).then(unwrap),
  batch: (req: { items: { text: string; metadata?: Record<string, unknown> }[]; task: string; model?: string }) =>
    apiClient.post<ApiResponse<{ task: string; model: string; results: unknown[]; latencyMs: number }>>('/inference/batch', req).then(unwrap),
  models: () => apiClient.get<ApiResponse<{ task: string; model: string }[]>>('/inference/models').then(unwrap),
  warmup: () => apiClient.post<ApiResponse<{ task: string; model: string }[]>>('/inference/warmup').then(unwrap),
  unload: (task: string, modelName?: string) =>
    apiClient.post<ApiResponse<void>>('/inference/unload', { task, modelName }).then(unwrap),
  // NLP 中文文本分类（用训练产出的纯 JSON 模型做推理，零依赖、不联网）
  textClassification: (req: { modelVersionId: string; texts: string | string[]; threshold?: number }) =>
    apiClient.post<ApiResponse<{
      modelVersionId: string
      labels: string[]
      results: { text: string; label: string; labels: string[]; scores: Record<string, number>; probabilities: Record<string, number> }[]
      latencyMs: number
    }>>('/inference/text-classification', req).then(unwrap),
  // 列出当前租户已训练完成、可用于中文文本分类推理的模型版本
  textClassificationModels: () =>
    apiClient.get<ApiResponse<{ modelVersionId: string; modelName: string; versionNumber: number; status: string }[]>>('/inference/text-classification/models').then(unwrap),
  // NLP 关键词提取（纯 JS TF-IDF，零依赖）
  keywords: (req: { texts: string | string[]; topN?: number }) =>
    apiClient.post<ApiResponse<{ results: { text: string; keywords: { word: string; score: number }[] }[]; latencyMs: number }>>('/inference/keywords', req).then(unwrap),
  // NLP 文本相似度（纯 JS 余弦相似度，零依赖）
  textSimilarity: (req: { text1: string; text2: string }) =>
    apiClient.post<ApiResponse<{ similarity: number; latencyMs: number }>>('/inference/text-similarity', req).then(unwrap),
  // NLP 文本聚类（纯 JS TF-IDF + K-means，零依赖）
  textClustering: (req: { texts: string | string[]; nClusters?: number }) =>
    apiClient.post<ApiResponse<{ nClusters: number; assignments: number[]; keywords: Array<{ cluster: number; words: { word: string; score: number }[] }>; latencyMs: number }>>('/inference/text-clustering', req).then(unwrap),
}

export const evaluationsApi = {
  list: (params?: Record<string, unknown>) => unwrapPage(apiClient.get<ApiResponse<PaginatedResponse<Evaluation>>>('/evaluations', { params })),
  get: (id: string) => apiClient.get<ApiResponse<Evaluation>>(`/evaluations/${id}`).then(unwrap),
  create: (req: { modelVersionId: string; datasetVersionId: string; evalType?: 'AUTO' | 'MANUAL' }) =>
    apiClient.post<ApiResponse<Evaluation>>('/evaluations', req).then(unwrap),
}

export const settingsApi = {
  getTenant: () => apiClient.get<ApiResponse<Tenant>>('/settings/tenant').then(unwrap),
  updateBranding: (req: UpdateBrandingRequest) => apiClient.put<ApiResponse<Tenant>>('/settings/branding', req).then(unwrap),
  getMembers: () => apiClient.get<ApiResponse<User[]>>('/settings/members').then(unwrap),
  getUsage: () => apiClient.get<ApiResponse<UsageData>>('/settings/usage').then(unwrap),
  getUsageRecords: (params?: Record<string, unknown>) => unwrapPage(apiClient.get<ApiResponse<PaginatedResponse<ApiUsageRecord>>>('/settings/usage-records', { params })),
  getAuditLogs: (params?: Record<string, unknown>) => unwrapPage(apiClient.get<ApiResponse<PaginatedResponse<AuditLog>>>('/settings/audit-logs', { params })),
  getAuditActions: () => apiClient.get<ApiResponse<{ value: string; label: string }[]>>('/settings/audit-actions').then(unwrap),
  getPlans: () => apiClient.get<ApiResponse<PlanDef[]>>('/settings/plans').then(unwrap),
  changePlan: (req: { planType: string; apiCallQuota?: number }) =>
    apiClient.post<ApiResponse<Tenant>>('/settings/change-plan', req).then(unwrap),
  exportUsage: (params?: { format?: string }) =>
    apiClient.get('/settings/usage-export', { params, responseType: 'blob' }).then((r) => r.data as Blob),
  getChannels: () => apiClient.get<ApiResponse<AlertChannel[]>>('/settings/alert-channels').then(unwrap),
  createChannel: (req: CreateChannelRequest) =>
    apiClient.post<ApiResponse<AlertChannel>>('/settings/alert-channels', req).then(unwrap),
  updateChannel: (id: string, req: UpdateChannelRequest) =>
    apiClient.put<ApiResponse<AlertChannel>>(`/settings/alert-channels/${id}`, req).then(unwrap),
  deleteChannel: (id: string) => apiClient.delete<ApiResponse<void>>(`/settings/alert-channels/${id}`).then(unwrap),
}

export const notificationApi = {
  getInbox: (params?: { page?: number; pageSize?: number }) =>
    apiClient.get<ApiResponse<NotificationInbox>>('/notifications', { params }).then(unwrap),
  markRead: (id: string) => apiClient.post<ApiResponse<Notification>>(`/notifications/${id}/read`).then(unwrap),
  markAllRead: () => apiClient.post<ApiResponse<void>>('/notifications/read-all').then(unwrap),
  sendTest: () => apiClient.post<ApiResponse<void>>('/notifications/test').then(unwrap),
}

export const usersApi = {
  list: (params?: Record<string, unknown>) => unwrapPage(apiClient.get<ApiResponse<PaginatedResponse<User>>>('/users', { params })),
  create: (req: { email: string; name: string; password: string; role?: string }) =>
    apiClient.post<ApiResponse<User>>('/users', req).then(unwrap),
  update: (id: string, req: { name?: string; role?: string; status?: string }) =>
    apiClient.put<ApiResponse<User>>(`/users/${id}`, req).then(unwrap),
  resetPassword: (id: string, newPassword: string) =>
    apiClient.post<ApiResponse<void>>(`/users/${id}/reset-password`, { newPassword }).then(unwrap),
  remove: (id: string) =>
    apiClient.delete<ApiResponse<void>>(`/users/${id}`).then(unwrap),
}

// ─── 工业设备管理 ────────────────────────────────────

export const devicesApi = {
  list: (params?: Record<string, unknown>) => unwrapPage(apiClient.get<ApiResponse<PaginatedResponse<unknown>>>('/devices', { params })),
  get: (id: string) => apiClient.get<ApiResponse<unknown>>(`/devices/${id}`).then(unwrap),
  create: (req: Record<string, unknown>) => apiClient.post<ApiResponse<unknown>>('/devices', req).then(unwrap),
  update: (id: string, req: Record<string, unknown>) => apiClient.put<ApiResponse<unknown>>(`/devices/${id}`, req).then(unwrap),
  remove: (id: string) => apiClient.delete<ApiResponse<void>>(`/devices/${id}`).then(unwrap),
  getSensors: (id: string) => apiClient.get<ApiResponse<unknown[]>>(`/devices/${id}/sensors`).then(unwrap),
  addSensor: (id: string, req: Record<string, unknown>) => apiClient.post<ApiResponse<unknown>>(`/devices/${id}/sensors`, req).then(unwrap),
  updateSensor: (id: string, sensorId: string, req: Record<string, unknown>) => apiClient.put<ApiResponse<unknown>>(`/devices/${id}/sensors/${sensorId}`, req).then(unwrap),
  removeSensor: (id: string, sensorId: string) => apiClient.delete<ApiResponse<void>>(`/devices/${id}/sensors/${sensorId}`).then(unwrap),
  stats: () => apiClient.get<ApiResponse<Record<string, number>>>('/devices/stats/summary').then(unwrap),
  listSensors: () => apiClient.get<ApiResponse<unknown[]>>('/devices/sensors').then(unwrap),
}

export const opcuaApi = {
  status: () => apiClient.get<ApiResponse<{ connected: boolean; endpoint: string | null; nodes: number }>>('/opcua/status').then(unwrap),
  connect: (req: { endpoint: string; intervalMs?: number; mappings: { nodeId: string; sensorId: string }[] }) =>
    apiClient.post<ApiResponse<{ connected: boolean; endpoint: string; nodes: number }>>('/opcua/connect', req).then(unwrap),
  disconnect: () => apiClient.post<ApiResponse<void>>('/opcua/disconnect').then(unwrap),
}

export const sensorDataApi = {
  ingest: (req: { sensorId: string; value: number; timestamp?: string; quality?: string }) =>
    apiClient.post<ApiResponse<unknown>>('/sensor-data/ingest', req).then(unwrap),
  ingestBatch: (req: { sensorId: string; data: { value: number; timestamp?: string; quality?: string }[] }) =>
    apiClient.post<ApiResponse<{ inserted: number }>>('/sensor-data/ingest/batch', req).then(unwrap),
  query: (params: { sensorId: string; start?: string; end?: string; limit?: number }) =>
    apiClient.get<ApiResponse<{ sensor: unknown; dataPoints: unknown[] }>>('/sensor-data/query', { params }).then(unwrap),
  latest: (sensorId: string) =>
    apiClient.get<ApiResponse<{ sensor: unknown; latest: unknown }>>(`/sensor-data/latest/${sensorId}`).then(unwrap),
}

export const maintenanceApi = {
  list: (params?: Record<string, unknown>) => unwrapPage(apiClient.get<ApiResponse<PaginatedResponse<unknown>>>('/maintenance', { params })),
  get: (id: string) => apiClient.get<ApiResponse<unknown>>(`/maintenance/${id}`).then(unwrap),
  create: (req: Record<string, unknown>) => apiClient.post<ApiResponse<unknown>>('/maintenance', req).then(unwrap),
  update: (id: string, req: Record<string, unknown>) => apiClient.put<ApiResponse<unknown>>(`/maintenance/${id}`, req).then(unwrap),
  remove: (id: string) => apiClient.delete<ApiResponse<void>>(`/maintenance/${id}`).then(unwrap),
  // 备件管理
  listSpareParts: (params?: Record<string, unknown>) => unwrapPage(apiClient.get<ApiResponse<PaginatedResponse<unknown>>>('/maintenance/spare-parts/list', { params })),
  createSparePart: (req: Record<string, unknown>) => apiClient.post<ApiResponse<unknown>>('/maintenance/spare-parts', req).then(unwrap),
  updateSparePart: (id: string, req: Record<string, unknown>) => apiClient.put<ApiResponse<unknown>>(`/maintenance/spare-parts/${id}`, req).then(unwrap),
  removeSparePart: (id: string) => apiClient.delete<ApiResponse<void>>(`/maintenance/spare-parts/${id}`).then(unwrap),
}

export const healthApi = {
  history: (deviceId: string, limit?: number) =>
    apiClient.get<ApiResponse<unknown[]>>(`/health/device/${deviceId}/history`, { params: { limit } }).then(unwrap),
  calculate: (deviceId: string) =>
    apiClient.post<ApiResponse<unknown>>(`/health/device/${deviceId}/calculate`).then(unwrap),
  dashboard: () => apiClient.get<ApiResponse<unknown>>('/health/dashboard').then(unwrap),
  recomputeBaseline: (sensorId: string) =>
    apiClient.post<ApiResponse<unknown>>(`/health/sensors/${sensorId}/baseline/recompute`).then(unwrap),
  getBaseline: (sensorId: string) =>
    apiClient.get<ApiResponse<unknown>>(`/health/sensors/${sensorId}/baseline`).then(unwrap),
  // 告警规则
  listRules: (params?: Record<string, unknown>) => apiClient.get<ApiResponse<unknown[]>>('/health/rules', { params }).then(unwrap),
  createRule: (req: Record<string, unknown>) => apiClient.post<ApiResponse<unknown>>('/health/rules', req).then(unwrap),
  updateRule: (id: string, req: Record<string, unknown>) => apiClient.put<ApiResponse<unknown>>(`/health/rules/${id}`, req).then(unwrap),
  removeRule: (id: string) => apiClient.delete<ApiResponse<void>>(`/health/rules/${id}`).then(unwrap),
}

// ─── 演示数据生成器 ────────────────────────────────────
export const demoApi = {
  generate: (scale: 'small' | 'medium' | 'large' = 'medium') =>
    apiClient
      .post<
        ApiResponse<{
          devices: number
          sensors: number
          sensorDataPoints: number
          healthScores: number
          alertRules: number
          maintenanceOrders: number
          scale: string
        }>
      >('/demo-data/generate', { scale })
      .then(unwrap),
  clear: () => apiClient.post<ApiResponse<{ message: string }>>('/demo-data/clear').then(unwrap),
}

// ─── SaaS 计费（账单生命周期） ────────────────────────
interface BillingInvoice {
  id: string
  number: string
  period: string
  amount: number
  currency: string
  status: string
  dueDate: string | null
  paidAt: string | null
  items: string
  createdAt: string
}

export const billingApi = {
  list: (params?: Record<string, unknown>) =>
    unwrapPage(apiClient.get<ApiResponse<PaginatedResponse<BillingInvoice>>>('/billing/invoices', { params })),
  pay: (id: string) =>
    apiClient.post<ApiResponse<{ id: string; status: string }>>(`/billing/invoices/${id}/pay`).then(unwrap),
  generateMonthly: () =>
    apiClient.post<ApiResponse<{ id: string; number: string; amount: number }>>('/billing/generate-monthly').then(unwrap),
}

// ─── 自然语言指令（P1-1） ────────────────────────────
export const nlCommandApi = {
  send: (message: string) =>
    apiClient.post<ApiResponse<{ reply: string; action?: string; data?: unknown }>>('/nl-command', { message }).then(unwrap),
}

// ─── AI 原生接入生成器 + 能力资产化（HubPort 思想融合 阶段5/7） ──
export interface IngestPointDTO {
  key: string
  name: string
  unit: string
  type: string
}
export interface IngestSpecDTO {
  id: string
  tenantId: string | null
  name: string
  description: string
  sourceType: string
  sourceUrl: string | null
  rawSpec: string
  status: string
  createdAt: string
  assets?: IngestAssetDTO[]
}
export interface IngestAssetDTO {
  id: string
  tenantId: string | null
  specId: string
  version: number
  thingModel: string // JSON 字符串
  driverCode: string
  sampleData: string | null
  selfTestResult: string | null
  status: string
  published: boolean
  reuseCount: number
  createdAt: string
  spec?: { name: string; sourceType: string; description: string }
}
export interface SelfTestDTO {
  passed: boolean
  expectedCount: number
  gotCount: number
  readings: { key: string; name?: string; unit?: string; value: number }[]
  missing: string[]
  errors: string[]
}

export const ingestApi = {
  // 接入需求
  listSpecs: () => apiClient.get<ApiResponse<IngestSpecDTO[]>>('/ingest/specs').then(unwrap),
  getSpec: (id: string) => apiClient.get<ApiResponse<IngestSpecDTO>>(`/ingest/specs/${id}`).then(unwrap),
  createSpec: (req: { name: string; description?: string; sourceType?: string; sourceUrl?: string; rawSpec?: string }) =>
    apiClient.post<ApiResponse<IngestSpecDTO>>('/ingest/specs', req).then(unwrap),
  // 生成（同步）
  generate: (id: string) =>
    apiClient.post<ApiResponse<{ asset: IngestAssetDTO; from: string; points: IngestPointDTO[]; notes: string[]; selfTest: SelfTestDTO }>>(`/ingest/specs/${id}/generate`).then(unwrap),
  // 自测
  selfTest: (assetId: string) => apiClient.post<ApiResponse<SelfTestDTO>>(`/ingest/assets/${assetId}/selftest`).then(unwrap),
  // 运行时执行驱动（可选写 SensorData）
  run: (assetId: string, req: { deviceId?: string; payload?: Record<string, unknown> }) =>
    apiClient.post<ApiResponse<{ readings: { key: string; value: number }[]; written: number; deviceId: string | null }>>(`/ingest/assets/${assetId}/run`, req).then(unwrap),
  // 资产治理
  publish: (assetId: string) => apiClient.post<ApiResponse<IngestAssetDTO>>(`/ingest/assets/${assetId}/publish`).then(unwrap),
  deprecate: (assetId: string) => apiClient.post<ApiResponse<IngestAssetDTO>>(`/ingest/assets/${assetId}/deprecate`).then(unwrap),
  listAssets: (marketplace = false) => apiClient.get<ApiResponse<IngestAssetDTO[]>>(`/ingest/assets${marketplace ? '?marketplace=1' : ''}`).then(unwrap),
  apply: (assetId: string, deviceId: string) => apiClient.post<ApiResponse<{ deviceId: string; sensors: string[]; count: number }>>(`/ingest/assets/${assetId}/apply`, { deviceId }).then(unwrap),
}
