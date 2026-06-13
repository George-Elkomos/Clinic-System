import { api } from './apiClient'
import type {
  CreateDoctorPayload,
  CreateDoctorResponse,
  CreatePatientPayload,
  CreatePatientResponse,
  CreateSecretaryPayload,
  CreateSecretaryResponse,
  PatientProfile,
  UserEditPayload,
  UserManagementEntry,
} from './types'

export const staffApi = {
  createDoctor: (data: CreateDoctorPayload): Promise<CreateDoctorResponse> => {
    if (data.photo) {
      const form = new FormData()
      Object.entries(data).forEach(([k, v]) => {
        if (v === null || v === undefined || v === '') return
        if (k === 'specialties') {
          ;(v as number[]).forEach((id) => form.append('specialties', String(id)))
        } else {
          form.append(k, v as string | Blob)
        }
      })
      return api.post<CreateDoctorResponse>('/staff/create-doctor/', form).then((r) => r.data)
    }
    return api.post<CreateDoctorResponse>('/staff/create-doctor/', data).then((r) => r.data)
  },

  createSecretary: (data: CreateSecretaryPayload): Promise<CreateSecretaryResponse> =>
    api.post<CreateSecretaryResponse>('/staff/create-secretary/', data).then((r) => r.data),

  createPatient: (data: CreatePatientPayload): Promise<CreatePatientResponse> =>
    api.post<CreatePatientResponse>('/staff/create-patient/', data).then((r) => r.data),

  listUsers: (role?: string, search?: string): Promise<UserManagementEntry[]> => {
    const params = new URLSearchParams()
    if (role) params.set('role', role)
    if (search) params.set('search', search)
    return api.get<UserManagementEntry[]>(`/staff/users/?${params}`).then((r) => r.data)
  },

  updateUser: (id: number, data: UserEditPayload): Promise<UserManagementEntry> =>
    api.patch<UserManagementEntry>(`/staff/users/${id}/`, data).then((r) => r.data),

  deactivateUser: (id: number): Promise<void> =>
    api.post(`/staff/users/${id}/deactivate/`).then(() => undefined),

  reactivateUser: (id: number): Promise<void> =>
    api.post(`/staff/users/${id}/reactivate/`).then(() => undefined),

  resetPassword: (id: number): Promise<{ temp_password: string }> =>
    api.post<{ temp_password: string }>(`/staff/users/${id}/reset-password/`).then((r) => r.data),

  getPatientProfile: (profileId: number): Promise<PatientProfile> =>
    api.get<PatientProfile>(`/patients/${profileId}/profile/`).then((r) => r.data),

  updatePatientProfile: (profileId: number, data: Partial<PatientProfile>): Promise<PatientProfile> =>
    api.patch<PatientProfile>(`/patients/${profileId}/profile/`, data).then((r) => r.data),
}
