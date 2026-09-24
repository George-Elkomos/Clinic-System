import '../../i18n'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LanguageContext } from '../../context/LanguageContext'
import { billingApi } from '../../services/billing.api'
import type { AppointmentBilling } from '../../services/types'
import { InvoiceGeneratedModal } from './InvoiceGeneratedModal'

vi.mock('../../services/billing.api', () => ({
  billingApi: { invoice: vi.fn() },
}))

const invoiceMock = vi.mocked(billingApi.invoice)

function buildBilling(overrides: Partial<AppointmentBilling> = {}): AppointmentBilling {
  return {
    invoice_id: null,
    invoice_number: null,
    invoice_total: null,
    free_followup_used: false,
    pending_checkout: false,
    arrears_balance: null,
    ...overrides,
  }
}

function renderModal(billing: AppointmentBilling) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <LanguageContext.Provider value={{ language: 'en', dir: 'ltr', setLanguage: vi.fn() }}>
        <InvoiceGeneratedModal billing={billing} onClose={onClose} />
      </LanguageContext.Provider>
    </QueryClientProvider>,
  )
  return { onClose }
}

describe('InvoiceGeneratedModal', () => {
  it('shows the free-follow-up message and never fetches an invoice', () => {
    renderModal(buildBilling({ free_followup_used: true }))

    expect(screen.getByText('This visit was a free follow-up — no invoice was issued.')).toBeInTheDocument()
    expect(screen.queryByText('View Invoice')).not.toBeInTheDocument()
    expect(screen.queryByText('Print Receipt')).not.toBeInTheDocument()
    expect(invoiceMock).not.toHaveBeenCalled()
  })

  it('shows the pending-checkout message with no View Invoice / Print Receipt / invoice number, and never fetches', () => {
    // invoice_id is populated as a decoy on some legacy-shaped payloads —
    // the modal must key off pending_checkout, not invoice_id, per the
    // normalized backend contract (2026-09-24).
    renderModal(buildBilling({ pending_checkout: true, invoice_id: 99 }))

    expect(screen.getByText('Visit completed. Billing is pending checkout at the front desk.')).toBeInTheDocument()
    expect(screen.queryByText('View Invoice')).not.toBeInTheDocument()
    expect(screen.queryByText('Print Receipt')).not.toBeInTheDocument()
    expect(screen.queryByText(/generated/)).not.toBeInTheDocument()
    expect(invoiceMock).not.toHaveBeenCalled()
  })

  it('shows the real issued-invoice outcome with working View Invoice', () => {
    invoiceMock.mockResolvedValue({
      id: 7, number: 'INV-00007', patient: 1, patient_name: 'Omar Hassan', doctor: null, doctor_name: null,
      invoice_date: '2026-01-15', due_date: null, status: 'ISSUED', subtotal: '100.00', discount: '0.00',
      total: '100.00', paid_amount: '0.00', credited_amount: '0.00', refunded_amount: '0.00', balance: '100.00',
      currency: 'EGP', notes: '', items: [], payments: [],
    })
    renderModal(buildBilling({ invoice_id: 7, invoice_number: 'INV-00007', invoice_total: '100.00' }))

    expect(screen.getByText('Invoice INV-00007 generated — 100.00 EGP.')).toBeInTheDocument()
    expect(screen.getByText('View Invoice')).toBeInTheDocument()
    expect(invoiceMock).not.toHaveBeenCalled() // not fetched until the button is clicked

    fireEvent.click(screen.getByText('View Invoice'))
    expect(invoiceMock).toHaveBeenCalledWith(7)
  })
})
