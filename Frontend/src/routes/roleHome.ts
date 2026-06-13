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
