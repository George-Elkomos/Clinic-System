import '../../i18n'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { AuthContext } from '../../context/AuthContext'
import { ConfirmProvider } from '../../components/primitives/ConfirmDialog'
import { ToastProvider } from '../../components/primitives/Toast'
import { LanguageContext } from '../../context/LanguageContext'
import { RoleRoute } from '../../routes/RoleRoute'
import type { DraftInvoice, Role, User } from '../../services/types'
import { FinancePendingCheckoutDetailPage } from './FinancePendingCheckoutDetailPage'

vi.mock('../../services/finance.api', () => ({
  financeApi: {
    pendingBillForEncounter: vi.fn().mockResolvedValue({
      id: 42, encounter: 30, patient: 10, patient_name: 'Omar Hassan', doctor: 5, doctor_name: 'Dr. Mona Adly',
      status: 'DRAFT', subtotal: '150.00', discount: '0.00', total: '150.00', balance: '150.00', currency: 'EGP',
      notes: '', items: [], needs_pricing_count: 0, created_at: '2026-01-15T09:00:00Z',
    } satisfies DraftInvoice),
    resolveItemPricing: vi.fn(),
    issueInvoice: vi.fn(),
  },
}))

function buildRouter(initialPath: string) {
  return createMemoryRouter(
    [
      { path: '/patient', element: <div>Patient Home</div> },
      { path: '/doctor', element: <div>Doctor Home</div> },
      {
        path: '/finance',
        element: (
          <RoleRoute roles={['SECRETARY', 'MANAGER']}>
            <Outlet />
          </RoleRoute>
        ),
        children: [{ path: 'pending-checkout/:encounterId', element: <FinancePendingCheckoutDetailPage /> }],
      },
    ],
    { initialEntries: [initialPath] },
  )
}

function renderAsRole(role: Role) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const user = { role } as unknown as User

  render(
    <QueryClientProvider client={client}>
      <LanguageContext.Provider value={{ language: 'en', dir: 'ltr', setLanguage: vi.fn() }}>
        <ToastProvider>
          <ConfirmProvider>
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
              <RouterProvider router={buildRouter('/finance/pending-checkout/30')} />
            </AuthContext.Provider>
          </ConfirmProvider>
        </ToastProvider>
      </LanguageContext.Provider>
    </QueryClientProvider>,
  )
}

describe('Finance route access (/finance/pending-checkout/:encounterId)', () => {
  it.each(['SECRETARY', 'MANAGER'] as const)('lets %s reach the Pending Checkout detail', async (role) => {
    renderAsRole(role)
    expect(await screen.findByText('Dr. Mona Adly')).toBeInTheDocument()
  })

  it.each(['PATIENT', 'DOCTOR'] as const)('redirects %s away from Finance to their own home', async (role) => {
    renderAsRole(role)
    expect(await screen.findByText(`${role === 'PATIENT' ? 'Patient' : 'Doctor'} Home`)).toBeInTheDocument()
    expect(screen.queryByText('Dr. Mona Adly')).not.toBeInTheDocument()
  })
})
