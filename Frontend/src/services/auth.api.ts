import { api } from './apiClient'
import type { Language, NotificationPreference, PatientProfile, User } from './types'

export interface LoginResponse {
  access: string
  user: User
}

export const authApi = {
  login: (email: string, password: string) =>
    api.post<LoginResponse>('/auth/login/', { email, password }).then((r) => r.data),

  refresh: () => api.post<{ access: string }>('/auth/refresh/', {}).then((r) => r.data),

  logout: () => api.post('/auth/logout/', {}),

  me: () => api.get<User>('/auth/me/').then((r) => r.data),

  updateMe: (data: Partial<Pick<User, 'first_name' | 'last_name' | 'phone'>> & { preferred_language?: Language }) =>
    api.patch<User>('/auth/me/', data).then((r) => r.data),

  register: (data: {
    email: string
    password: string
    password_confirm: string
    first_name: string
    last_name: string
    phone?: string
  }) => api.post<User>('/auth/register/', data).then((r) => r.data),

  patientProfile: () =>
    api.get<PatientProfile>('/auth/me/patient-profile/').then((r) => r.data),

  updatePatientProfile: (data: Partial<PatientProfile>) =>
    api.patch<PatientProfile>('/auth/me/patient-profile/', data).then((r) => r.data),

  notificationPreference: () =>
    api.get<NotificationPreference>('/auth/me/notification-preference/').then((r) => r.data),

  updateNotificationPreference: (data: Partial<NotificationPreference>) =>
    api.patch<NotificationPreference>('/auth/me/notification-preference/', data).then((r) => r.data),
}
