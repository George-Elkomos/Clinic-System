import { api } from './apiClient'
import type { CreateVitalSignsPayload, Paginated, UpdateVitalSignsPayload, VitalSigns } from './types'

export const vitalsApi = {
  list: (patientId?: number, page = 1, pageSize = 10) =>
    api
      .get<Paginated<VitalSigns>>('/vital-signs/', { params: { patient: patientId, page, page_size: pageSize } })
      .then((r) => r.data),

  trend: (patientId: number) =>
    api
      .get<Paginated<VitalSigns>>('/vital-signs/', { params: { patient: patientId, page: 1, page_size: 10 } })
      .then((r) => r.data.results),

  get: (id: number) => api.get<VitalSigns>(`/vital-signs/${id}/`).then((r) => r.data),

  create: (data: CreateVitalSignsPayload) =>
    api.post<VitalSigns>('/vital-signs/', data).then((r) => r.data),

  update: (id: number, data: UpdateVitalSignsPayload) =>
    api.patch<VitalSigns>(`/vital-signs/${id}/`, data).then((r) => r.data),

  delete: (id: number) => api.delete(`/vital-signs/${id}/`).then(() => undefined),
}
