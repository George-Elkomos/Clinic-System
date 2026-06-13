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

// Turns an Axios error into a plain-language message (backend sends {detail}).
export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { detail?: string } | undefined
    if (data?.detail) return data.detail
  }
  return fallback
}
