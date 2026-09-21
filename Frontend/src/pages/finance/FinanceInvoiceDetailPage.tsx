import { useQuery } from '@tanstack/react-query'
import { FileQuestion } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { InvoiceStatusBadge } from '../../components/finance/InvoiceStatusBadge'
import { BidiText } from '../../components/primitives/BidiText'
import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { CenteredSpinner, Spinner } from '../../components/primitives/Spinner'
import { useFinanceAccess } from '../../hooks/useFinanceAccess'
import { useLanguage } from '../../hooks/useLanguage'
import { formatCurrency, formatDate, formatDateTime } from '../../lib/format'
import { errorMessage, isNotFoundError } from '../../services/apiClient'
import { financeApi } from '../../services/finance.api'
import { financeKeys } from '../../services/financeQueryKeys'

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const TH = 'patient-text-overline px-2 py-2 text-start'
const TH_END = 'patient-text-overline px-2 py-2 text-end'
const TD = 'px-2 py-2.5'

function MetaField({ label, value, dir = 'auto' }: { label: string; value: string; dir?: 'auto' | 'ltr' }) {
  return (
    <div>
      <div className="patient-text-overline" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className="mt-0.5 patient-text-body font-semibold" style={{ color: 'var(--text-primary)' }}>
        <BidiText dir={dir}>{value}</BidiText>
      </div>
    </div>
  )
}

function SummaryRow({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <>
      <span className={emphasis ? 'text-sm font-bold text-slate-800' : 'text-sm text-slate-500'}>{label}</span>
      <span className={emphasis ? 'text-end text-sm font-bold text-slate-800' : 'text-end text-sm font-medium text-slate-700'}>
        <BidiText>{value}</BidiText>
      </span>
    </>
  )
}

function NotFoundState() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-slate-100 bg-white px-6 py-16 text-center shadow-sm">
      <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
        <FileQuestion className="h-7 w-7" aria-hidden="true" />
      </div>
      <p className="patient-text-body font-semibold text-slate-800">{t('finance.detail.notFound')}</p>
      <p className="text-xs text-slate-400">{t('finance.detail.notFoundHint')}</p>
      <Link
        to="/finance/invoices"
        className="mt-3 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all sm:text-sm"
      >
        {t('finance.detail.backToInvoices')}
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

export function FinanceInvoiceDetailPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const access = useFinanceAccess()
  const { id } = useParams<{ id: string }>()
  const invoiceId = Number(id)
  const money = (v: string) => formatCurrency(v, language)

  const { data: invoice, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: financeKeys.invoiceDetail(invoiceId),
    queryFn: () => financeApi.invoice(invoiceId),
    enabled: Number.isFinite(invoiceId),
  })

  const notFound = !Number.isFinite(invoiceId) || (isError && isNotFoundError(error))
  const showCorrections = access.canIssueCreditNote || access.canIssueRefund || access.canCancelInvoice

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs
          trail={[
            { label: t('finance.invoicesTitle'), to: '/finance/invoices' },
            { label: invoice?.number ?? t('common.loading') },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>
            {invoice?.number ?? t('finance.invoicesTitle')}
          </h1>
          {isFetching && !isLoading && <Spinner size={16} />}
        </div>
        <Link
          to="/finance/invoices"
          className="mt-1 inline-block text-xs font-semibold text-[#0D9488] hover:underline"
        >
          {`‹ ${t('finance.detail.backToInvoices')}`}
        </Link>
      </div>

      {isLoading ? (
        <CenteredSpinner />
      ) : notFound ? (
        <NotFoundState />
      ) : isError || !invoice ? (
        <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />
      ) : (
        <>
          {/* Identity */}
          <div className={CARD}>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-lg font-bold text-slate-800"><BidiText>{invoice.number}</BidiText></div>
                <div className="mt-1"><InvoiceStatusBadge status={invoice.status} /></div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <MetaField label={t('billing.patient')} value={invoice.patient_name} />
              <MetaField label={t('billing.doctor')} value={invoice.doctor_name ?? t('common.none')} />
              <MetaField label={t('billing.invoiceDate')} value={formatDate(invoice.invoice_date, language)} dir="ltr" />
              <MetaField
                label={t('billing.dueDate')}
                value={invoice.due_date ? formatDate(invoice.due_date, language) : t('common.none')}
                dir="ltr"
              />
            </div>
          </div>

          {/* Financial summary — every figure below is authoritative from the
              backend (Backend/apps/billing/models.py Invoice properties); the
              frontend never recomputes totals/balance itself. */}
          <div className={CARD}>
            <h2 className="mb-3 patient-text-card-title" style={{ color: 'var(--text-primary)' }}>
              {t('finance.detail.summaryTitle')}
            </h2>
            <div className="ms-auto grid max-w-sm grid-cols-2 gap-y-1.5">
              <SummaryRow label={t('billing.subtotal')} value={money(invoice.subtotal)} />
              <SummaryRow label={t('billing.discount')} value={`−${money(invoice.discount)}`} />
              <SummaryRow label={t('billing.total')} value={money(invoice.total)} emphasis />
              <SummaryRow label={t('billing.paid')} value={money(invoice.paid_amount)} />
              <SummaryRow label={t('finance.columns.credited')} value={money(invoice.credited_amount)} />
              <SummaryRow label={t('finance.columns.refunded')} value={money(invoice.refunded_amount)} />
              <SummaryRow label={t('billing.balance')} value={money(invoice.balance)} emphasis />
            </div>
          </div>

          {/* Line items */}
          <div className={CARD}>
            <h2 className="mb-3 patient-text-card-title" style={{ color: 'var(--text-primary)' }}>
              {t('finance.detail.lineItemsTitle')}
            </h2>
            {invoice.items.length === 0 ? (
              <p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>
                {t('finance.detail.noLineItems')}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b-2 border-slate-100">
                      <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('billing.description')}</th>
                      <th className={TH_END} style={{ color: 'var(--text-muted)' }}>{t('billing.quantity')}</th>
                      <th className={TH_END} style={{ color: 'var(--text-muted)' }}>{t('billing.unitPrice')}</th>
                      <th className={TH_END} style={{ color: 'var(--text-muted)' }}>{t('billing.lineTotal')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.items.map((item) => (
                      <tr key={item.id} className="border-b border-slate-100">
                        <td className={TD} style={{ color: 'var(--text-primary)' }}><BidiText>{item.description}</BidiText></td>
                        <td className={`${TD} text-end`} style={{ color: 'var(--text-secondary)' }}>{item.quantity}</td>
                        <td className={`${TD} text-end`} style={{ color: 'var(--text-secondary)' }}><BidiText>{money(item.unit_price)}</BidiText></td>
                        <td className={`${TD} text-end font-semibold`} style={{ color: 'var(--text-primary)' }}><BidiText>{money(item.line_total)}</BidiText></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Payment history — embedded directly on the invoice response
              (InvoiceSerializer.payments), no separate request needed. */}
          <div className={CARD}>
            <h2 className="mb-3 patient-text-card-title" style={{ color: 'var(--text-primary)' }}>
              {t('finance.detail.paymentsTitle')}
            </h2>
            {invoice.payments.length === 0 ? (
              <p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>
                {t('finance.detail.noPayments')}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b-2 border-slate-100">
                      <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('billing.paidAt')}</th>
                      <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('billing.method')}</th>
                      <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('billing.reference')}</th>
                      <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('finance.detail.receivedBy')}</th>
                      <th className={TH_END} style={{ color: 'var(--text-muted)' }}>{t('billing.amount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.payments.map((p) => (
                      <tr key={p.id} className="border-b border-slate-100">
                        <td className={TD} style={{ color: 'var(--text-secondary)' }}>
                          <BidiText dir="ltr">{formatDateTime(p.paid_at, language)}</BidiText>
                        </td>
                        <td className={TD} style={{ color: 'var(--text-secondary)' }}>{t(`billing.methods.${p.payment_method}`)}</td>
                        <td className={TD} style={{ color: 'var(--text-secondary)' }}>{p.reference || t('common.none')}</td>
                        <td className={TD} style={{ color: 'var(--text-secondary)' }}>{p.received_by_name ?? t('common.none')}</td>
                        <td className={`${TD} text-end font-semibold`} style={{ color: 'var(--text-primary)' }}>
                          <BidiText>{money(p.amount)}</BidiText>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Manager-only corrections — structure only, no mutation wired up
              yet (F3/F4). Secretary never sees this section at all, since
              every action it could hold requires the Manager role. */}
          {showCorrections && (
            <div className={CARD}>
              <h2 className="mb-3 patient-text-card-title" style={{ color: 'var(--text-primary)' }}>
                {t('finance.detail.actionsTitle')}
              </h2>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled
                  title={t('finance.detail.actionsComingSoon')}
                  className="cursor-not-allowed rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-400 sm:text-sm"
                >
                  {t('finance.detail.creditNote')}
                </button>
                <button
                  type="button"
                  disabled
                  title={t('finance.detail.actionsComingSoon')}
                  className="cursor-not-allowed rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-400 sm:text-sm"
                >
                  {t('finance.detail.refund')}
                </button>
                <button
                  type="button"
                  disabled
                  title={t('finance.detail.actionsComingSoon')}
                  className="cursor-not-allowed rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-400 sm:text-sm"
                >
                  {t('finance.detail.cancelInvoice')}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
