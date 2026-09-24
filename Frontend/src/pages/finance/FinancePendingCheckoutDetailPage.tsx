import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileQuestion } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { BidiText } from '../../components/primitives/BidiText'
import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { useConfirm } from '../../components/primitives/ConfirmDialog'
import { CenteredSpinner, Spinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { useLanguage } from '../../hooks/useLanguage'
import { formatCurrency } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { financeApi } from '../../services/finance.api'
import { financeKeys } from '../../services/financeQueryKeys'
import type { InvoiceItem } from '../../services/types'

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const TH = 'patient-text-overline px-2 py-2 text-start'
const TH_END = 'patient-text-overline px-2 py-2 text-end'
const TD = 'px-2 py-2.5'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm'
const BTN_SECONDARY_SM = 'inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-60'

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="patient-text-overline" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className="mt-0.5 patient-text-body font-semibold" style={{ color: 'var(--text-primary)' }}>
        <BidiText>{value}</BidiText>
      </div>
    </div>
  )
}

function NotFoundState() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-slate-100 bg-white px-6 py-16 text-center shadow-sm">
      <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
        <FileQuestion className="h-7 w-7" aria-hidden="true" />
      </div>
      <p className="patient-text-body font-semibold text-slate-800">{t('finance.pendingCheckout.notFound')}</p>
      <p className="text-xs text-slate-400">{t('finance.pendingCheckout.notFoundHint')}</p>
      <Link
        to="/finance/pending-checkout"
        className="mt-3 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all sm:text-sm"
      >
        {t('finance.pendingCheckout.backToQueue')}
      </Link>
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-rose-100 bg-rose-50/60 px-6 py-16 text-center">
      <p className="patient-text-body font-semibold text-rose-700">{t('finance.loadError')}</p>
      <p className="text-xs text-rose-500">{message}</p>
      <button type="button" onClick={onRetry} className={BTN_PRIMARY}>{t('common.retry')}</button>
    </div>
  )
}

function ItemPricingCell({
  item,
  isResolving,
  onStartResolve,
  onCancelResolve,
  onSubmitResolve,
  isSubmitting,
}: {
  item: InvoiceItem
  isResolving: boolean
  onStartResolve: () => void
  onCancelResolve: () => void
  onSubmitResolve: (unitPrice: string) => void
  isSubmitting: boolean
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState(item.unit_price)

  if (!item.needs_pricing) return null

  if (!isResolving) {
    return (
      <button type="button" onClick={onStartResolve} className={BTN_SECONDARY_SM}>
        {t('finance.pendingCheckout.resolvePricing')}
      </button>
    )
  }

  // A plain button (not a <form onSubmit>) — this cell lives inside a <table>
  // row and there's no need for Enter-to-submit form semantics here; Enter
  // is still supported explicitly via onKeyDown below.
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmitResolve(value)
        }}
        aria-label={t('finance.pendingCheckout.unitPriceLabel')}
        className="patient-field w-24 py-1 text-xs"
        autoFocus
      />
      <button type="button" onClick={() => onSubmitResolve(value)} disabled={isSubmitting} className={BTN_SECONDARY_SM}>
        {isSubmitting ? <Spinner size={12} /> : t('common.save')}
      </button>
      <button type="button" onClick={onCancelResolve} disabled={isSubmitting} className={BTN_SECONDARY_SM}>
        {t('common.cancel')}
      </button>
    </div>
  )
}

export function FinancePendingCheckoutDetailPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { encounterId } = useParams<{ encounterId: string }>()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { showToast } = useToast()
  const qc = useQueryClient()
  const money = (v: string) => formatCurrency(v, language)

  const encId = Number(encounterId)
  const [resolvingItemId, setResolvingItemId] = useState<number | null>(null)

  const { data: draft, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: financeKeys.pendingBill(encId),
    queryFn: () => financeApi.pendingBillForEncounter(encId),
    enabled: Number.isFinite(encId),
  })

  const resolvePricing = useMutation({
    mutationFn: ({ itemId, unitPrice }: { itemId: number; unitPrice: string }) =>
      financeApi.resolveItemPricing(itemId, { unit_price: unitPrice }),
    onSuccess: () => {
      showToast(t('finance.pendingCheckout.resolveSuccess'), 'success')
      setResolvingItemId(null)
      qc.invalidateQueries({ queryKey: financeKeys.pendingBill(encId) })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const issueInvoice = useMutation({
    mutationFn: () => financeApi.issueInvoice(draft!.id),
    onSuccess: (issued) => {
      showToast(t('finance.pendingCheckout.issueSuccess'), 'success')
      qc.invalidateQueries({ queryKey: financeKeys.pendingCheckout() })
      navigate(`/finance/invoices/${issued.id}`)
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const handleIssue = async () => {
    const ok = await confirm({
      title: t('finance.pendingCheckout.issueConfirmTitle'),
      message: t('finance.pendingCheckout.issueConfirmMessage'),
      confirmLabel: t('finance.pendingCheckout.issueInvoice'),
    })
    if (ok) issueInvoice.mutate()
  }

  const notFound = !Number.isFinite(encId) || (!isLoading && !isError && draft === null)
  const hasItems = (draft?.items.length ?? 0) > 0
  const needsPricing = (draft?.needs_pricing_count ?? 0) > 0
  const issueDisabledReason = !hasItems
    ? t('finance.pendingCheckout.issueDisabledEmpty')
    : needsPricing
      ? t('finance.pendingCheckout.issueDisabledNeedsPricing')
      : undefined

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs
          trail={[
            { label: t('finance.pendingCheckout.title'), to: '/finance/pending-checkout' },
            { label: draft?.patient_name ?? t('common.loading') },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>
            {t('finance.pendingCheckout.draftLabel')}
          </h1>
          {isFetching && !isLoading && <Spinner size={16} />}
        </div>
        <Link to="/finance/pending-checkout" className="mt-1 inline-block text-xs font-semibold text-[#0D9488] hover:underline">
          {`‹ ${t('finance.pendingCheckout.backToQueue')}`}
        </Link>
      </div>

      {isLoading ? (
        <CenteredSpinner />
      ) : notFound ? (
        <NotFoundState />
      ) : isError || !draft ? (
        <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />
      ) : (
        <>
          <div className={CARD}>
            <div className="mb-4">
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                {t('finance.pendingCheckout.draftLabel')}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <MetaField label={t('billing.patient')} value={draft.patient_name} />
              <MetaField label={t('billing.doctor')} value={draft.doctor_name ?? t('common.none')} />
              <MetaField label={t('finance.pendingCheckout.encounterLabel')} value={`#${draft.encounter}`} />
            </div>
          </div>

          <div className={CARD}>
            <h2 className="mb-3 patient-text-card-title" style={{ color: 'var(--text-primary)' }}>
              {t('finance.detail.lineItemsTitle')}
            </h2>
            {draft.items.length === 0 ? (
              <p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>
                {t('finance.detail.noLineItems')}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b-2 border-slate-100">
                      <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('billing.description')}</th>
                      <th className={TH_END} style={{ color: 'var(--text-muted)' }}>{t('billing.quantity')}</th>
                      <th className={TH_END} style={{ color: 'var(--text-muted)' }}>{t('billing.unitPrice')}</th>
                      <th className={TH_END} style={{ color: 'var(--text-muted)' }}>{t('billing.lineTotal')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {draft.items.map((item) => (
                      <tr key={item.id} className="border-b border-slate-100">
                        <td className={TD} style={{ color: 'var(--text-primary)' }}>
                          <div className="flex flex-wrap items-center gap-2">
                            <BidiText>{item.description}</BidiText>
                            {item.needs_pricing ? (
                              <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700">
                                {t('finance.pendingCheckout.needsPricingBadge')}
                              </span>
                            ) : item.unit_price === '0.00' ? (
                              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500">
                                {t('finance.pendingCheckout.configuredFreeBadge')}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className={`${TD} text-end`} style={{ color: 'var(--text-secondary)' }}>{item.quantity}</td>
                        <td className={`${TD} text-end`} style={{ color: 'var(--text-secondary)' }}>
                          <BidiText>{money(item.unit_price)}</BidiText>
                        </td>
                        <td className={`${TD} text-end font-semibold`} style={{ color: 'var(--text-primary)' }}>
                          <BidiText>{money(item.line_total)}</BidiText>
                        </td>
                        <td className={TD}>
                          <ItemPricingCell
                            item={item}
                            isResolving={resolvingItemId === item.id}
                            onStartResolve={() => setResolvingItemId(item.id)}
                            onCancelResolve={() => setResolvingItemId(null)}
                            onSubmitResolve={(unitPrice) => resolvePricing.mutate({ itemId: item.id, unitPrice })}
                            isSubmitting={resolvePricing.isPending && resolvePricing.variables?.itemId === item.id}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className={CARD}>
            <h2 className="mb-3 patient-text-card-title" style={{ color: 'var(--text-primary)' }}>
              {t('finance.detail.summaryTitle')}
            </h2>
            <div className="ms-auto grid max-w-sm grid-cols-2 gap-y-1.5">
              <span className="text-sm text-slate-500">{t('billing.subtotal')}</span>
              <span className="text-end text-sm font-medium text-slate-700"><BidiText>{money(draft.subtotal)}</BidiText></span>
              <span className="text-sm text-slate-500">{t('billing.discount')}</span>
              <span className="text-end text-sm font-medium text-slate-700"><BidiText>{`−${money(draft.discount)}`}</BidiText></span>
              <span className="border-t border-slate-200 pt-1.5 text-sm font-bold text-slate-800">{t('billing.total')}</span>
              <span className="border-t border-slate-200 pt-1.5 text-end text-sm font-bold text-slate-800"><BidiText>{money(draft.total)}</BidiText></span>
              <span className="text-sm font-bold text-[#0D9488]">{t('billing.balance')}</span>
              <span className="text-end text-sm font-bold text-[#0D9488]"><BidiText>{money(draft.balance)}</BidiText></span>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              disabled={!!issueDisabledReason || issueInvoice.isPending}
              title={issueDisabledReason}
              onClick={handleIssue}
              className={BTN_PRIMARY}
            >
              {issueInvoice.isPending && <Spinner size={14} />}
              {t('finance.pendingCheckout.issueInvoice')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
