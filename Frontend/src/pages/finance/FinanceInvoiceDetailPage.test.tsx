import '../../i18n'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, AxiosHeaders } from 'axios'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { AuthContext } from '../../context/AuthContext'
import { LanguageContext } from '../../context/LanguageContext'
import { financeApi } from '../../services/finance.api'
import type { Invoice, Role, User } from '../../services/types'
import { FinanceInvoiceDetailPage } from './FinanceInvoiceDetailPage'

vi.mock('../../services/finance.api', () => ({
  financeApi: {
    invoice: vi.fn(),
    issueCreditNote: vi.fn(),
    issueRefund: vi.fn(),
    cancelInvoice: vi.fn(),
  },
}))

const invoiceMock = vi.mocked(financeApi.invoice)

function buildInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 42,
    number: 'INV-00042',
    patient: 10,
    patient_name: 'Omar Hassan',
    doctor: 20,
    doctor_name: 'Dr. Mona Adly',
    invoice_date: '2026-01-15',
    due_date: null,
    status: 'PARTIALLY_PAID',
    subtotal: '200.00',
    discount: '20.00',
    total: '180.00',
    paid_amount: '100.00',
    credited_amount: '0.00',
    refunded_amount: '0.00',
    balance: '80.00',
    currency: 'EGP',
    notes: '',
    items: [
      { id: 1, description: 'Consultation', service_item: 5, quantity: 1, unit_price: '150.00', line_total: '150.00', source_type: 'APPOINTMENT', source_id: 1, needs_pricing: false, price_resolved_by: null, price_resolved_by_name: null },
      { id: 2, description: 'Follow-up test', service_item: null, quantity: 2, unit_price: '25.00', line_total: '50.00', source_type: 'LAB_ORDER', source_id: 2, needs_pricing: false, price_resolved_by: null, price_resolved_by_name: null },
    ],
    payments: [
      { id: 1, invoice: 42, paid_at: '2026-01-16T10:00:00Z', amount: '100.00', payment_method: 'CASH', reference: '', received_by: 3, received_by_name: 'Layla Secretary' },
    ],
    ...overrides,
  }
}

function notFoundError(): AxiosError {
  const headers = new AxiosHeaders()
  return new AxiosError('Not Found', '404', undefined, undefined, {
    status: 404,
    statusText: 'Not Found',
    headers,
    config: { headers },
    data: { code: 'not_found', detail: 'Not found.' },
  })
}

function renderDetail(role: Role, invoiceId: number | string = 42) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const user = { role } as unknown as User

  render(
    <MemoryRouter initialEntries={[`/finance/invoices/${invoiceId}`]}>
      <QueryClientProvider client={client}>
        <LanguageContext.Provider value={{ language: 'en', dir: 'ltr', setLanguage: vi.fn() }}>
          <AuthContext.Provider
            value={{
              user,
              status: 'authed',
              login: vi.fn(),
              logout: vi.fn(),
              refreshUser: vi.fn(),
              hasRole: (...roles: Role[]) => roles.includes(role),
            }}
          >
            <Routes>
              <Route path="/finance/invoices/:id" element={<FinanceInvoiceDetailPage />} />
            </Routes>
          </AuthContext.Provider>
        </LanguageContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('FinanceInvoiceDetailPage', () => {
  it('renders the invoice identity and status', async () => {
    invoiceMock.mockResolvedValue(buildInvoice())
    renderDetail('MANAGER')

    // The invoice number appears in the breadcrumb, the <h1>, and the identity
    // card — asserting it's present at all (rather than picking one instance)
    // is the actual behavior worth checking here.
    expect((await screen.findAllByText('INV-00042')).length).toBeGreaterThan(0)
    expect(screen.getByText('Omar Hassan')).toBeInTheDocument()
    expect(screen.getByText('Dr. Mona Adly')).toBeInTheDocument()
    expect(screen.getByText('Partially Paid')).toBeInTheDocument()
  })

  it('shows a loading state before the response arrives', () => {
    invoiceMock.mockReturnValue(new Promise(() => {}))
    renderDetail('MANAGER')

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows an API error state with a retry action', async () => {
    invoiceMock.mockRejectedValue(new Error('network down'))
    renderDetail('MANAGER')

    expect(await screen.findByText("We couldn't load invoices.")).toBeInTheDocument()

    invoiceMock.mockResolvedValue(buildInvoice())
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Omar Hassan')).toBeInTheDocument()
  })

  it('shows a not-found state on a 404 instead of a generic error', async () => {
    invoiceMock.mockRejectedValue(notFoundError())
    renderDetail('MANAGER')

    expect(await screen.findByText('Invoice not found.')).toBeInTheDocument()
    expect(screen.queryByText("We couldn't load invoices.")).not.toBeInTheDocument()
  })

  it('renders every line item with its real fields', async () => {
    invoiceMock.mockResolvedValue(buildInvoice())
    renderDetail('MANAGER')

    expect(await screen.findByText('Consultation')).toBeInTheDocument()
    expect(screen.getByText('Follow-up test')).toBeInTheDocument()
    // The consultation row's unit price and line total are both 150.00 (qty 1),
    // so that figure legitimately renders twice on the page.
    expect(screen.getAllByText('150.00 EGP')).toHaveLength(2)
    expect(screen.getByText('25.00 EGP')).toBeInTheDocument()
    expect(screen.getByText('50.00 EGP')).toBeInTheDocument()
  })

  it('renders the financial summary using the backend-provided values verbatim', async () => {
    invoiceMock.mockResolvedValue(buildInvoice())
    renderDetail('MANAGER')

    await screen.findByText('Omar Hassan')

    // subtotal 200.00, discount -20.00, total 180.00, paid 100.00, balance 80.00 —
    // none of these are recomputed client-side, they're the mock's literal fields.
    expect(screen.getByText('200.00 EGP')).toBeInTheDocument()
    expect(screen.getByText('−20.00 EGP')).toBeInTheDocument()
    expect(screen.getAllByText('180.00 EGP').length).toBeGreaterThan(0)
    expect(screen.getByText('80.00 EGP')).toBeInTheDocument()
  })

  it('renders payment history embedded on the invoice response', async () => {
    invoiceMock.mockResolvedValue(buildInvoice())
    renderDetail('MANAGER')

    await screen.findByText('Omar Hassan')

    expect(screen.getByText('Layla Secretary')).toBeInTheDocument()
    expect(screen.getByText('Cash')).toBeInTheDocument()
  })

  it('shows disabled correction actions for MANAGER', async () => {
    invoiceMock.mockResolvedValue(buildInvoice())
    renderDetail('MANAGER')

    const creditNoteButton = await screen.findByRole('button', { name: 'Issue Credit Note' })
    expect(creditNoteButton).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Issue Refund' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel Invoice' })).toBeDisabled()
  })

  it('never shows correction actions to SECRETARY', async () => {
    invoiceMock.mockResolvedValue(buildInvoice())
    renderDetail('SECRETARY')

    await screen.findByText('Omar Hassan')

    expect(screen.queryByRole('button', { name: 'Issue Credit Note' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Issue Refund' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel Invoice' })).not.toBeInTheDocument()
  })

  it('never calls any correction/mutation endpoint from this page', async () => {
    invoiceMock.mockResolvedValue(buildInvoice())
    renderDetail('MANAGER')

    const creditNoteButton = await screen.findByRole('button', { name: 'Issue Credit Note' })
    fireEvent.click(creditNoteButton)
    fireEvent.click(screen.getByRole('button', { name: 'Issue Refund' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Invoice' }))

    expect(financeApi.issueCreditNote).not.toHaveBeenCalled()
    expect(financeApi.issueRefund).not.toHaveBeenCalled()
    expect(financeApi.cancelInvoice).not.toHaveBeenCalled()
  })
})
