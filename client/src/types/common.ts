export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface ApiResponse<T> {
  success: boolean
  data: T
  message?: string
}

/** Extract user-facing message from an API call error */
export function getApiErrorMessage(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { message?: string } }; code?: string }
  if (err?.code === 'ERR_NETWORK') return '无法连接服务器，请检查网络'
  return err?.response?.data?.message || fallback
}

export type TrainingStatus = 'QUEUED' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
export type ModelStatus = 'DRAFT' | 'TRAINING' | 'TRAINED' | 'DEPLOYED' | 'ARCHIVED'
export type DatasetStatus = 'UPLOADING' | 'PROCESSING' | 'READY' | 'ERROR'
export type DeploymentStatus = 'DEPLOYING' | 'RUNNING' | 'STOPPED' | 'FAILED'
export type UserRole = 'ADMIN' | 'MANAGER' | 'ANNOTATOR' | 'VIEWER'
export type PlanType = 'TRIAL' | 'FREE' | 'PRO' | 'ENTERPRISE'
export type BaseModelType = 'QWEN2.5-7B' | 'QWEN2.5-14B' | 'QWEN2.5-72B' | 'DEEPSEEK-V2' | 'DEEPSEEK-CODER' | 'text_classification'
