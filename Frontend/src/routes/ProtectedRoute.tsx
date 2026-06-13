import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { useAuth } from '../hooks/useAuth'
import { CenteredSpinner } from '../components/primitives/Spinner'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()

  // Wait for the boot-time refresh so we never flash-redirect a logged-in user.
  if (status === 'loading') return <CenteredSpinner />
  if (status === 'anon') {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />
  }
  return <>{children}</>
}
