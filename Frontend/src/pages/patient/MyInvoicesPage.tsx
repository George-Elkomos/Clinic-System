import { useQuery } from '@tanstack/react-query'
import { FileText, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { InvoiceViewer } from '../../components/billing/InvoiceViewer'
import { printInvoice } from '../../components/billing/print'
import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate, formatMoney } from '../../lib/format'
import { billingApi } from '../../services/billing.api'
import type { Invoice, InvoiceStatus } from '../../services/types'

const PAGE_SIZE = 20

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

function InvoiceRow({ inv, onView }: { inv: Invoice; onView: () => void }) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition-all hover:shadow-md sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-base font-bold text-slate-800">{inv.number}</div>
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
            {t('billing.downloadPdf')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function MyInvoicesPage() {
  const { t } = useTranslation()
  const [viewing, setViewing] = useState<Invoice | null>(null)
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['invoices', 'mine', page],
    queryFn: () => billingApi.invoices({ page, page_size: PAGE_SIZE }),
  })

  const rows = data?.results ?? []
  const totalPages = data ? Math.max(1, Math.ceil(data.count / PAGE_SIZE)) : 1

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('nav.myInvoices') }]} />
      {/* PatientShell already renders this same title (hidden lg:block) in its
          own sticky header — shown only below lg so the two never duplicate. */}
      <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>
        {t('nav.myInvoices')}
      </h1>
      <div className="mt-1 mb-6">
        <p className="text-sm text-slate-500">{t('billing.invoicesSubtitle')}</p>
      </div>

      {isLoading ? (
        <CenteredSpinner />
      ) : rows.length === 0 ? (
        <EmptyInvoicesState />
      ) : (
        <>
          {rows.map((inv) => (
            <InvoiceRow key={inv.id} inv={inv} onView={() => setViewing(inv)} />
          ))}
          {totalPages > 1 && (
            <div className="mt-2 flex items-center justify-center gap-3">
              <button
                type="button"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                aria-label={t('vitals.prevPage')}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40"
              >
                ‹
              </button>
              <span className="text-xs font-medium text-slate-500">
                {t('common.page')} {page} {t('common.of')} {totalPages}
              </span>
              <button
                type="button"
                disabled={page === totalPages}
                onClick={() => setPage((p) => p + 1)}
                aria-label={t('vitals.nextPage')}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40"
              >
                ›
              </button>
            </div>
          )}
        </>
      )}

      {viewing && <InvoiceModal invoice={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}
