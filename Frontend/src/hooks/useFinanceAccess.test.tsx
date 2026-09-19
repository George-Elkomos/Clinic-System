import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { AuthContext } from '../context/AuthContext'
import type { Role } from '../services/types'
import { useFinanceAccess, type FinanceAccess } from './useFinanceAccess'

// Minimal stand-in for AuthContextValue — useFinanceAccess only reads
// `hasRole`, so the other fields just need to satisfy the provider's type.
function wrapperForRole(role: Role | null) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AuthContext.Provider
        value={{
          user: null,
          status: role ? 'authed' : 'anon',
          login: vi.fn(),
          logout: vi.fn(),
          refreshUser: vi.fn(),
          hasRole: (...roles: Role[]) => !!role && roles.includes(role),
        }}
      >
        {children}
      </AuthContext.Provider>
    )
  }
}

const NO_ACCESS: FinanceAccess = {
  canViewFinance: false,
  canRecordPayment: false,
  canManageCashierShift: false,
  canRecordCashMovement: false,
  canIssueCreditNote: false,
  canIssueRefund: false,
  canCancelInvoice: false,
  canViewFinanceReports: false,
}

function accessFor(role: Role | null): FinanceAccess {
  const { result } = renderHook(() => useFinanceAccess(), { wrapper: wrapperForRole(role) })
  return result.current
}

describe('useFinanceAccess', () => {
  it('gives SECRETARY payment/cashier access but not manager-only actions', () => {
    expect(accessFor('SECRETARY')).toEqual({
      canViewFinance: true,
      canRecordPayment: true,
      canManageCashierShift: true,
      canRecordCashMovement: true,
      canIssueCreditNote: false,
      canIssueRefund: false,
      canCancelInvoice: false,
      canViewFinanceReports: false,
    })
  })

  it('gives MANAGER full finance access, including corrections and reports', () => {
    expect(accessFor('MANAGER')).toEqual({
      canViewFinance: true,
      canRecordPayment: true,
      canManageCashierShift: true,
      canRecordCashMovement: true,
      canIssueCreditNote: true,
      canIssueRefund: true,
      canCancelInvoice: true,
      canViewFinanceReports: true,
    })
  })

  it.each(['PATIENT', 'DOCTOR'] as const)('gives %s no finance capabilities at all', (role) => {
    expect(accessFor(role)).toEqual(NO_ACCESS)
  })

  it('gives an anonymous/no-role session no finance capabilities', () => {
    expect(accessFor(null)).toEqual(NO_ACCESS)
  })
})
