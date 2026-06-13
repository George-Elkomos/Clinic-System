import { api } from './apiClient'
import type {
  Doctor,
  DoctorAbsence,
  Paginated,
  Specialty,
  TimeSlot,
  WorkingSchedule,
} from './types'

export const doctorsApi = {
  list: (params?: { search?: string; specialties?: number }) =>
    api.get<Paginated<Doctor>>('/doctors/', { params }).then((r) => r.data),

  get: (id: number) => api.get<Doctor>(`/doctors/${id}/`).then((r) => r.data),

  update: (id: number, data: FormData | Partial<Doctor>) =>
    api.patch<Doctor>(`/doctors/${id}/`, data).then((r) => r.data),

  specialties: () =>
    api.get<Paginated<Specialty>>('/specialties/').then((r) => r.data.results),

  availableSlots: (doctorId: number, date?: string) =>
    api
      .get<TimeSlot[]>('/slots/available/', { params: { doctor: doctorId, date } })
      .then((r) => r.data),

  schedules: (doctorId?: number) =>
    api
      .get<Paginated<WorkingSchedule>>('/working-schedules/', { params: { doctor: doctorId } })
      .then((r) => r.data.results),

  createSchedule: (data: Partial<WorkingSchedule>) =>
    api.post<WorkingSchedule>('/working-schedules/', data).then((r) => r.data),

  deleteSchedule: (id: number) => api.delete(`/working-schedules/${id}/`),

  absences: (doctorId?: number) =>
    api
      .get<Paginated<DoctorAbsence>>('/doctor-absences/', { params: { doctor: doctorId } })
      .then((r) => r.data.results),

  createAbsence: (data: {
    doctor: number
    start_date: string
    end_date: string
    absence_type: string
    reason?: string
  }) => api.post<DoctorAbsence>('/doctor-absences/', data).then((r) => r.data),
}
