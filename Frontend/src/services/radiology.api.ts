import { api } from './apiClient'
import type {
  CreateRadiologyOrderPayload,
  Paginated,
  RadiologyModality,
  RadiologyOrder,
  RadiologyOrderPriority,
  RadiologyOrderStatus,
  RadiologyOrderSummary,
  RadiologyTemplate,
} from './types'

export interface RadiologyOrderFilters {
  patient?: number
  doctor?: number
  status?: RadiologyOrderStatus
  priority?: RadiologyOrderPriority
  appointment?: number
  encounter?: number
  page?: number
  page_size?: number
}

export interface RadiologyTemplateFilters {
  modality?: RadiologyModality
  is_active?: boolean
}

export const radiologyApi = {
  listTemplates: (params?: RadiologyTemplateFilters) =>
    api.get<Paginated<RadiologyTemplate>>('/radiology-templates/', { params }).then((r) => r.data),

  list: (params?: RadiologyOrderFilters) =>
    api.get<Paginated<RadiologyOrderSummary>>('/radiology-orders/', { params }).then((r) => r.data),

  get: (id: number) =>
    api.get<RadiologyOrder>(`/radiology-orders/${id}/`).then((r) => r.data),

  create: (data: CreateRadiologyOrderPayload) =>
    api.post<RadiologyOrder>('/radiology-orders/', data).then((r) => r.data),

  complete: (id: number, file: File, description?: string) => {
    const form = new FormData()
    form.append('file', file)
    if (description) form.append('description', description)
    return api
      .post<RadiologyOrder>(`/radiology-orders/${id}/complete/`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data)
  },

  report: (id: number, payload: { findings: string; impression: string }) =>
    api.post<RadiologyOrder>(`/radiology-orders/${id}/report/`, payload).then((r) => r.data),

  cancel: (id: number, reason: string) =>
    api.post<RadiologyOrder>(`/radiology-orders/${id}/cancel/`, { reason }).then((r) => r.data),

  remove: (id: number) => api.delete(`/radiology-orders/${id}/`).then((r) => r.data),
}
