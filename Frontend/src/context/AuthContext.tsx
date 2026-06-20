import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { useQueryClient } from '@tanstack/react-query'

import { tokenStore } from '../lib/tokenStore'
import { authApi } from '../services/auth.api'
import { setOnAuthExpired } from '../services/apiClient'
import type { Role, User } from '../services/types'

type Status = 'loading' | 'authed' | 'anon'

interface AuthContextValue {
  user: User | null
  status: Status
  login: (email: string, password: string) => Promise<User>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
  hasRole: (...roles: Role[]) => boolean
}

// eslint-disable-next-line react-refresh/only-export-components
export const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const bootstrapped = useRef(false)
  const qc = useQueryClient()

  const clearSession = useCallback(() => {
    tokenStore.clear()
    qc.clear()   // drop all cached query data so stale requests can't fire after logout
    setUser(null)
    setStatus('anon')
  }, [qc])

  // Let the Axios interceptor force a logout when refresh ultimately fails.
  useEffect(() => {
    setOnAuthExpired(clearSession)
  }, [clearSession])

  // On boot, try to rehydrate the session from the refresh cookie.
  useEffect(() => {
    if (bootstrapped.current) return
    bootstrapped.current = true
    ;(async () => {
      try {
        const { access } = await authApi.refresh()
        tokenStore.set(access)
        const me = await authApi.me()
        setUser(me)
        setStatus('authed')
      } catch {
        clearSession()
      }
    })()
  }, [clearSession])

  const login = useCallback(async (email: string, password: string) => {
    const { access, user: loggedIn } = await authApi.login(email, password)
    tokenStore.set(access)
    setUser(loggedIn)
    setStatus('authed')
    return loggedIn
  }, [])

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } catch {
      // ignore — clear locally regardless
    }
    clearSession()
  }, [clearSession])

  const refreshUser = useCallback(async () => {
    const me = await authApi.me()
    setUser(me)
  }, [])

  const hasRole = useCallback(
    (...roles: Role[]) => !!user && roles.includes(user.role),
    [user],
  )

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, login, logout, refreshUser, hasRole }),
    [user, status, login, logout, refreshUser, hasRole],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
