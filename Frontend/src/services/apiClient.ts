import axios, {
  type AxiosError,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios'

import { tokenStore } from '../lib/tokenStore'

// Authenticated client. withCredentials so the httpOnly refresh cookie is sent
// to /api/auth/refresh and /api/auth/logout.
export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
})

// Public, auth-free client for the no-login kiosk display.
export const publicApi = axios.create({ baseURL: '/api' })

// AuthContext registers a callback so the app can react to a hard session loss.
let onAuthExpired: (() => void) | null = null
export function setOnAuthExpired(cb: () => void) {
  onAuthExpired = cb
}

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = tokenStore.get()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Single-flight refresh: concurrent 401s share one /auth/refresh call.
let refreshPromise: Promise<string> | null = null

async function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = axios
      .post('/api/auth/refresh/', {}, { withCredentials: true })
      .then((res) => {
        const access: string = res.data.access
        tokenStore.set(access)
        return access
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as
      | (AxiosRequestConfig & { _retried?: boolean })
      | undefined
    const url = original?.url ?? ''
    const isAuthCall = url.includes('/auth/refresh') || url.includes('/auth/login')

    if (error.response?.status === 401 && original && !original._retried && !isAuthCall) {
      original._retried = true
      try {
        const access = await refreshAccessToken()
        original.headers = original.headers ?? {}
        ;(original.headers as Record<string, string>).Authorization = `Bearer ${access}`
        return api(original)
      } catch {
        tokenStore.clear()
        onAuthExpired?.()
      }
    }
    return Promise.reject(error)
  },
)

/**
 * Turns any Axios error into a human-readable string for toast notifications.
 *
 * DRF can return several shapes:
 *   {detail: "…"}                     — permission/auth errors, 404
 *   {field: ["msg1", "msg2"]}         — field validation errors
 *   {field: {nested: ["msg"]}}        — nested serializer errors
 *   {results: [{test_name: ["msg"]}]} — list-item validation errors (e.g. enter-results)
 *
 * Previously only the first shape was handled; the rest were silently dropped.
 */
export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!axios.isAxiosError(error)) return fallback
  const data = error.response?.data
  if (!data || typeof data !== 'object') return fallback

  const d = data as Record<string, unknown>

  // Simple {detail: "…"} — most common for permission/auth errors
  if (typeof d.detail === 'string') return d.detail

  // Field-level validation: collect every message recursively
  const messages: string[] = []
  const collect = (label: string, val: unknown): void => {
    if (typeof val === 'string') {
      messages.push(label ? `${label}: ${val}` : val)
    } else if (Array.isArray(val)) {
      val.forEach((item, i) => {
        if (typeof item === 'string') {
          messages.push(label ? `${label}: ${item}` : item)
        } else {
          // nested object inside a list (e.g. items[0].test_name: ["err"])
          collect(label ? `${label}[${i}]` : `[${i}]`, item)
        }
      })
    } else if (val !== null && typeof val === 'object') {
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        collect(label ? `${label}.${k}` : k, v)
      }
    }
  }

  for (const [field, value] of Object.entries(d)) {
    collect(field, value)
  }

  return messages.length > 0 ? messages.join('\n') : fallback
}
