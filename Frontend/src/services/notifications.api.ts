import { api } from './apiClient'
import type { AppNotification, Paginated } from './types'

export const notificationsApi = {
  list: () =>
    api.get<Paginated<AppNotification>>('/notifications/').then((r) => r.data.results),

  unreadCount: () =>
    api.get<{ unread: number }>('/notifications/unread-count/').then((r) => r.data.unread),

  markRead: (id: number) => api.post(`/notifications/${id}/mark-read/`, {}),

  markAllRead: () => api.post('/notifications/mark-all-read/', {}),
}
