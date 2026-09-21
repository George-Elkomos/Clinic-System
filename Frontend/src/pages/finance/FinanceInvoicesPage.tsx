import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { InvoiceStatusBadge } from '../../components/finance/InvoiceStatusBadge'
import { AsyncCombobox, type ComboOption } from '../../components/primitives/AsyncCombobox'
import { BidiText } from '../../components/primitives/BidiText'
import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { FormField } from '../../components/primitives/FormField'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner, Spinner } from '../../components/primitives/Spinner'
import { useLanguage } from '../../hooks/useLanguage'
import { formatCurrency, formatDate } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { appointmentsApi } from '../../services/appointments.api'
import { financeApi } from '../../services/finance.api'
import { financeKeys } from '../../services/financeQueryKeys'
import type { InvoiceStatus } from '../../services/types'

const PAGE_SIZE = 20

const STATUS_OPTIONS: InvoiceStatus[] = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED', 'VOID']

// PatientSummary.id is the PatientProfile pk (used by Appointment.patient);
// Invoice.patient is a FK straight to the User (Backend/apps/billing/models.py)
// — the same shape as the queryset scoping in InvoiceViewSet.get_queryset
// (`qs.filter(patient=user)`). So the filter must send `user_id`, not `id`,
// even though other pickers in the app (e.g. the booking pages) correctly use
// `id` for their own FK target. Getting this wrong wouldn't error — it would
// silently filter by the wrong person's id.
const patientFetcher = (query: string): Promise<ComboOption[]> =>
  appointmentsApi.patients(query || undefined).then((results) =>
    results.map((pt) => ({
      value: pt.user_id,
      label: pt.full_name || pt.email || String(pt.user_id),
    })),
  )

function EmptyInvoicesState({ filtered, onClear }: { filtered: boolean; onClear: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-100 bg-white px-6 py-16 text-center shadow-sm">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0D9488]/10 text-[#0D9488]">
        <FileText className="h-7 w-7" aria-hidden="true" />
      </div>
      <div className="text-base font-bold text-slate-800">
        {filtered ? t('finance.noInvoicesFiltered') : t('billing.noInvoices')}
      </div>
      {filtered && (
        <button
          type="button"
          onClick={onClear}
          className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 sm:text-sm"
        >
          {t('finance.filters.clearFilters')}
        </button>
      )}
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-rose-100 bg-rose-50/60 px-6 py-16 text-center">
      <p className="patient-text-body font-semibold text-rose-700">{t('finance.loadError')}</p>
      <p className="text-xs text-rose-500">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all sm:text-sm"
      >
        {t('common.retry')}
      </button>
    </div>
  )
}

const TH = 'patient-text-overline px-3 py-2 text-start'
const TH_END = 'patient-text-overline px-3 py-2 text-end'
const TD = 'px-3 py-2.5'

export function FinanceInvoicesPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()

  const [status, setStatus] = useState<InvoiceStatus | ''>('')
  const [patient, setPatient] = useState<ComboOption | null>(null)
  const [page, setPage] = useState(1)

  const params = {
    status: status || undefined,
    patient: patient?.value,
    page,
    page_size: PAGE_SIZE,
  }

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: financeKeys.invoiceList(params),
    queryFn: () => financeApi.invoices(params),
    placeholderData: keepPreviousData,
  })

  const rows = data?.results ?? []
  const totalPages = data ? Math.max(1, Math.ceil(data.count / PAGE_SIZE)) : 1
  const filtersActive = status !== '' || patient !== null

  const updateStatus = (value: InvoiceStatus | '') => {
    setStatus(value)
    setPage(1)
  }
  const updatePatient = (opt: ComboOption | null) => {
    setPatient(opt)
    setPage(1)
  }
  const clearFilters = () => {
    setStatus('')
    setPatient(null)
    setPage(1)
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[{ label: t('finance.invoicesTitle') }]} />
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>
            {t('finance.invoicesTitle')}
          </h1>
          {isFetching && !isLoading && <Spinner size={16} />}
        </div>
      </div>

      <div className="grid gap-4 rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:grid-cols-2 sm:p-6">
        <FormField label={t('finance.filters.statusLabel')}>
          {(p) => (
            <Select
              id={p.id}
              placeholder={t('finance.filters.statusAll')}
              options={STATUS_OPTIONS.map((s) => ({ value: s, label: t(`status.${s}`) }))}
              value={status}
              onChange={(v) => updateStatus((Array.isArray(v) ? '' : v) as InvoiceStatus | '')}
            />
          )}
        </FormField>

        <FormField label={t('finance.filters.patientLabel')}>
          {(p) => (
            <AsyncCombobox
              id={p.id}
              value={patient}
              onChange={updatePatient}
              fetcher={patientFetcher}
              placeholder={t('finance.filters.patientPlaceholder')}
            />
          )}
        </FormField>
      </div>

      {isLoading ? (
        <CenteredSpinner />
      ) : isError ? (
        <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        <EmptyInvoicesState filtered={filtersActive} onClear={clearFilters} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-[#F3F4F6] bg-white shadow-sm">
            <table className="w-full min-w-[960px] border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-slate-100">
                  <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('finance.columns.number')}</th>
                  <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('finance.columns.date')}</th>
                  <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('finance.columns.patient')}</th>
                  <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('finance.columns.doctor')}</th>
                  <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('finance.columns.status')}</th>
                  <th className={TH_END} style={{ color: 'var(--text-muted)' }}>{t('finance.columns.total')}</th>
                  <th className={TH_END} style={{ color: 'var(--text-muted)' }}>{t('finance.columns.paid')}</th>
                  <th className={TH_END} style={{ color: 'var(--text-muted)' }}>{t('finance.columns.credited')}</th>
                  <th className={TH_END} style={{ color: 'var(--text-muted)' }}>{t('finance.columns.refunded')}</th>
                  <th className={TH_END} style={{ color: 'var(--text-muted)' }}>{t('finance.columns.balance')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((inv) => (
                  <tr key={inv.id} className="border-b border-slate-100">
                    <td className={`${TD} font-semibold`} style={{ color: 'var(--text-primary)' }}>
                      <BidiText>{inv.number}</BidiText>
                    </td>
                    <td className={TD} style={{ color: 'var(--text-muted)' }}>
                      <BidiText dir="ltr">{formatDate(inv.invoice_date, language)}</BidiText>
                    </td>
                    <td className={TD} style={{ color: 'var(--text-primary)' }}>
                      <BidiText>{inv.patient_name}</BidiText>
                    </td>
                    <td className={TD} style={{ color: 'var(--text-secondary)' }}>
                      <BidiText>{inv.doctor_name ?? t('common.none')}</BidiText>
                    </td>
                    <td className={TD}>
                      <InvoiceStatusBadge status={inv.status} />
                    </td>
                    <td className={`${TD} text-end font-semibold`} style={{ color: 'var(--text-primary)' }}>
                      <BidiText>{formatCurrency(inv.total, language)}</BidiText>
                    </td>
                    <td className={`${TD} text-end`} style={{ color: 'var(--text-secondary)' }}>
                      <BidiText>{formatCurrency(inv.paid_amount, language)}</BidiText>
                    </td>
                    <td className={`${TD} text-end`} style={{ color: 'var(--text-secondary)' }}>
                      <BidiText>{formatCurrency(inv.credited_amount, language)}</BidiText>
                    </td>
                    <td className={`${TD} text-end`} style={{ color: 'var(--text-secondary)' }}>
                      <BidiText>{formatCurrency(inv.refunded_amount, language)}</BidiText>
                    </td>
                    <td
                      className={`${TD} text-end font-semibold`}
                      style={{ color: inv.status === 'PAID' || inv.status === 'VOID' ? 'var(--text-primary)' : '#e11d48' }}
                    >
                      <BidiText>{formatCurrency(inv.balance, language)}</BidiText>
                    </td>
                    <td className={TD}>
                      <Link
                        to={`/finance/invoices/${inv.id}`}
                        className="inline-flex items-center justify-center rounded-xl border border-[#0D9488]/30 bg-[#0D9488]/5 px-3 py-1.5 text-xs font-semibold text-[#0D9488] transition-colors hover:bg-[#0D9488]/10"
                      >
                        {t('billing.viewInvoice')}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
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
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40"
              >
                ›
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
