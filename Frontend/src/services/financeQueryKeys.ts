// Central React Query key factory for the Finance module. Pages should build
// keys through `financeKeys` rather than writing array literals inline, so a
// mutation in one file can invalidate exactly the queries another file reads
// without both having to agree on a literal shape by convention.

type QueryParams = Record<string, unknown> | undefined

export const financeKeys = {
  all: ['finance'] as const,

  invoices: () => [...financeKeys.all, 'invoices'] as const,
  invoiceList: (params?: QueryParams) => [...financeKeys.invoices(), 'list', params ?? {}] as const,
  invoiceDetail: (id: number) => [...financeKeys.invoices(), 'detail', id] as const,

  payments: () => [...financeKeys.all, 'payments'] as const,
  paymentList: (params?: QueryParams) => [...financeKeys.payments(), 'list', params ?? {}] as const,

  cashierShifts: () => [...financeKeys.all, 'cashier-shifts'] as const,
  cashierShiftList: (params?: QueryParams) => [...financeKeys.cashierShifts(), 'list', params ?? {}] as const,
  currentShift: () => [...financeKeys.cashierShifts(), 'current'] as const,

  cashMovements: () => [...financeKeys.all, 'cash-movements'] as const,
  cashMovementList: (params?: QueryParams) => [...financeKeys.cashMovements(), 'list', params ?? {}] as const,

  pendingCheckout: () => [...financeKeys.all, 'pending-checkout'] as const,
  pendingCheckoutList: (params?: QueryParams) => [...financeKeys.pendingCheckout(), 'list', params ?? {}] as const,
  pendingBill: (encounterId: number) => [...financeKeys.pendingCheckout(), 'bill', encounterId] as const,
}
