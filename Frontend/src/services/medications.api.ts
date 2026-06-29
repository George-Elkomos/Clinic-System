import { api } from './apiClient'
import type { DosageForm, DosagePattern, Medication, Paginated } from './types'

export const medicationsApi = {
  search: (q: string) =>
    api
      .get<Paginated<Medication>>('/medications/', { params: { search: q || undefined, is_active: true } })
      .then((r) => r.data.results),
}

export const dosageFormsApi = {
  list: () =>
    api
      .get<Paginated<DosageForm>>('/dosage-forms/', { params: { is_active: true } })
      .then((r) => r.data.results),
}

export const dosagePatternsApi = {
  list: () =>
    api
      .get<Paginated<DosagePattern>>('/dosage-patterns/', { params: { is_active: true } })
      .then((r) => r.data.results),
}
