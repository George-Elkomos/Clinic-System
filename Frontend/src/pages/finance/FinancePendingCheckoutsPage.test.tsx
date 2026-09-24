import '../../i18n'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { LanguageContext } from '../../context/LanguageContext'
import { financeApi } from '../../services/finance.api'
import type { Paginated, PendingCheckoutRow } from '../../services/types'
import { FinancePendingCheckoutsPage } from './FinancePendingCheckoutsPage'

vi.mock('../../services/finance.api', () => ({
  financeApi: { pendingCheckoutQueue: vi.fn() },
}))

const queueMock = vi.mocked(financeApi.pendingCheckoutQueue)

function buildRow(overrides: Partial<PendingCheckoutRow> = {}): PendingCheckoutRow {
  return {
    id: 1,
    encounter: 30,
    patient: 10,
    patient_name: 'Omar Hassan',
    doctor: 5,
    doctor_name: 'Dr. Mona Adly',
    status: 'DRAFT',
    total: '100.00',
    currency: 'EGP',
    item_count: 2,
    needs_pricing_count: 0,
    has_needs_pricing: false,
    created_at: '2026-01-15T09:00:00Z',
    ...overrides,
  }
}

function paginated(results: PendingCheckoutRow[], count = results.length): Paginated<PendingCheckoutRow> {
  return { count, next: null, previous: null, results }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <LanguageContext.Provider value={{ language: 'en', dir: 'ltr', setLanguage: vi.fn() }}>
          <FinancePendingCheckoutsPage />
        </LanguageContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

function lastParams() {
  const call = queueMock.mock.calls.at(-1)
  if (!call) throw new Error('financeApi.pendingCheckoutQueue was not called yet')
  const [params] = call
  if (!params) throw new Error('financeApi.pendingCheckoutQueue was called without params')
  return params
}

// No beforeEach(mockReset)/afterEach(clearAllMocks) here — every test below
// sets the mock's behavior explicitly as its first line anyway, and resetting
// it from a beforeEach hook (rather than inline in the test body) triggers an
// unrelated Vitest/React-Query hook-timeout hang specific to this component's
// never-resolving-promise loading test. Confirmed via bisection: identical
// mock state, only the call site (hook vs. test body) differs.
describe('FinancePendingCheckoutsPage', () => {
  it('renders queue rows returned by the Finance API', async () => {
    queueMock.mockResolvedValue(paginated([buildRow({ patient_name: 'Omar Hassan', total: '150.00' })]))
    renderPage()

    expect(await screen.findByText('Omar Hassan')).toBeInTheDocument()
    expect(screen.getByText('Dr. Mona Adly')).toBeInTheDocument()
    expect(screen.getByText('150.00 EGP')).toBeInTheDocument()
  })

  it('shows a loading state before the first response arrives', () => {
    queueMock.mockReturnValue(new Promise(() => {}))
    renderPage()

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows an API error state with a retry action', async () => {
    queueMock.mockRejectedValue(new Error('network down'))
    renderPage()

    expect(await screen.findByText("We couldn't load invoices.")).toBeInTheDocument()

    queueMock.mockResolvedValue(paginated([buildRow()]))
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Omar Hassan')).toBeInTheDocument()
  })

  it('shows a positive empty state when there is nothing pending', async () => {
    queueMock.mockResolvedValue(paginated([]))
    renderPage()

    expect(await screen.findByText('No pending checkouts — front desk is all caught up.')).toBeInTheDocument()
  })

  it('shows a "Ready" pricing badge when nothing needs pricing, and a count badge when it does', async () => {
    queueMock.mockResolvedValue(
      paginated([
        buildRow({ id: 1, patient_name: 'Ready Patient', needs_pricing_count: 0, has_needs_pricing: false }),
        buildRow({ id: 2, patient_name: 'Blocked Patient', needs_pricing_count: 3, has_needs_pricing: true }),
      ]),
    )
    renderPage()

    expect(await screen.findByText('Ready')).toBeInTheDocument()
    expect(screen.getByText('Needs pricing (3)')).toBeInTheDocument()
  })

  it('requests the next backend page when paginating', async () => {
    queueMock.mockResolvedValue(paginated([buildRow()], 45))
    renderPage()
    await screen.findByText('Omar Hassan')

    fireEvent.click(screen.getByRole('button', { name: '›' }))

    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument()
    expect(lastParams().page).toBe(2)
  })

  it('links the Review action to the pending-checkout detail route for that encounter', async () => {
    queueMock.mockResolvedValue(paginated([buildRow({ encounter: 77 })]))
    renderPage()

    const link = await screen.findByRole('link', { name: 'Review' })
    expect(link).toHaveAttribute('href', '/finance/pending-checkout/77')
  })
})
