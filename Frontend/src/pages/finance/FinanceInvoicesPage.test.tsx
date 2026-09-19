import '../../i18n'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LanguageContext } from '../../context/LanguageContext'
import { financeApi } from '../../services/finance.api'
import type { Invoice, Paginated } from '../../services/types'
import { FinanceInvoicesPage } from './FinanceInvoicesPage'

vi.mock('../../services/finance.api', () => ({
  financeApi: { invoices: vi.fn() },
}))

// The patient filter's AsyncCombobox only calls this when opened/typed into —
// none of these tests do that, but the module is still imported, so give it a
// harmless resolved value rather than letting a real axios call fire.
vi.mock('../../services/appointments.api', () => ({
  appointmentsApi: { patients: vi.fn().mockResolvedValue([]) },
}))

const invoicesMock = vi.mocked(financeApi.invoices)

function buildInvoice(overrides: Partial<Invoice>): Invoice {
  return {
    id: 1,
    number: 'INV-00001',
    patient: 10,
    patient_name: 'Omar Hassan',
    doctor: 20,
    doctor_name: 'Dr. Mona Adly',
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

function paginated(results: Invoice[], count = results.length): Paginated<Invoice> {
  return { count, next: null, previous: null, results }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <LanguageContext.Provider value={{ language: 'en', dir: 'ltr', setLanguage: vi.fn() }}>
          <FinanceInvoicesPage />
        </LanguageContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

function lastRequestParams() {
  const call = invoicesMock.mock.calls.at(-1)
  if (!call) throw new Error('financeApi.invoices was not called yet')
  const [params] = call
  if (!params) throw new Error('financeApi.invoices was called without params')
  return params
}

beforeEach(() => {
  invoicesMock.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('FinanceInvoicesPage', () => {
  it('renders invoices returned by the Finance API', async () => {
    invoicesMock.mockResolvedValue(
      paginated([buildInvoice({ id: 1, number: 'INV-00042', patient_name: 'Omar Hassan' })]),
    )

    renderPage()

    expect(await screen.findByText('INV-00042')).toBeInTheDocument()
    expect(screen.getByText('Omar Hassan')).toBeInTheDocument()
  })

  it('shows a loading state before the first response arrives', () => {
    invoicesMock.mockReturnValue(new Promise(() => {})) // never resolves

    renderPage()

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows an empty state when there are no invoices and no filters', async () => {
    invoicesMock.mockResolvedValue(paginated([]))

    renderPage()

    expect(await screen.findByText('No invoices found.')).toBeInTheDocument()
  })

  it('shows an API error state with a retry action', async () => {
    invoicesMock.mockRejectedValue(new Error('network down'))

    renderPage()

    expect(await screen.findByText("We couldn't load invoices.")).toBeInTheDocument()
    const retryButton = screen.getByRole('button', { name: 'Try again' })

    invoicesMock.mockResolvedValue(paginated([buildInvoice({ number: 'INV-00099' })]))
    fireEvent.click(retryButton)

    expect(await screen.findByText('INV-00099')).toBeInTheDocument()
  })

  it('sends the selected status to the API request', async () => {
    invoicesMock.mockResolvedValue(paginated([buildInvoice({})]))
    renderPage()
    await screen.findByText('INV-00001')

    fireEvent.click(screen.getAllByRole('combobox')[0])
    fireEvent.click(screen.getByRole('option', { name: 'Paid' }))

    await waitFor(() => expect(lastRequestParams().status).toBe('PAID'))
  })

  it('resets to page 1 when a filter changes', async () => {
    invoicesMock.mockResolvedValue(paginated([buildInvoice({})], 45)) // 3 pages at page_size 20
    renderPage()
    await screen.findByText('INV-00001')

    fireEvent.click(screen.getByRole('button', { name: '›' }))
    await waitFor(() => expect(lastRequestParams().page).toBe(2))

    fireEvent.click(screen.getAllByRole('combobox')[0])
    fireEvent.click(screen.getByRole('option', { name: 'Issued' }))

    await waitFor(() => expect(lastRequestParams().page).toBe(1))
    expect(lastRequestParams().status).toBe('ISSUED')
  })

  it('requests the next backend page when paginating', async () => {
    invoicesMock.mockResolvedValue(paginated([buildInvoice({})], 45))
    renderPage()
    await screen.findByText('INV-00001')

    fireEvent.click(screen.getByRole('button', { name: '›' }))

    await waitFor(() => expect(lastRequestParams().page).toBe(2))
    expect(lastRequestParams().page_size).toBe(20)
  })
})
