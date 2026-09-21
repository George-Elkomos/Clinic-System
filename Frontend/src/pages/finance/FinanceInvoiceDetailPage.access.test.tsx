import '../../i18n'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { AuthContext } from '../../context/AuthContext'
import { LanguageContext } from '../../context/LanguageContext'
import { RoleRoute } from '../../routes/RoleRoute'
import type { Invoice, Role, User } from '../../services/types'
import { FinanceInvoiceDetailPage } from './FinanceInvoiceDetailPage'

vi.mock('../../services/finance.api', () => ({
  financeApi: {
    invoice: vi.fn().mockResolvedValue({
      id: 42, number: 'INV-00042', patient: 10, patient_name: 'Omar Hassan',
      doctor: 20, doctor_name: 'Dr. Mona Adly', invoice_date: '2026-01-15', due_date: null,
      status: 'ISSUED', subtotal: '100.00', discount: '0.00', total: '100.00',
      paid_amount: '0.00', credited_amount: '0.00', refunded_amount: '0.00', balance: '100.00',
      currency: 'EGP', notes: '', items: [], payments: [],
    } satisfies Invoice),
    issueCreditNote: vi.fn(),
    issueRefund: vi.fn(),
    cancelInvoice: vi.fn(),
  },
}))

// Mirrors the real /finance route group in routes/router.tsx.
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
        children: [{ path: 'invoices/:id', element: <FinanceInvoiceDetailPage /> }],
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
          <RouterProvider router={buildRouter('/finance/invoices/42')} />
        </AuthContext.Provider>
      </LanguageContext.Provider>
    </QueryClientProvider>,
  )
}

describe('Finance route access (/finance/invoices/:id)', () => {
  it.each(['SECRETARY', 'MANAGER'] as const)('lets %s reach the Invoice Detail page', async (role) => {
    renderAsRole(role)
    expect(await screen.findByText('Omar Hassan')).toBeInTheDocument()
  })

  it.each(['PATIENT', 'DOCTOR'] as const)('redirects %s away from Finance to their own home', async (role) => {
    renderAsRole(role)
    expect(await screen.findByText(`${role === 'PATIENT' ? 'Patient' : 'Doctor'} Home`)).toBeInTheDocument()
    expect(screen.queryByText('Omar Hassan')).not.toBeInTheDocument()
  })
})
