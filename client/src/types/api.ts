/** Mirrors server/src/common/utils/ApiResponse.ts */
export interface ApiErrorDetail {
  field?: string
  message: string
}

export interface PaginationMeta {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface ApiResponse<T = unknown> {
  success: boolean
  statusCode: number
  message: string
  data: T | null
  errors?: ApiErrorDetail[]
  code?: string
  meta?: { requestId?: string; pagination?: PaginationMeta; [key: string]: unknown }
  timestamp: string
}
