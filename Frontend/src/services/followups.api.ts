import { api } from './apiClient'
import type { Appointment, FollowUp, Paginated } from './types'

export const followupsApi = {
  mine: () => api.get<Paginated<FollowUp>>('/followups/').then((r) => r.data.results),

  create: (origin_appointment: number, recommended_date: string, notes?: string) =>
    api
      .post<FollowUp>('/followups/', { origin_appointment, recommended_date, notes })
      .then((r) => r.data),

  confirm: (id: number) =>
    api.post<Appointment>(`/followups/${id}/confirm/`, {}).then((r) => r.data),

  dismiss: (id: number) =>
    api.post<FollowUp>(`/followups/${id}/dismiss/`, {}).then((r) => r.data),
}
