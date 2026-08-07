import type { ApiResponse, PaginatedResponse } from './common'
import type {
  User, Tenant,
  Dataset, AiModel, ModelVersion,
  TrainingJob, Deployment,
  ApiKey, AuditLog, DashboardStats, ApiUsageRecord, PlanDef,
  Notification, AlertChannel, NotificationInbox
} from './models'

export interface LoginRequest { email: string; password: string }
export interface RegisterRequest { email: string; password: string; name: string; companyName: string; planType?: string }
export interface LoginResponse { token: string; user: User }

export interface CreateDatasetRequest { name: string; description: string; industry: string; scenario: string }
export interface CreateModelRequest { name: string; description: string; industry: string; scenario: string; baseModel: string }
export interface CreateTrainingRequest { modelId: string; datasetVersionId: string; hyperparams: Record<string, unknown> }
export interface CreateDeploymentRequest { modelVersionId: string; name: string }
export interface CreateApiKeyRequest { name: string; rateLimit: number }

export interface CreateApiKeyResponse extends ApiKey {
  apiKey?: string
}

export interface UpdateBrandingRequest {
  companyName?: string; logoUrl?: string; primaryColor?: string
  faviconUrl?: string; customDomain?: string
}

export type AuthApi = {
  login: (req: LoginRequest) => Promise<ApiResponse<LoginResponse>>
  register: (req: RegisterRequest) => Promise<ApiResponse<LoginResponse>>
  me: () => Promise<ApiResponse<User>>
}

export type DatasetsApi = {
  list: (params?: Record<string, unknown>) => Promise<ApiResponse<PaginatedResponse<Dataset>>>
  get: (id: string) => Promise<ApiResponse<Dataset>>
  create: (req: CreateDatasetRequest) => Promise<ApiResponse<Dataset>>
  upload: (id: string, file: File, onProgress?: (pct: number) => void) => Promise<ApiResponse<Dataset>>
  remove: (id: string) => Promise<ApiResponse<void>>
}

export type ModelsApi = {
  list: (params?: Record<string, unknown>) => Promise<ApiResponse<PaginatedResponse<AiModel>>>
  get: (id: string) => Promise<ApiResponse<AiModel>>
  create: (req: CreateModelRequest) => Promise<ApiResponse<AiModel>>
  remove: (id: string) => Promise<ApiResponse<void>>
  getVersions: (id: string) => Promise<ApiResponse<ModelVersion[]>>
}

export type TrainingApi = {
  list: (params?: Record<string, unknown>) => Promise<ApiResponse<PaginatedResponse<TrainingJob>>>
  get: (id: string) => Promise<ApiResponse<TrainingJob>>
  create: (req: CreateTrainingRequest) => Promise<ApiResponse<TrainingJob>>
  control: (id: string, action: 'pause' | 'resume' | 'stop') => Promise<ApiResponse<TrainingJob>>
}

export type DeploymentsApi = {
  list: (params?: Record<string, unknown>) => Promise<ApiResponse<PaginatedResponse<Deployment>>>
  get: (id: string) => Promise<ApiResponse<Deployment>>
  create: (req: CreateDeploymentRequest) => Promise<ApiResponse<Deployment>>
  remove: (id: string) => Promise<ApiResponse<void>>
  createApiKey: (deploymentId: string, req: CreateApiKeyRequest) => Promise<ApiResponse<CreateApiKeyResponse>>
  deleteApiKey: (deploymentId: string, keyId: string) => Promise<ApiResponse<void>>
  testCall: (deploymentId: string, input: string) => Promise<ApiResponse<{ output: string }>>
}

export type SettingsApi = {
  getTenant: () => Promise<ApiResponse<Tenant>>
  updateBranding: (req: UpdateBrandingRequest) => Promise<ApiResponse<Tenant>>
  getMembers: () => Promise<ApiResponse<User[]>>
  getUsage: () => Promise<ApiResponse<{ totalCalls: number; totalTokens: number; dailyStats: { date: string; calls: number; tokens: number }[] }>>
  getUsageRecords: (params?: Record<string, unknown>) => Promise<ApiResponse<PaginatedResponse<ApiUsageRecord>>>
  getAuditLogs: (params?: Record<string, unknown>) => Promise<ApiResponse<PaginatedResponse<AuditLog>>>
  getPlans: () => Promise<ApiResponse<PlanDef[]>>
  changePlan: (req: { planType: string; apiCallQuota?: number }) => Promise<ApiResponse<Tenant>>
  exportUsage: (params?: { format?: string }) => Promise<Blob>
  getChannels: () => Promise<ApiResponse<AlertChannel[]>>
  createChannel: (req: CreateChannelRequest) => Promise<ApiResponse<AlertChannel>>
  updateChannel: (id: string, req: UpdateChannelRequest) => Promise<ApiResponse<AlertChannel>>
  deleteChannel: (id: string) => Promise<ApiResponse<void>>
}

export type NotificationApi = {
  getInbox: (params?: { page?: number; pageSize?: number }) => Promise<ApiResponse<NotificationInbox>>
  markRead: (id: string) => Promise<ApiResponse<Notification>>
  markAllRead: () => Promise<ApiResponse<void>>
  sendTest: () => Promise<ApiResponse<void>>
}

export interface CreateChannelRequest { type: 'IN_APP' | 'WEBHOOK' | 'WECHAT' | 'EMAIL'; name: string; config?: unknown; enabled?: boolean }
export interface UpdateChannelRequest { name?: string; config?: unknown; enabled?: boolean }

export type DashboardApi = {
  getStats: () => Promise<ApiResponse<DashboardStats>>
}
