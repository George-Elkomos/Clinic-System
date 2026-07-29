import { api } from './apiClient'
import type {
  ClinicalProcedure,
  ClinicalProcedureSummary,
  CreateProcedurePayload,
  Paginated,
  ProcedureStatus,
  ProcedureTemplate,
} from './types'

export interface ProcedureFilters {
  patient?: number
  doctor?: number
  status?: ProcedureStatus
  appointment?: number
  encounter?: number
  page?: number
  page_size?: number
}

export interface ProcedureTemplateFilters {
  category?: string
  is_active?: boolean
}

export const proceduresApi = {
  listTemplates: (params?: ProcedureTemplateFilters) =>
    api.get<Paginated<ProcedureTemplate>>('/procedure-templates/', { params }).then((r) => r.data),

  list: (params?: ProcedureFilters) =>
    api.get<Paginated<ClinicalProcedureSummary>>('/procedures/', { params }).then((r) => r.data),

  get: (id: number) =>
    api.get<ClinicalProcedure>(`/procedures/${id}/`).then((r) => r.data),

  create: (data: CreateProcedurePayload) =>
    api.post<ClinicalProcedure>('/procedures/', data).then((r) => r.data),

  update: (id: number, data: Partial<ClinicalProcedure>) =>
    api.patch<ClinicalProcedure>(`/procedures/${id}/`, data).then((r) => r.data),

  start: (id: number) =>
    api.post<ClinicalProcedure>(`/procedures/${id}/start/`).then((r) => r.data),

  complete: (id: number, payload: { post_procedure_notes?: string; complications?: string }) =>
    api.post<ClinicalProcedure>(`/procedures/${id}/complete/`, payload).then((r) => r.data),

  cancel: (id: number, reason: string) =>
    api.post<ClinicalProcedure>(`/procedures/${id}/cancel/`, { reason }).then((r) => r.data),
}
