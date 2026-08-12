import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'

import { useAuth } from '../hooks/useAuth'
import type { Role } from '../services/types'
import { ProtectedRoute } from './ProtectedRoute'
import { roleHome } from './roleHome'

// Requires auth (via ProtectedRoute) AND membership in `roles`. A role
// mismatch means an authenticated user landed on a route owned by another
// role (e.g. a stale URL from a previous session) — send them to their own
// dashboard rather than the /403 dead end.
export function RoleRoute({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth()
  return (
    <ProtectedRoute>
      {user ? (
        roles.includes(user.role) ? <>{children}</> : <Navigate to={roleHome(user.role)} replace />
      ) : (
        <Navigate to="/403" replace />
      )}
    </ProtectedRoute>
  )
}
