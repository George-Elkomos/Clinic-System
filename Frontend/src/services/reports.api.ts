import { api } from './apiClient'
import type { DiagnosisDistribution, Report } from './types'

export const reportsApi = {
  dashboard: (period: string) =>
    api.get<Report>('/reports/dashboard/', { params: { period } }).then((r) => r.data),

  diagnosisDistribution: (period: string) =>
    api
      .get<DiagnosisDistribution>('/reports/diagnosis-distribution/', { params: { period } })
      .then((r) => r.data),

  // fmt = pdf | csv (param is "fmt"; ?format= is reserved by DRF)
  exportBlob: (fmt: 'pdf' | 'csv', period: string) =>
    api
      .get('/reports/export/', { params: { fmt, period }, responseType: 'blob' })
      .then((r) => r.data as Blob),
}
