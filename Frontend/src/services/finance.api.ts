// Base service layer for the Finance module. Endpoints mirror
// Backend/apps/billing/{views,urls}.py on financial-foundation@6952e98 — see
// docs/financial-design/FINANCIAL-ROADMAP.md for the task-by-task backend
// contract this was audited against.
//
// Deliberately separate from `billing.api.ts` (used by the existing
// /patient/invoices, /secretary/billing and /manager/billing pages, which
// this phase does not touch) even though a few endpoints overlap — keeps the
// Finance module free to evolve its own request/response shapes without
// risking those already-shipped screens.
//
// Four write endpoints require the `Idempotency-Key` header (payments,
// credit notes, refunds, cash movements) — callers pass a key obtained from
// `useIdempotencyKey`. Cashier shift open/close and invoice cancellation are
// guarded by DB constraints instead and take no key.

import { api } from './apiClient'
import { idempotencyHeader } from '../lib/idempotency'
import type {
  CashierShift,
  CashMovement,
  CashMovementType,
  CreditNote,
  DraftInvoice,
  Invoice,
  InvoiceItem,
  Paginated,
  Payment,
  PaymentMethod,
  PendingCheckoutRow,
  Refund,
} from './types'

export interface InvoiceListParams {
  status?: string
  patient?: number
  doctor?: number
  page?: number
  page_size?: number
}

export interface PaymentListParams {
  invoice?: number
  payment_method?: PaymentMethod
  page?: number
  page_size?: number
}

export interface CashierShiftListParams {
  cashier?: number
  till_id?: string
  status?: string
  page?: number
  page_size?: number
}

export interface CashMovementListParams {
  shift?: number
  movement_type?: CashMovementType
  page?: number
  page_size?: number
}

export interface PendingCheckoutListParams {
  page?: number
  page_size?: number
}

export const financeApi = {
  // --- Invoices (read-only; created only via other apps' completion hooks) ---

  invoices: (params?: InvoiceListParams) =>
    api.get<Paginated<Invoice>>('/invoices/', { params }).then((r) => r.data),

  invoice: (id: number) => api.get<Invoice>(`/invoices/${id}/`).then((r) => r.data),

  cancelInvoice: (id: number, data: { reason_code: string }) =>
    api.post<Invoice>(`/invoices/${id}/cancel/`, data).then((r) => r.data),

  // --- Corrections (Manager only, both require Idempotency-Key) ---

  issueCreditNote: (
    id: number,
    data: { amount: string; reason_code: string },
    idempotencyKey: string,
  ) =>
    api
      .post<CreditNote & { invoice: Invoice }>(`/invoices/${id}/credit-note/`, data, {
        headers: idempotencyHeader(idempotencyKey),
      })
      .then((r) => r.data),

  issueRefund: (
    id: number,
    data: { amount: string; payment_method: PaymentMethod; reason_code: string; paid_by?: number },
    idempotencyKey: string,
  ) =>
    api
      .post<Refund & { invoice: Invoice }>(`/invoices/${id}/refund/`, data, {
        headers: idempotencyHeader(idempotencyKey),
      })
      .then((r) => r.data),

  // --- Payments (Secretary + Manager; POST requires Idempotency-Key) ---

  payments: (params?: PaymentListParams) =>
    api.get<Paginated<Payment>>('/payments/', { params }).then((r) => r.data),

  recordPayment: (
    data: { invoice: number; amount: string; payment_method: PaymentMethod; reference?: string },
    idempotencyKey: string,
  ) =>
    api
      .post<Payment & { invoice_detail: Invoice }>('/payments/', data, {
        headers: idempotencyHeader(idempotencyKey),
      })
      .then((r) => r.data),

  // --- Cashier shifts (Secretary + Manager; open/close are DB-guarded, no key) ---

  cashierShifts: (params?: CashierShiftListParams) =>
    api.get<Paginated<CashierShift>>('/cashier-shifts/', { params }).then((r) => r.data),

  currentShift: () =>
    api.get<CashierShift | null>('/cashier-shifts/current/').then((r) => r.data),

  openShift: (data?: { till_id?: string; opening_float?: string }) =>
    api.post<CashierShift>('/cashier-shifts/open/', data ?? {}).then((r) => r.data),

  closeShift: (id: number, data: { counted_amount: string; reason_code?: string; notes?: string }) =>
    api.post<CashierShift>(`/cashier-shifts/${id}/close/`, data).then((r) => r.data),

  // --- Cash movements (Secretary + Manager; POST requires Idempotency-Key) ---

  cashMovements: (params?: CashMovementListParams) =>
    api.get<Paginated<CashMovement>>('/cash-movements/', { params }).then((r) => r.data),

  recordCashMovement: (
    data: { shift: number; movement_type: CashMovementType; amount: string; reason: string },
    idempotencyKey: string,
  ) =>
    api
      .post<CashMovement>('/cash-movements/', data, { headers: idempotencyHeader(idempotencyKey) })
      .then((r) => r.data),

  // --- Pending checkout (encounter-based DRAFT invoicing, Secretary +
  // Manager; issue/resolve-pricing need no Idempotency-Key — see
  // Backend/apps/billing/views.py InvoiceViewSet.issue /
  // InvoiceItemViewSet.resolve_pricing, both confirmed replay-safe /
  // one-way without one) ---

  pendingCheckoutQueue: (params?: PendingCheckoutListParams) =>
    api.get<Paginated<PendingCheckoutRow>>('/invoices/pending-checkout/', { params }).then((r) => r.data),

  // 200 + null body when nothing is pending for this encounter — never a 404.
  pendingBillForEncounter: (encounterId: number) =>
    api.get<DraftInvoice | null>(`/encounters/${encounterId}/pending-bill/`).then((r) => r.data),

  issueInvoice: (invoiceId: number) =>
    api.post<Invoice>(`/invoices/${invoiceId}/issue/`).then((r) => r.data),

  resolveItemPricing: (itemId: number, data: { unit_price: string }) =>
    api.post<InvoiceItem>(`/invoice-items/${itemId}/resolve-pricing/`, data).then((r) => r.data),
}
