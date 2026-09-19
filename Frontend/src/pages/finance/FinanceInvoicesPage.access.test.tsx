import '../../i18n'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { AuthContext } from '../../context/AuthContext'
import { LanguageContext } from '../../context/LanguageContext'
import { RoleRoute } from '../../routes/RoleRoute'
import type { Role, User } from '../../services/types'
import { FinanceInvoicesPage } from './FinanceInvoicesPage'

vi.mock('../../services/finance.api', () => ({
  financeApi: { invoices: vi.fn().mockResolvedValue({ count: 0, next: null, previous: null, results: [] }) },
}))

vi.mock('../../services/appointments.api', () => ({
  appointmentsApi: { patients: vi.fn().mockResolvedValue([]) },
}))

// Mirrors the real /finance route group in routes/router.tsx (RoleRoute
// roles={['SECRETARY', 'MANAGER']} around FinanceInvoicesPage), minus
// PortalShell's chrome — that's layout, not the access rule under test.
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
        children: [{ path: 'invoices', element: <FinanceInvoicesPage /> }],
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
          <RouterProvider router={buildRouter('/finance/invoices')} />
        </AuthContext.Provider>
      </LanguageContext.Provider>
    </QueryClientProvider>,
  )
}

describe('Finance route access (/finance/invoices)', () => {
  it.each(['SECRETARY', 'MANAGER'] as const)('lets %s reach the Invoice List', async (role) => {
    renderAsRole(role)
    expect(await screen.findByRole('heading', { name: 'Invoices' })).toBeInTheDocument()
  })

  it.each(['PATIENT', 'DOCTOR'] as const)('redirects %s away from Finance to their own home', async (role) => {
    renderAsRole(role)
    expect(await screen.findByText(`${role === 'PATIENT' ? 'Patient' : 'Doctor'} Home`)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Invoices' })).not.toBeInTheDocument()
  })
})
