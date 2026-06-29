import { api } from './apiClient'
import type {
  Complaint,
  Diagnosis,
  Encounter,
  Paginated,
  UpdateEncounterPayload,
} from './types'

export const encountersApi = {
  list: (params?: { patient?: number; status?: string; page?: number }) =>
    api.get<Paginated<Encounter>>('/encounters/', { params }).then((r) => r.data),

  get: (id: number) =>
    api.get<Encounter>(`/encounters/${id}/`).then((r) => r.data),

  list: (params?: { patient?: number; status?: string }) =>
    api.get<Paginated<Encounter>>('/encounters/', { params }).then((r) => r.data.results),

  update: (id: number, data: UpdateEncounterPayload) =>
    api.patch<Encounter>(`/encounters/${id}/`, data).then((r) => r.data),

  submit: (id: number) =>
    api.post<Encounter>(`/encounters/${id}/submit/`).then((r) => r.data),

  amend: (id: number) =>
    api.post<Encounter>(`/encounters/${id}/amend/`).then((r) => r.data),

  draftForAppointment: (appointmentId: number) =>
    api
      .post<Encounter>('/encounters/draft-for-appointment/', { appointment: appointmentId })
      .then((r) => r.data),
}

export const complaintsApi = {
  search: (q: string) =>
    api
      .get<Paginated<Complaint>>('/complaints/', { params: { search: q || undefined, is_active: true } })
      .then((r) => r.data.results),
}

export const diagnosesApi = {
  search: (q: string) =>
    api
      .get<Paginated<Diagnosis>>('/diagnoses/', { params: { search: q || undefined, is_active: true } })
      .then((r) => r.data.results),
}
