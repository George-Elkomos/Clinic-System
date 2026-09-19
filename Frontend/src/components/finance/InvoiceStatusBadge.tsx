import { useTranslation } from 'react-i18next'

import type { InvoiceStatus } from '../../services/types'

// Mirrors the Tailwind pill styling + shared `status.*` i18n keys already
// used (independently, each with its own copy) by InvoiceViewer/
// BillingDeskPage/MyInvoicesPage. Kept Finance-local rather than importing
// from those page files — the Finance module doesn't couple back into the
// shipped Billing screens — but reuses the exact same palette so an invoice
// looks identical whichever screen it's viewed from.
const INVOICE_STATUS_BADGE: Record<InvoiceStatus, string> = {
  ISSUED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PAID: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PARTIALLY_PAID: 'bg-amber-50 text-amber-700 border-amber-200',
  VOID: 'bg-slate-100 text-slate-500 border-slate-200',
  CANCELLED: 'bg-rose-50 text-rose-700 border-rose-200',
  DRAFT: 'bg-slate-100 text-slate-500 border-slate-200',
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const { t } = useTranslation()
  return (
    <span
      className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-xs font-bold ${
        INVOICE_STATUS_BADGE[status] ?? INVOICE_STATUS_BADGE.DRAFT
      }`}
    >
      {t(`status.${status}`)}
    </span>
  )
}
