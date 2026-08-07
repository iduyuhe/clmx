import type {
  TrainingStatus, ModelStatus, DatasetStatus,
  DeploymentStatus, UserRole, PlanType, BaseModelType
} from './common'

export interface Tenant {
  id: string
  name: string
  slug: string
  industry: string
  planType: PlanType
  branding: TenantBranding | null
  status: string
  createdAt: string
  // 套餐/配额使用情况（来自 /settings/tenant）
  storageUsed?: number
  storageLimit?: number
  apiCallQuota?: number
  apiCallsUsed?: number
  // 配额熔断状态（来自 /settings/tenant 的 getQuotaState）
  storagePct?: number
  apiPct?: number
  storageSoft?: boolean
  apiSoft?: boolean
  storageBreached?: boolean
  apiBreached?: boolean
}

export interface TenantBranding {
  companyName: string
  logoUrl: string
  primaryColor: string
  faviconUrl: string
  customDomain: string
}

/** 套餐目录项（来自 GET /settings/plans） */
export interface PlanDef {
  id: string
  label: string
  storageLimit: number
  apiCallQuota: number
  priceMonthly: number
  features: string[]
}

export interface User {
  id: string
  tenantId: string
  email: string
  name: string
  role: UserRole
  status: string
  tenant?: Tenant
  lastLoginAt: string
  createdAt: string
}

export interface Industry {
  id: string
  name: string
  code: string
  description: string
  icon: string
  isPreset: boolean
  defaultConfig: Record<string, unknown>
  scenarios?: Scenario[]
}

export interface Scenario {
  id: string
  name: string
  code: string
  description: string
  industryId: string
  promptTemplate: string
  recommendedParams: Record<string, unknown>
  isPreset: boolean
}

export interface Dataset {
  id: string
  tenantId: string
  name: string
  description: string
  industry: string
  scenario: string
  format: string
  filePath: string
  fileSize: number
  rowCount: number
  status: DatasetStatus
  versions?: DataVersion[]
  createdAt: string
  updatedAt: string
}

export interface DataVersion {
  id: string
  datasetId: string
  versionNumber: number
  rowCount: number
  changeSummary: string
  createdAt: string
}

export interface Annotation {
  id: string
  datasetId: string
  versionId: string
  annotatorId: string
  dataIndex: number
  annotationType: string
  annotationData: Record<string, unknown>
  status: 'PENDING' | 'COMPLETED' | 'REJECTED'
  annotator?: { id: string; name: string }
  createdAt: string
  updatedAt: string
}

export interface AnnotationSummary {
  totalRows: number
  completed: number
  pending: number
  rejected: number
}

export interface AiModel {
  id: string
  tenantId: string
  name: string
  description: string
  industry: string
  scenario: string
  baseModel: BaseModelType
  status: ModelStatus
  versions?: ModelVersion[]
  createdAt: string
  updatedAt: string
}

export interface ModelVersion {
  id: string
  modelId: string
  versionNumber: number
  checkpointPath: string
  metrics: Record<string, number>
  evaluationSummary: Record<string, unknown>
  trainingJobId?: string
  status: string
  deployment?: Deployment
  createdAt: string
}

export interface TrainingJob {
  id: string
  modelId: string
  modelVersionId?: string
  datasetVersionId: string
  evalDatasetVersionId?: string
  hyperparams: TrainingHyperparams
  status: TrainingStatus
  progress: number
  currentEpoch: number
  totalEpochs: number
  gpuType: string
  gpuCount: number
  lossHistory?: LossPoint[]
  logs?: TrainingLog[]
  startedAt?: string
  completedAt?: string
  createdAt: string
  model?: AiModel
  datasetVersion?: DataVersion
}

export interface TrainingHyperparams {
  learningRate: number
  epochs: number
  batchSize: number
  loraRank: number
  warmupSteps: number
  maxSeqLength: number
}

export interface LossPoint {
  step: number
  loss: number
  epoch: number
  timestamp: string
}

export interface TrainingLog {
  id: string
  level: 'INFO' | 'WARN' | 'ERROR'
  message: string
  timestamp: string
}

export interface Evaluation {
  id: string
  modelVersionId: string
  datasetVersionId: string
  evalType: 'AUTO' | 'MANUAL'
  autoMetrics: Record<string, number>
  status: string
  createdAt: string
}

export interface Deployment {
  id: string
  modelVersionId: string
  name: string
  endpointUrl: string
  status: DeploymentStatus
  instanceCount: number
  gpuType: string
  apiKeys?: ApiKey[]
  usages?: ApiUsage[]
  createdAt: string
  modelVersion?: ModelVersion
}

export interface ApiKey {
  id: string
  tenantId: string
  deploymentId: string
  name: string
  keyPreview: string
  rateLimit: number
  isActive: boolean
  expiresAt?: string
  createdAt: string
}

export interface ApiUsage {
  id: string
  deploymentId: string
  requestTokens: number
  responseTokens: number
  latencyMs: number
  statusCode: number
  timestamp: string
}

/** 计费看板用量明细记录 */
export interface ApiUsageRecord {
  id: string
  deploymentId: string
  requestTokens: number
  responseTokens: number
  latencyMs: number
  statusCode: number
  timestamp: string
}

export interface AuditLog {
  id: string
  tenantId: string
  userId: string
  user?: { id: string; name: string; email: string }
  action: string
  actionLabel?: string
  resource?: string
  resourceId?: string
  detail?: Record<string, unknown>
  ipAddress: string
  createdAt: string
}

export interface DashboardStats {
  modelCount: number
  trainingCount: number
  deployedCount: number
  todayApiCalls: number
  recentTrainingJobs: TrainingJob[]
  apiCallTrend: { date: string; calls: number }[]
}

export interface UsageData {
  totalCalls: number
  totalTokens: number
  dailyStats: { date: string; calls: number; tokens: number }[]
}

export interface Notification {
  id: string
  tenantId: string
  userId: string | null
  type: string // ALERT / MAINTENANCE / SYSTEM
  title: string
  body: string
  level: 'INFO' | 'WARNING' | 'CRITICAL'
  read: boolean
  relatedId: string | null
  link: string | null
  createdAt: string
}

export interface NotificationInbox {
  data: Notification[]
  total: number
  page: number
  pageSize: number
  unreadCount: number
}

export interface AlertChannel {
  id: string
  tenantId: string
  type: 'IN_APP' | 'WEBHOOK' | 'WECHAT' | 'EMAIL'
  name: string
  config: string // JSON: {"url":"..."}
  enabled: boolean
  createdAt: string
  updatedAt: string
}
