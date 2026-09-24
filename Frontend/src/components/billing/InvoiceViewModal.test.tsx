import '../../i18n'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LanguageContext } from '../../context/LanguageContext'
import { billingApi } from '../../services/billing.api'
import { InvoiceViewModal } from './InvoiceViewModal'

vi.mock('../../services/billing.api', () => ({
  billingApi: { invoice: vi.fn() },
}))

const invoiceMock = vi.mocked(billingApi.invoice)

function renderModal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <LanguageContext.Provider value={{ language: 'en', dir: 'ltr', setLanguage: vi.fn() }}>
        <InvoiceViewModal invoiceId={42} onClose={vi.fn()} />
      </LanguageContext.Provider>
    </QueryClientProvider>,
  )
}

describe('InvoiceViewModal', () => {
  it('shows a loading state before the response arrives', () => {
    invoiceMock.mockReturnValue(new Promise(() => {}))
    renderModal()

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows a real error state instead of spinning forever on a failed fetch', async () => {
    invoiceMock.mockRejectedValue(new Error('network down'))
    renderModal()

    expect(await screen.findByText("We couldn't load this invoice.")).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('lets the user retry after a failure', async () => {
    invoiceMock.mockRejectedValueOnce(new Error('network down'))
    renderModal()

    expect(await screen.findByText("We couldn't load this invoice.")).toBeInTheDocument()

    invoiceMock.mockResolvedValueOnce({
      id: 42, number: 'INV-00042', patient: 1, patient_name: 'Omar Hassan', doctor: null, doctor_name: null,
      invoice_date: '2026-01-15', due_date: null, status: 'ISSUED', subtotal: '50.00', discount: '0.00',
      total: '50.00', paid_amount: '0.00', credited_amount: '0.00', refunded_amount: '0.00', balance: '50.00',
      currency: 'EGP', notes: '', items: [], payments: [],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('INV-00042')).toBeInTheDocument()
  })
})
