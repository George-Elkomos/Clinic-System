import { useMemo } from 'react'

import { useAuth } from './useAuth'

export interface FinanceAccess {
  /** Can reach the /finance module at all (route-level gate mirrors this too). */
  canViewFinance: boolean
  canRecordPayment: boolean
  canManageCashierShift: boolean
  canRecordCashMovement: boolean
  canManagePendingCheckout: boolean
  canIssueCreditNote: boolean
  canIssueRefund: boolean
  canCancelInvoice: boolean
  canViewFinanceReports: boolean
}

/**
 * Single choke point for Finance authorization checks. Today every flag is
 * just a role lookup, mirroring the backend split (IsSecretaryOrManager for
 * payments/cashier/cash-movements, IsManager-only for corrections and
 * reports — see docs/financial-design and Backend/apps/billing/permissions.py).
 * There is no dedicated Finance role or granular permission claim yet.
 *
 * Finance components should read capabilities through this hook instead of
 * calling `hasRole(...)` directly, so that if the backend later grows
 * finer-grained Finance permissions (e.g. a cashier-only flag distinct from
 * Secretary), only this hook's internals change — no call site does.
 */
export function useFinanceAccess(): FinanceAccess {
  const { hasRole } = useAuth()

  return useMemo(() => {
    const isFinanceStaff = hasRole('SECRETARY', 'MANAGER')
    const isFinanceManager = hasRole('MANAGER')
    return {
      canViewFinance: isFinanceStaff,
      canRecordPayment: isFinanceStaff,
      canManageCashierShift: isFinanceStaff,
      canRecordCashMovement: isFinanceStaff,
      canManagePendingCheckout: isFinanceStaff,
      canIssueCreditNote: isFinanceManager,
      canIssueRefund: isFinanceManager,
      canCancelInvoice: isFinanceManager,
      canViewFinanceReports: isFinanceManager,
    }
  }, [hasRole])
}
