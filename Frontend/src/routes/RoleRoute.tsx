import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'

import { useAuth } from '../hooks/useAuth'
import type { Role } from '../services/types'
import { ProtectedRoute } from './ProtectedRoute'

// Requires auth (via ProtectedRoute) AND membership in `roles`, else -> /403.
export function RoleRoute({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth()
  return (
    <ProtectedRoute>
      {user && roles.includes(user.role) ? <>{children}</> : <Navigate to="/403" replace />}
    </ProtectedRoute>
  )
}
