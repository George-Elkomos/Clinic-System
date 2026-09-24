import { describe, expect, it } from 'vitest'

import { financeKeys } from './financeQueryKeys'

describe('financeKeys', () => {
  it('nests every key under the shared "finance" root', () => {
    expect(financeKeys.invoices()).toEqual(['finance', 'invoices'])
    expect(financeKeys.payments()).toEqual(['finance', 'payments'])
    expect(financeKeys.cashierShifts()).toEqual(['finance', 'cashier-shifts'])
  })

  it('builds list keys that include the params, defaulting to {} when omitted', () => {
    expect(financeKeys.invoiceList({ status: 'ISSUED' })).toEqual([
      'finance',
      'invoices',
      'list',
      { status: 'ISSUED' },
    ])
    expect(financeKeys.invoiceList()).toEqual(['finance', 'invoices', 'list', {}])
  })

  it('builds detail keys scoped to a single id', () => {
    expect(financeKeys.invoiceDetail(42)).toEqual(['finance', 'invoices', 'detail', 42])
  })

  it('gives the current-shift query its own stable key distinct from the shift list', () => {
    expect(financeKeys.currentShift()).toEqual(['finance', 'cashier-shifts', 'current'])
    expect(financeKeys.currentShift()).not.toEqual(financeKeys.cashierShiftList())
  })

  it('scopes pending-checkout keys under their own namespace, bill keyed by encounter id', () => {
    expect(financeKeys.pendingCheckoutList()).toEqual(['finance', 'pending-checkout', 'list', {}])
    expect(financeKeys.pendingBill(7)).toEqual(['finance', 'pending-checkout', 'bill', 7])
    expect(financeKeys.pendingBill(7)).not.toEqual(financeKeys.pendingBill(8))
  })
})
