import { api } from './apiClient'
import type { Language, NotificationPreference, PatientProfile, StaffProfile, User } from './types'

export interface LoginResponse {
  access: string
  user: User
}

// null means "remove the current photo", a File means "upload this one",
// undefined/omitted means "leave it alone".
export type UpdateMePayload = Partial<Pick<User, 'first_name' | 'last_name' | 'phone'>> & {
  preferred_language?: Language
  avatar?: File | null
}

export const authApi = {
  // `identifier` is either an email address or a phone number -- the backend
  // accepts both under the same "email" field (see EmailOrPhoneBackend).
  login: (identifier: string, password: string) =>
    api.post<LoginResponse>('/auth/login/', { email: identifier, password }).then((r) => r.data),

  refresh: () => api.post<{ access: string }>('/auth/refresh/', {}).then((r) => r.data),

  logout: () => api.post('/auth/logout/', {}),

  me: () => api.get<User>('/auth/me/').then((r) => r.data),

  updateMe: (data: UpdateMePayload) => {
    if (data.avatar !== undefined) {
      const form = new FormData()
      Object.entries(data).forEach(([k, v]) => {
        if (k === 'avatar') {
          form.append('avatar', v === null ? '' : (v as File))
        } else if (v !== undefined && v !== null) {
          form.append(k, String(v))
        }
      })
      return api.patch<User>('/auth/me/', form).then((r) => r.data)
    }
    return api.patch<User>('/auth/me/', data).then((r) => r.data)
  },

  staffProfile: () => api.get<StaffProfile>('/auth/me/staff-profile/').then((r) => r.data),

  updateStaffProfile: (data: Partial<StaffProfile>) =>
    api.patch<StaffProfile>('/auth/me/staff-profile/', data).then((r) => r.data),

  register: (data: {
    email: string
    password: string
    password_confirm: string
    first_name: string
    last_name: string
    phone?: string
    preferred_language?: 'en' | 'ar'
  }) => api.post<User>('/auth/register/', data).then((r) => r.data),

  patientProfile: () =>
    api.get<PatientProfile>('/auth/me/patient-profile/').then((r) => r.data),

  updatePatientProfile: (data: Partial<PatientProfile>) =>
    api.patch<PatientProfile>('/auth/me/patient-profile/', data).then((r) => r.data),

  notificationPreference: () =>
    api.get<NotificationPreference>('/auth/me/notification-preference/').then((r) => r.data),

  updateNotificationPreference: (data: Partial<NotificationPreference>) =>
    api.patch<NotificationPreference>('/auth/me/notification-preference/', data).then((r) => r.data),

  requestPasswordReset: (email: string) =>
    api.post<{ detail: string }>('/auth/password-reset/', { email }).then((r) => r.data),

  confirmPasswordReset: (data: { uid: string; token: string; new_password: string }) =>
    api.post<{ detail: string }>('/auth/password-reset/confirm/', data).then((r) => r.data),

  changePassword: (data: { current_password: string; new_password: string }) =>
    api.post<{ detail: string }>('/auth/me/change-password/', data).then((r) => r.data),
}
