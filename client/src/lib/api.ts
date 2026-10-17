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

  /** Field errors keyed by the field name without the "body." prefix. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const e of this.errors) {
      const key = (e.field ?? '').replace(/^(body|query|params)\./, '')
      if (key && !out[key]) out[key] = e.message
    }
    return out
  }
}

/** Listeners run when any request comes back 401 (session expired or signed out elsewhere). */
const unauthorizedListeners = new Set<() => void>()
export const onUnauthorized = (fn: () => void) => {
  unauthorizedListeners.add(fn)
  return () => void unauthorizedListeners.delete(fn)
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData
  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init.body && !isForm ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.', 'NETWORK_ERROR')
  }

  let body: ApiResponse<T> | null = null
  try {
    body = (await res.json()) as ApiResponse<T>
  } catch {
    // non-JSON response (e.g. proxy error)
  }

  if (!res.ok || !body?.success) {
    if (res.status === 401 && !path.startsWith('/auth/')) unauthorizedListeners.forEach((fn) => fn())
    throw new ApiError(
      body?.statusCode ?? res.status,
      body?.message ?? (res.status >= 500 ? 'The server had a problem. Try again in a moment.' : res.statusText),
      body?.code,
      body?.errors,
    )
  }
  return body.data as T
}

const json = (method: string) => <T>(path: string, data?: unknown) =>
  request<T>(path, { method, body: data === undefined ? undefined : JSON.stringify(data) })

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: json('POST'),
  patch: json('PATCH'),
  put: json('PUT'),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  /** Multipart upload: the file plus plain string fields. */
  upload: <T>(path: string, file: File, fields: Record<string, string | undefined> = {}, field = 'file') => {
    const form = new FormData()
    form.append(field, file)
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== '') form.append(k, v)
    return request<T>(path, { method: 'POST', body: form })
  },
}
