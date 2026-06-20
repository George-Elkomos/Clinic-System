import { api } from './apiClient'
import type {
  CreateLabOrderPayload,
  CreateLabOrderResultPayload,
  LabOrder,
  LabOrderSummary,
  Paginated,
} from './types'

export interface LabOrderFilters {
  patient?: number
  doctor?: number
  status?: string
  priority?: string
  page?: number
  page_size?: number
}

export const labOrdersApi = {
  list: (params?: LabOrderFilters) =>
    api.get<Paginated<LabOrderSummary>>('/lab-orders/', { params }).then((r) => r.data),

  get: (id: number) =>
    api.get<LabOrder>(`/lab-orders/${id}/`).then((r) => r.data),

  create: (data: CreateLabOrderPayload) =>
    api.post<LabOrder>('/lab-orders/', data).then((r) => r.data),

  update: (id: number, data: Partial<CreateLabOrderPayload>) =>
    api.patch<LabOrder>(`/lab-orders/${id}/`, data).then((r) => r.data),

  delete: (id: number) =>
    api.delete(`/lab-orders/${id}/`).then(() => undefined),

  submit: (id: number) =>
    api.post<LabOrder>(`/lab-orders/${id}/submit/`).then((r) => r.data),

  collectSample: (id: number) =>
    api.post<LabOrder>(`/lab-orders/${id}/collect-sample/`).then((r) => r.data),

  startProcessing: (id: number) =>
    api.post<LabOrder>(`/lab-orders/${id}/start-processing/`).then((r) => r.data),

  enterResults: (id: number, results: CreateLabOrderResultPayload[]) => {
    const hasFiles = results.some((r) => r.file instanceof File)
    if (hasFiles) {
      const form = new FormData()
      results.forEach((r, i) => {
        Object.entries(r).forEach(([k, v]) => {
          if (v != null) form.append(`results[${i}][${k}]`, v instanceof File ? v : String(v))
        })
      })
      return api.post<LabOrder>(`/lab-orders/${id}/enter-results/`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then((res) => res.data)
    }
    return api.post<LabOrder>(`/lab-orders/${id}/enter-results/`, { results }).then((res) => res.data)
  },

  review: (id: number) =>
    api.post<LabOrder>(`/lab-orders/${id}/review/`).then((r) => r.data),

  downloadResultFile: (orderId: number, resultId: number) =>
    api
      .get(`/lab-orders/${orderId}/results/${resultId}/download/`, { responseType: 'blob' })
      .then((r) => r.data as Blob),
}
