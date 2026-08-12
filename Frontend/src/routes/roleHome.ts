import type { Role } from '../services/types'

const HOME: Record<Role, string> = {
  PATIENT: '/patient',
  DOCTOR: '/doctor',
  SECRETARY: '/secretary',
  MANAGER: '/manager',
}

export function roleHome(role: Role): string {
  return HOME[role] ?? '/login'
}

// Mirrors the RoleRoute gating in router.tsx: which roles may land on each
// role-owned path prefix.
const GATED_PREFIXES: Array<{ prefix: string; roles: Role[] }> = [
  { prefix: '/patient', roles: ['PATIENT'] },
  { prefix: '/doctor', roles: ['DOCTOR'] },
  { prefix: '/secretary', roles: ['SECRETARY', 'MANAGER'] },
  { prefix: '/manager', roles: ['MANAGER'] },
  { prefix: '/account', roles: ['PATIENT', 'DOCTOR', 'SECRETARY', 'MANAGER'] },
  { prefix: '/change-password', roles: ['PATIENT', 'DOCTOR', 'SECRETARY', 'MANAGER'] },
]

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`)
}

/**
 * Resolves where to send a user right after login/register, given an optional
 * `?next=` query param. `next` can be left over from a *different* session —
 * ProtectedRoute stamps it onto the URL whenever any user gets bounced to
 * /login, so it may point at a path the newly-authenticated role can't
 * access. Only honor it when it's a public path or one this role actually
 * owns; otherwise fall back to that role's own home.
 */
export function resolvePostAuthRedirect(next: string | null | undefined, role: Role): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return roleHome(role)
  const gated = GATED_PREFIXES.find((entry) => matchesPrefix(next, entry.prefix))
  if (!gated) return next
  return gated.roles.includes(role) ? next : roleHome(role)
}
