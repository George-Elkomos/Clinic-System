import { api, publicApi } from './apiClient'
import type { Appointment, DoctorQueue, KioskQueue, Paginated, PatientSummary, QueuePosition } from './types'

export const appointmentsApi = {
  list: (params?: { status?: string; doctor?: number; date?: string }) =>
    api.get<Paginated<Appointment>>('/appointments/', { params }).then((r) => r.data),

  book: (slot: number, reason?: string, patient?: number) =>
    api.post<Appointment>('/appointments/', { slot, reason, patient }).then((r) => r.data),

  confirm: (id: number) =>
    api.post<Appointment>(`/appointments/${id}/confirm/`, {}).then((r) => r.data),

  cancel: (id: number, reason?: string) =>
    api.post<Appointment>(`/appointments/${id}/cancel/`, { reason }).then((r) => r.data),

  checkIn: (id: number) =>
    api.post<Appointment>(`/appointments/${id}/check-in/`, {}).then((r) => r.data),

  start: (id: number) =>
    api.post<Appointment>(`/appointments/${id}/start/`, {}).then((r) => r.data),

  complete: (id: number) =>
    api.post<Appointment>(`/appointments/${id}/complete/`, {}).then((r) => r.data),

  walkIn: (data: { patient: number; doctor: number; reason?: string; emergency?: boolean }) =>
    api.post<Appointment>('/appointments/walk-in/', data).then((r) => r.data),

  markEmergency: (id: number) =>
    api.post<Appointment>(`/appointments/${id}/mark-emergency/`, {}).then((r) => r.data),

  noShow: (id: number) =>
    api.post<Appointment>(`/appointments/${id}/no-show/`, {}).then((r) => r.data),

  myQueue: () =>
    api.get<DoctorQueue>('/appointments/my-queue/').then((r) => r.data),

  queuePosition: (id: number) =>
    api.get<QueuePosition>(`/appointments/${id}/queue-position/`).then((r) => r.data),

  // Patient lookup for the walk-in picker (secretary/manager).
  patients: (search?: string) =>
    api.get<PatientSummary[]>('/patients/', { params: { search } }).then((r) => r.data),
}

// Public kiosk feed — no auth.
export const kioskApi = {
  queue: (doctorId: number) =>
    publicApi.get<KioskQueue>(`/public/kiosk/${doctorId}/`).then((r) => r.data),
}
