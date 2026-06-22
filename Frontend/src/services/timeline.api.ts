import { api } from './apiClient'
import type { Paginated, TimelineEvent, TimelineFilters } from './types'

export const timelineApi = {
  list: (patientId: number, filters: TimelineFilters = {}, page = 1, pageSize = 20) =>
    api
      .get<Paginated<TimelineEvent>>(`/patients/${patientId}/timeline/`, {
        params: {
          types: filters.types || undefined,
          date_from: filters.date_from || undefined,
          date_to: filters.date_to || undefined,
          page,
          page_size: pageSize,
        },
      })
      .then((r) => r.data),
}
