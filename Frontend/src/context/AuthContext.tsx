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
  login: (identifier: string, password: string) => Promise<User>
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

  // Resets local auth state only — no prior session to protect, so there's
  // nothing worth dropping from the query cache (see resetToAnon below for
  // why this must stay separate from clearSession).
  const resetToAnon = useCallback(() => {
    tokenStore.clear()
    setUser(null)
    setStatus('anon')
  }, [])

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

  // On boot, try to rehydrate the session from the refresh cookie. For an
  // anonymous visitor this 401s every time — expected, not a session loss —
  // so it must use resetToAnon, not clearSession: qc.clear() wipes the ENTIRE
  // query cache, including whatever public queries (e.g. the doctors list)
  // other components kicked off in parallel and are still awaiting. Since
  // those requests aren't wired to an AbortController, clearing the cache
  // doesn't stop them — it just orphans their eventual result: react-query
  // has no query entry left to write it into and no observer left to notify,
  // so the requesting component's isLoading never leaves true even though
  // the request succeeded. clearSession (with the cache wipe) stays reserved
  // for actual session-loss paths — the onAuthExpired callback above and
  // logout() below — where there may be real per-user data worth scrubbing.
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
        resetToAnon()
      }
    })()
  }, [resetToAnon])

  const login = useCallback(async (identifier: string, password: string) => {
    const { access, user: loggedIn } = await authApi.login(identifier, password)
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
