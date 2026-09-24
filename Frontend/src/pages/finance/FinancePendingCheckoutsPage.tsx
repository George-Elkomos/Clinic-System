import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { BidiText } from '../../components/primitives/BidiText'
import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { CenteredSpinner, Spinner } from '../../components/primitives/Spinner'
import { useLanguage } from '../../hooks/useLanguage'
import { formatCurrency, formatDateTime } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { financeApi } from '../../services/finance.api'
import { financeKeys } from '../../services/financeQueryKeys'

const PAGE_SIZE = 20

function EmptyState() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-100 bg-white px-6 py-16 text-center shadow-sm">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
        <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
      </div>
      <div className="text-base font-bold text-slate-800">{t('finance.pendingCheckout.empty')}</div>
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

function PricingStatus({ needsPricingCount }: { needsPricingCount: number }) {
  const { t } = useTranslation()
  if (needsPricingCount === 0) {
    return (
      <span className="inline-flex w-fit items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
        {t('finance.pendingCheckout.pricingReady')}
      </span>
    )
  }
  return (
    <span className="inline-flex w-fit items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
      {t('finance.pendingCheckout.pricingNeeded', { count: needsPricingCount })}
    </span>
  )
}

const TH = 'patient-text-overline px-3 py-2 text-start'
const TH_END = 'patient-text-overline px-3 py-2 text-end'
const TD = 'px-3 py-2.5'

export function FinancePendingCheckoutsPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const [page, setPage] = useState(1)

  const params = { page, page_size: PAGE_SIZE }

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: financeKeys.pendingCheckoutList(params),
    queryFn: () => financeApi.pendingCheckoutQueue(params),
    placeholderData: keepPreviousData,
  })

  const rows = data?.results ?? []
  const totalPages = data ? Math.max(1, Math.ceil(data.count / PAGE_SIZE)) : 1

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[{ label: t('finance.pendingCheckout.title') }]} />
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>
            {t('finance.pendingCheckout.title')}
          </h1>
          {isFetching && !isLoading && <Spinner size={16} />}
        </div>
        <p className="mt-1 patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>
          {t('finance.pendingCheckout.subtitle')}
        </p>
      </div>

      {isLoading ? (
        <CenteredSpinner />
      ) : isError ? (
        <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-[#F3F4F6] bg-white shadow-sm">
            <table className="w-full min-w-[800px] border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-slate-100">
                  <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('finance.columns.patient')}</th>
                  <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('finance.columns.doctor')}</th>
                  <th className={TH_END} style={{ color: 'var(--text-muted)' }}>{t('finance.columns.total')}</th>
                  <th className={TH_END} style={{ color: 'var(--text-muted)' }}>{t('finance.pendingCheckout.items')}</th>
                  <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('finance.pendingCheckout.pricing')}</th>
                  <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('finance.pendingCheckout.waitingSince')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100">
                    <td className={TD} style={{ color: 'var(--text-primary)' }}>
                      <BidiText>{row.patient_name}</BidiText>
                    </td>
                    <td className={TD} style={{ color: 'var(--text-secondary)' }}>
                      <BidiText>{row.doctor_name ?? t('common.none')}</BidiText>
                    </td>
                    <td className={`${TD} text-end font-semibold`} style={{ color: 'var(--text-primary)' }}>
                      <BidiText>{formatCurrency(row.total, language)}</BidiText>
                    </td>
                    <td className={`${TD} text-end`} style={{ color: 'var(--text-secondary)' }}>{row.item_count}</td>
                    <td className={TD}>
                      <PricingStatus needsPricingCount={row.needs_pricing_count} />
                    </td>
                    <td className={TD} style={{ color: 'var(--text-muted)' }}>
                      <BidiText dir="ltr">{formatDateTime(row.created_at, language)}</BidiText>
                    </td>
                    <td className={TD}>
                      <Link
                        to={`/finance/pending-checkout/${row.encounter}`}
                        className="inline-flex items-center justify-center rounded-xl border border-[#0D9488]/30 bg-[#0D9488]/5 px-3 py-1.5 text-xs font-semibold text-[#0D9488] transition-colors hover:bg-[#0D9488]/10"
                      >
                        {t('finance.pendingCheckout.review')}
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
