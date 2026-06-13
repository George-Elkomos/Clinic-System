import { api } from './apiClient'
import type { Paginated, Review } from './types'

export const reviewsApi = {
  // Role-scoped on the server: patient→own, doctor→own (read), manager→all.
  list: () => api.get<Paginated<Review>>('/reviews/').then((r) => r.data.results),

  create: (appointment: number, rating: number, comment: string) =>
    api.post<Review>('/reviews/', { appointment, rating, comment }).then((r) => r.data),

  hide: (id: number, reason: string) =>
    api.post<Review>(`/reviews/${id}/hide/`, { reason }).then((r) => r.data),

  unhide: (id: number) => api.post<Review>(`/reviews/${id}/unhide/`, {}).then((r) => r.data),
}
