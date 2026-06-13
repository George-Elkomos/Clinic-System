import { api } from './apiClient'
import type { Paginated, WaitlistEntry } from './types'

export const waitlistApi = {
  mine: () =>
    api.get<Paginated<WaitlistEntry>>('/waitlist/').then((r) => r.data.results),

  join: (doctor: number, desired_date_from: string, desired_date_to: string) =>
    api
      .post<WaitlistEntry>('/waitlist/', { doctor, desired_date_from, desired_date_to })
      .then((r) => r.data),

  cancel: (id: number) => api.delete(`/waitlist/${id}/`),
}
