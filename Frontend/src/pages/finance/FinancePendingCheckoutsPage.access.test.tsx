import '../../i18n'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { AuthContext } from '../../context/AuthContext'
import { LanguageContext } from '../../context/LanguageContext'
import { RoleRoute } from '../../routes/RoleRoute'
import type { Role, User } from '../../services/types'
import { FinancePendingCheckoutsPage } from './FinancePendingCheckoutsPage'

vi.mock('../../services/finance.api', () => ({
  financeApi: {
    pendingCheckoutQueue: vi.fn().mockResolvedValue({ count: 0, next: null, previous: null, results: [] }),
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
        children: [{ path: 'pending-checkout', element: <FinancePendingCheckoutsPage /> }],
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
          <RouterProvider router={buildRouter('/finance/pending-checkout')} />
        </AuthContext.Provider>
      </LanguageContext.Provider>
    </QueryClientProvider>,
  )
}

describe('Finance route access (/finance/pending-checkout)', () => {
  it.each(['SECRETARY', 'MANAGER'] as const)('lets %s reach the Pending Checkouts queue', async (role) => {
    renderAsRole(role)
    expect(await screen.findByRole('heading', { name: 'Pending Checkouts' })).toBeInTheDocument()
  })

  it.each(['PATIENT', 'DOCTOR'] as const)('redirects %s away from Finance to their own home', async (role) => {
    renderAsRole(role)
    expect(await screen.findByText(`${role === 'PATIENT' ? 'Patient' : 'Doctor'} Home`)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Pending Checkouts' })).not.toBeInTheDocument()
  })
})
