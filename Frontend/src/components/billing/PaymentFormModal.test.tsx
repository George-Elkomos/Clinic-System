import '../../i18n'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LanguageContext } from '../../context/LanguageContext'
import { billingApi } from '../../services/billing.api'
import type { Invoice, Payment } from '../../services/types'
import { ToastProvider } from '../primitives/Toast'
import { PaymentFormModal } from './PaymentFormModal'

vi.mock('../../services/billing.api', () => ({
  billingApi: { recordPayment: vi.fn() },
}))

const recordPaymentMock = vi.mocked(billingApi.recordPayment)

function buildInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 7,
    number: 'INV-00007',
    patient: 10,
    patient_name: 'Omar Hassan',
    doctor: null,
    doctor_name: null,
    invoice_date: '2026-01-15',
    due_date: null,
    status: 'ISSUED',
    subtotal: '100.00',
    discount: '0.00',
    total: '100.00',
    paid_amount: '0.00',
    credited_amount: '0.00',
    refunded_amount: '0.00',
    balance: '100.00',
    currency: 'EGP',
    notes: '',
    items: [],
    payments: [],
    ...overrides,
  }
}

function buildPaymentResult(invoiceOverrides: Partial<Invoice> = {}): Payment & { invoice_detail: Invoice } {
  return {
    id: 1,
    invoice: 7,
    paid_at: '2026-01-16T10:00:00Z',
    amount: '100.00',
    payment_method: 'CASH',
    reference: '',
    received_by: 3,
    received_by_name: 'Layla Secretary',
    invoice_detail: buildInvoice(invoiceOverrides),
  }
}

function renderModal(invoice = buildInvoice()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <LanguageContext.Provider value={{ language: 'en', dir: 'ltr', setLanguage: vi.fn() }}>
        <ToastProvider>
          <PaymentFormModal invoice={invoice} onClose={onClose} />
        </ToastProvider>
      </LanguageContext.Provider>
    </QueryClientProvider>,
  )
  return { onClose }
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Record Payment' }))
}

function lastKey(): string {
  const call = recordPaymentMock.mock.calls.at(-1)
  if (!call) throw new Error('billingApi.recordPayment was not called yet')
  return call[1]
}

describe('PaymentFormModal idempotency', () => {
  it('sends a header-ready key with every submission and leaves the payload untouched', async () => {
    recordPaymentMock.mockResolvedValue(buildPaymentResult())
    renderModal()

    submit()

    await waitFor(() => expect(recordPaymentMock).toHaveBeenCalledTimes(1))
    const [payload, key] = recordPaymentMock.mock.calls[0]
    expect(payload).toEqual({ invoice: 7, amount: '100.00', payment_method: 'CASH', reference: '' })
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it('reuses the same key when resubmitting an unchanged payment after a failure', async () => {
    recordPaymentMock.mockRejectedValueOnce(new Error('network down'))
    renderModal()

    submit()
    await waitFor(() => expect(recordPaymentMock).toHaveBeenCalledTimes(1))
    const firstKey = lastKey()

    recordPaymentMock.mockResolvedValueOnce(buildPaymentResult())
    submit()
    await waitFor(() => expect(recordPaymentMock).toHaveBeenCalledTimes(2))

    expect(lastKey()).toBe(firstKey)
  })

  it('issues a new key when the payment amount changes', async () => {
    recordPaymentMock.mockRejectedValueOnce(new Error('network down'))
    renderModal()

    submit()
    await waitFor(() => expect(recordPaymentMock).toHaveBeenCalledTimes(1))
    const firstKey = lastKey()

    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '40.00' } })
    recordPaymentMock.mockResolvedValueOnce(buildPaymentResult())
    submit()
    await waitFor(() => expect(recordPaymentMock).toHaveBeenCalledTimes(2))

    expect(lastKey()).not.toBe(firstKey)
  })

  it('issues a new key for a deliberate second payment after a successful submission', async () => {
    recordPaymentMock.mockResolvedValue(buildPaymentResult())
    renderModal()

    submit()
    await waitFor(() => expect(recordPaymentMock).toHaveBeenCalledTimes(1))
    const firstKey = lastKey()

    // Same amount/method/reference as before — a deliberate new payment, not a retry.
    submit()
    await waitFor(() => expect(recordPaymentMock).toHaveBeenCalledTimes(2))

    expect(lastKey()).not.toBe(firstKey)
  })

  it('never embeds the amount, reference, or patient name in the generated key', async () => {
    recordPaymentMock.mockResolvedValue(buildPaymentResult())
    renderModal()

    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '73.50' } })
    fireEvent.change(screen.getByLabelText('Reference'), { target: { value: 'SECRET-REF-42' } })
    submit()

    await waitFor(() => expect(recordPaymentMock).toHaveBeenCalledTimes(1))
    const key = lastKey()

    expect(key).not.toContain('73.50')
    expect(key).not.toContain('SECRET-REF-42')
    expect(key).not.toContain('Omar Hassan')
    expect(key).not.toContain('CASH')
    // A pure crypto.randomUUID() output structurally cannot encode any of the
    // above — this is the strongest guarantee, not just an absence check.
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it('preserves the existing error-toast behavior and keeps the modal open', async () => {
    recordPaymentMock.mockRejectedValueOnce(new Error('network down'))
    const { onClose } = renderModal()

    submit()

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('preserves the existing success-toast behavior and closes the modal', async () => {
    recordPaymentMock.mockResolvedValue(buildPaymentResult({ status: 'PAID' }))
    const { onClose } = renderModal()

    submit()

    expect(await screen.findByText('Invoice fully paid. ✅')).toBeInTheDocument()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })
})
