import '../../i18n'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { ConfirmProvider } from '../../components/primitives/ConfirmDialog'
import { ToastProvider } from '../../components/primitives/Toast'
import { LanguageContext } from '../../context/LanguageContext'
import { financeApi } from '../../services/finance.api'
import type { DraftInvoice, InvoiceItem } from '../../services/types'
import { FinancePendingCheckoutDetailPage } from './FinancePendingCheckoutDetailPage'

vi.mock('../../services/finance.api', () => ({
  financeApi: {
    pendingBillForEncounter: vi.fn(),
    resolveItemPricing: vi.fn(),
    issueInvoice: vi.fn(),
  },
}))

const pendingBillMock = vi.mocked(financeApi.pendingBillForEncounter)
const resolveMock = vi.mocked(financeApi.resolveItemPricing)
const issueMock = vi.mocked(financeApi.issueInvoice)

function buildItem(overrides: Partial<InvoiceItem> = {}): InvoiceItem {
  return {
    id: 1,
    description: 'Consultation',
    service_item: 5,
    quantity: 1,
    unit_price: '150.00',
    line_total: '150.00',
    source_type: 'APPOINTMENT',
    source_id: 1,
    needs_pricing: false,
    price_resolved_by: null,
    price_resolved_by_name: null,
    ...overrides,
  }
}

function buildDraft(overrides: Partial<DraftInvoice> = {}): DraftInvoice {
  return {
    id: 42,
    encounter: 30,
    patient: 10,
    patient_name: 'Omar Hassan',
    doctor: 5,
    doctor_name: 'Dr. Mona Adly',
    status: 'DRAFT',
    subtotal: '150.00',
    discount: '0.00',
    total: '150.00',
    balance: '150.00',
    currency: 'EGP',
    notes: '',
    items: [buildItem()],
    needs_pricing_count: 0,
    ...overrides,
    created_at: '2026-01-15T09:00:00Z',
  }
}

function renderDetail(encounterId: number | string = 30) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <MemoryRouter initialEntries={[`/finance/pending-checkout/${encounterId}`]}>
      <QueryClientProvider client={client}>
        <LanguageContext.Provider value={{ language: 'en', dir: 'ltr', setLanguage: vi.fn() }}>
          <ToastProvider>
            <ConfirmProvider>
              <Routes>
                <Route path="/finance/pending-checkout/:encounterId" element={<FinancePendingCheckoutDetailPage />} />
                {/* Stub — proves navigation reached the real Invoice Detail route
                    without pulling in that whole page and its own mocks here. */}
                <Route path="/finance/invoices/:id" element={<div>Issued Invoice Page</div>} />
              </Routes>
            </ConfirmProvider>
          </ToastProvider>
        </LanguageContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('FinancePendingCheckoutDetailPage', () => {
  it('renders the draft identity with no invoice number anywhere', async () => {
    pendingBillMock.mockResolvedValue(buildDraft())
    renderDetail()

    expect((await screen.findAllByText('Omar Hassan')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Draft / Pending Checkout').length).toBeGreaterThan(0)
    expect(screen.queryByText(/INV-/)).not.toBeInTheDocument()
  })

  it('shows a loading state before the response arrives', () => {
    pendingBillMock.mockReturnValue(new Promise(() => {}))
    renderDetail()

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows an API error state with a retry action', async () => {
    pendingBillMock.mockRejectedValue(new Error('network down'))
    renderDetail()

    expect(await screen.findByText("We couldn't load invoices.")).toBeInTheDocument()

    pendingBillMock.mockResolvedValue(buildDraft())
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Dr. Mona Adly')).toBeInTheDocument()
  })

  it('shows a distinct not-found state when nothing is pending for this encounter', async () => {
    pendingBillMock.mockResolvedValue(null)
    renderDetail()

    expect(await screen.findByText('No pending checkout for this encounter.')).toBeInTheDocument()
    expect(screen.queryByText("We couldn't load invoices.")).not.toBeInTheDocument()
  })

  it('renders line items and visually distinguishes needs-pricing from a configured free item', async () => {
    pendingBillMock.mockResolvedValue(
      buildDraft({
        items: [
          buildItem({ id: 1, description: 'Lab test', needs_pricing: true, unit_price: '0.00', line_total: '0.00' }),
          buildItem({ id: 2, description: 'Complimentary consult', needs_pricing: false, unit_price: '0.00', line_total: '0.00' }),
        ],
        needs_pricing_count: 1,
      }),
    )
    renderDetail()

    expect(await screen.findByText('Lab test')).toBeInTheDocument()
    expect(screen.getByText('Complimentary consult')).toBeInTheDocument()
    expect(screen.getByText('Needs Pricing')).toBeInTheDocument()
    expect(screen.getByText('Free (configured)')).toBeInTheDocument()
  })

  it('resolving a price refetches the draft and clears the needs-pricing state', async () => {
    pendingBillMock.mockResolvedValueOnce(
      buildDraft({
        items: [buildItem({ id: 1, description: 'Lab test', needs_pricing: true, unit_price: '0.00', line_total: '0.00' })],
        needs_pricing_count: 1,
        subtotal: '0.00',
        total: '0.00',
        balance: '0.00',
      }),
    )
    renderDetail()

    await screen.findByText('Lab test')
    fireEvent.click(screen.getByRole('button', { name: 'Resolve Pricing' }))
    fireEvent.change(screen.getByLabelText('Unit Price'), { target: { value: '75.00' } })

    resolveMock.mockResolvedValue(buildItem({ id: 1, description: 'Lab test', needs_pricing: false, unit_price: '75.00', line_total: '75.00' }))
    pendingBillMock.mockResolvedValueOnce(
      buildDraft({
        items: [buildItem({ id: 1, description: 'Lab test', needs_pricing: false, unit_price: '75.00', line_total: '75.00' })],
        needs_pricing_count: 0,
        subtotal: '75.00',
        total: '75.00',
        balance: '75.00',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(resolveMock).toHaveBeenCalledWith(1, { unit_price: '75.00' }))
    await waitFor(() => expect(screen.queryByText('Needs Pricing')).not.toBeInTheDocument())
    expect(pendingBillMock).toHaveBeenCalledTimes(2) // initial load + refetch after resolving
  })

  it('surfaces a resolve-pricing failure without crashing', async () => {
    pendingBillMock.mockResolvedValue(
      buildDraft({
        items: [buildItem({ id: 1, description: 'Lab test', needs_pricing: true, unit_price: '0.00', line_total: '0.00' })],
        needs_pricing_count: 1,
      }),
    )
    resolveMock.mockRejectedValue(new Error('rejected'))
    renderDetail()

    await screen.findByText('Lab test')
    fireEvent.click(screen.getByRole('button', { name: 'Resolve Pricing' }))
    fireEvent.change(screen.getByLabelText('Unit Price'), { target: { value: '75.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument()
  })

  it('disables Issue Invoice while any item still needs pricing', async () => {
    pendingBillMock.mockResolvedValue(
      buildDraft({ items: [buildItem({ needs_pricing: true })], needs_pricing_count: 1 }),
    )
    renderDetail()

    expect(await screen.findByRole('button', { name: 'Issue Invoice' })).toBeDisabled()
  })

  it('asks for confirmation and navigates to the existing Invoice Detail page on success', async () => {
    pendingBillMock.mockResolvedValue(buildDraft())
    issueMock.mockResolvedValue({
      id: 99, number: 'INV-00099', patient: 10, patient_name: 'Omar Hassan', doctor: 5, doctor_name: 'Dr. Mona Adly',
      invoice_date: '2026-01-16', due_date: null, status: 'ISSUED', subtotal: '150.00', discount: '0.00',
      total: '150.00', paid_amount: '0.00', credited_amount: '0.00', refunded_amount: '0.00', balance: '150.00',
      currency: 'EGP', notes: '', items: [], payments: [],
    })
    renderDetail()

    const issueButton = await screen.findByRole('button', { name: 'Issue Invoice' })
    expect(issueButton).not.toBeDisabled()
    fireEvent.click(issueButton)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Issue this invoice?')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Issue Invoice' }))

    await waitFor(() => expect(issueMock).toHaveBeenCalledWith(42))
    expect(await screen.findByText('Issued Invoice Page')).toBeInTheDocument()
  })

  it('surfaces an issue-invoice failure without navigating away', async () => {
    pendingBillMock.mockResolvedValue(buildDraft())
    issueMock.mockRejectedValue(new Error('rejected'))
    renderDetail()

    const issueButton = await screen.findByRole('button', { name: 'Issue Invoice' })
    fireEvent.click(issueButton)

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Issue Invoice' }))

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument()
    expect(screen.getByText('Dr. Mona Adly')).toBeInTheDocument()
  })
})
