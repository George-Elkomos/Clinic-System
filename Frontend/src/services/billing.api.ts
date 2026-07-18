import { api } from './apiClient'
import type {
  BillingReport,
  Invoice,
  Paginated,
  Payment,
  PaymentMethod,
  ServiceItem,
} from './types'

export const billingApi = {
  // `status` accepts a comma-separated list (e.g. "ISSUED,PARTIALLY_PAID")
  // matched server-side, so the Outstanding tab can't lose rows past page 1.
  invoices: (params?: { status?: string; patient?: number; page?: number; page_size?: number }) =>
    api.get<Paginated<Invoice>>('/invoices/', { params }).then((r) => r.data),

  invoice: (id: number) =>
    api.get<Invoice>(`/invoices/${id}/`).then((r) => r.data),

  // Response embeds `invoice_detail` so the desk can refresh the row in place.
  recordPayment: (data: {
    invoice: number
    amount: string
    payment_method: PaymentMethod
    reference?: string
  }) =>
    api
      .post<Payment & { invoice_detail: Invoice }>('/payments/', data)
      .then((r) => r.data),

  report: (period: 'day' | 'month' | 'year') =>
    api.get<BillingReport>('/reports/billing/', { params: { period } }).then((r) => r.data),

  serviceItems: (params?: { item_type?: string; is_active?: boolean }) =>
    api.get<Paginated<ServiceItem>>('/service-items/', { params }).then((r) => r.data),
}
