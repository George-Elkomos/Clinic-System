import { api } from './apiClient'
import type { CreateReferralPayload, Paginated, Referral } from './types'

export const referralsApi = {
  list: (params?: { patient?: number; referring_doctor?: number; target_doctor?: number; status?: string }) =>
    api.get<Paginated<Referral>>('/referrals/', { params }).then((r) => r.data),

  get: (id: number) => api.get<Referral>(`/referrals/${id}/`).then((r) => r.data),

  create: (data: CreateReferralPayload) => api.post<Referral>('/referrals/', data).then((r) => r.data),

  accept: (id: number) => api.post<Referral>(`/referrals/${id}/accept/`).then((r) => r.data),

  complete: (id: number) => api.post<Referral>(`/referrals/${id}/complete/`).then((r) => r.data),

  cancel: (id: number) => api.post<Referral>(`/referrals/${id}/cancel/`).then((r) => r.data),
}
