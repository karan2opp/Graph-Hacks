import type { ApiErrorDetail, ApiResponse } from '../types/api'

const BASE_URL = `${import.meta.env.VITE_API_URL ?? ''}/api/v1`

/** Thrown for any non-2xx response, carrying the server's standard error body. */
export class ApiError extends Error {
  statusCode: number
  code?: string
  errors: ApiErrorDetail[]

  constructor(statusCode: number, message: string, code?: string, errors: ApiErrorDetail[] = []) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.code = code
    this.errors = errors
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<ApiResponse<T>> {
  const isForm = init.body instanceof FormData
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body && !isForm ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })

  let body: ApiResponse<T> | null = null
  try {
    body = (await res.json()) as ApiResponse<T>
  } catch {
    // non-JSON response (e.g. proxy error)
  }

  if (!res.ok || !body?.success) {
    throw new ApiError(
      body?.statusCode ?? res.status,
      body?.message ?? res.statusText,
      body?.code,
      body?.errors,
    )
  }
  return body
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data) }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PUT', body: data === undefined ? undefined : JSON.stringify(data) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, file: File, field = 'file') => {
    const form = new FormData()
    form.append(field, file)
    return request<T>(path, { method: 'POST', body: form })
  },
}
