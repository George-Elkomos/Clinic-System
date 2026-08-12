import { useQuery } from '@tanstack/react-query'
import { FileText, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { InvoiceViewer } from '../../components/billing/InvoiceViewer'
import { PaymentFormModal } from '../../components/billing/PaymentFormModal'
import { printInvoice } from '../../components/billing/print'
import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate, formatMoney } from '../../lib/format'
import { billingApi } from '../../services/billing.api'
import type { Invoice, InvoiceStatus } from '../../services/types'

type Tab = 'all' | 'outstanding' | 'paid'

const PAGE_SIZE = 20
// Comma-separated list matched server-side (see InvoiceFilter on the backend) —
// filtering client-side after one page would silently hide outstanding
// invoices older than the newest 20.
const OUTSTANDING_STATUSES = 'ISSUED,PARTIALLY_PAID'
const PAYABLE = new Set(['ISSUED', 'PARTIALLY_PAID'])

const TAB_STATUS: Record<Tab, string | undefined> = {
  all: undefined,
  outstanding: OUTSTANDING_STATUSES,
  paid: 'PAID',
}

const INVOICE_BADGE: Record<InvoiceStatus, string> = {
  ISSUED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PAID: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PARTIALLY_PAID: 'bg-amber-50 text-amber-700 border-amber-200',
  VOID: 'bg-slate-100 text-slate-500 border-slate-200',
  CANCELLED: 'bg-rose-50 text-rose-700 border-rose-200',
  DRAFT: 'bg-slate-100 text-slate-500 border-slate-200',
}

function InvoiceBadge({ status }: { status: InvoiceStatus }) {
  const { t } = useTranslation()
  return (
    <span className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-xs font-bold ${INVOICE_BADGE[status] ?? INVOICE_BADGE.DRAFT}`}>
      {t(`status.${status}`)}
    </span>
  )
}

function InvoiceRow({ inv, onView, onPay }: { inv: Invoice; onView: () => void; onPay: () => void }) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition-all hover:shadow-md sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-base font-bold text-slate-800">{inv.number} · {inv.patient_name}</div>
        <div className="mt-0.5 text-xs text-slate-400">
          {inv.doctor_name ?? '—'} · {formatDate(inv.invoice_date, language)}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <div className="text-sm font-semibold text-slate-700">
            {t('billing.total')}: {formatMoney(inv.total, inv.currency, language)}
          </div>
          {inv.status !== 'PAID' && (
            <div className="text-xs font-medium text-rose-500">
              {t('billing.balance')}: {formatMoney(inv.balance, inv.currency, language)}
            </div>
          )}
        </div>
        <InvoiceBadge status={inv.status} />
        <button
          type="button"
          onClick={onView}
          className="rounded-xl border border-[#0D9488]/30 bg-[#0D9488]/5 px-4 py-2 text-xs font-semibold text-[#0D9488] transition-colors hover:bg-[#0D9488]/10 sm:text-sm"
        >
          {t('billing.viewInvoice')}
        </button>
        {PAYABLE.has(inv.status) && (
          <button
            type="button"
            onClick={onPay}
            className="rounded-xl bg-[#0D9488] border border-[#0B7A70] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all sm:text-sm"
          >
            {t('billing.recordPayment')}
          </button>
        )}
      </div>
    </div>
  )
}

function EmptyInvoicesState() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-100 bg-white px-6 py-16 text-center shadow-sm">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0D9488]/10 text-[#0D9488]">
        <FileText className="h-7 w-7" aria-hidden="true" />
      </div>
      <div className="text-base font-bold text-slate-800">{t('billing.noInvoices')}</div>
    </div>
  )
}

function InvoiceModal({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/55 p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <h2 className="truncate text-lg font-bold text-[#0D9488]">{invoice.number}</h2>
            <InvoiceBadge status={invoice.status} />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="shrink-0 rounded-lg border-none bg-transparent p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="overflow-y-auto p-5 sm:p-6">
          <InvoiceViewer invoice={invoice} hideStatusBadge />
        </div>
        <div className="mt-4 flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-slate-100 px-6 pt-4 pb-5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border-none bg-slate-100 px-5 py-2.5 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-200"
          >
            {t('common.close')}
          </button>
          <button
            type="button"
            onClick={printInvoice}
            className="rounded-xl bg-[#0D9488] border border-[#0B7A70] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#0B7A70]"
          >
            {t('billing.printReceipt')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function BillingDeskPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('outstanding')
  const [page, setPage] = useState(1)
  const [paying, setPaying] = useState<Invoice | null>(null)
  const [viewing, setViewing] = useState<Invoice | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['invoices', 'desk', tab, page],
    queryFn: () => billingApi.invoices({ status: TAB_STATUS[tab], page, page_size: PAGE_SIZE }),
  })

  const rows = data?.results ?? []
  const totalPages = data ? Math.ceil(data.count / PAGE_SIZE) : 1

  const tabs: { key: Tab; label: string }[] = [
    { key: 'all', label: t('billing.tabAll') },
    { key: 'outstanding', label: t('billing.tabOutstanding') },
    { key: 'paid', label: t('billing.tabPaid') },
  ]

  const switchTab = (key: Tab) => {
    setTab(key)
    setPage(1)
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[{ label: t('nav.billing') }]} />
        <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>{t('nav.billing')}</h1>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => switchTab(key)}
            className={
              tab === key
                ? 'rounded-xl border border-[#0B7A70] bg-[#0D9488] px-4 py-2 text-xs font-semibold text-white shadow-sm sm:text-sm'
                : 'rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 transition-all hover:bg-slate-50 sm:text-sm'
            }
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <CenteredSpinner />
      ) : rows.length === 0 ? (
        <EmptyInvoicesState />
      ) : (
        <>
          {rows.map((inv) => (
            <InvoiceRow key={inv.id} inv={inv} onView={() => setViewing(inv)} onPay={() => setPaying(inv)} />
          ))}

          {totalPages > 1 && (
            <div className="mt-2 flex items-center justify-center gap-3">
              <button
                type="button"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40"
              >
                ‹
              </button>
              <span className="text-xs font-medium text-slate-500">{t('common.page')} {page} {t('common.of')} {totalPages}</span>
              <button
                type="button"
                disabled={page === totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40"
              >
                ›
              </button>
            </div>
          )}
        </>
      )}

      {paying && <PaymentFormModal invoice={paying} onClose={() => setPaying(null)} />}
      {viewing && <InvoiceModal invoice={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}
