import { useTranslation } from 'react-i18next'

import { useLanguage } from '../../hooks/useLanguage'
import { formatCurrency, formatDate, formatDateTime } from '../../lib/format'
import type { Invoice, InvoiceStatus } from '../../services/types'
import { Logo } from '../layout/Logo'
import { BidiText } from '../primitives/BidiText'

const INVOICE_BADGE: Record<InvoiceStatus, string> = {
  ISSUED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PAID: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PARTIALLY_PAID: 'bg-amber-50 text-amber-700 border-amber-200',
  VOID: 'bg-slate-100 text-slate-500 border-slate-200',
  CANCELLED: 'bg-rose-50 text-rose-700 border-rose-200',
  DRAFT: 'bg-slate-100 text-slate-500 border-slate-200',
}

function MetaField({ label, value, dir = 'auto' }: { label: string; value: string; dir?: 'auto' | 'ltr' }) {
  return (
    <div>
      <div className="text-xs font-semibold text-slate-400">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-slate-700"><BidiText dir={dir}>{value}</BidiText></div>
    </div>
  )
}

/** Printable invoice sheet: header, line items, totals, payment history.
 * The outer `invoice-viewer` className is a print-only marker (see billing.css's
 * `body.print-invoice .invoice-viewer` rule) — keep it even though it carries no
 * visual styling of its own here. */
export function InvoiceViewer({
  invoice,
  hideStatusBadge = false,
}: {
  invoice: Invoice
  /** The caller already shows its own status pill next to the invoice number in its
   * modal header (see MyInvoicesPage's InvoiceModal) — set this to avoid showing it twice. */
  hideStatusBadge?: boolean
}) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const money = (v: string) => formatCurrency(v, language)

  return (
    <div className="invoice-viewer">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <Logo className="h-7 w-auto" />
          <div className="mt-1 text-sm text-slate-500">{t('billing.invoiceTitle')}</div>
        </div>
        <div className="text-end">
          <div className="text-lg font-bold text-slate-800">{invoice.number}</div>
          {!hideStatusBadge && (
            <span className={`mt-1 inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold ${INVOICE_BADGE[invoice.status] ?? INVOICE_BADGE.DRAFT}`}>
              {t(`status.${invoice.status}`)}
            </span>
          )}
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetaField label={t('billing.patient')} value={invoice.patient_name} />
        <MetaField label={t('billing.doctor')} value={invoice.doctor_name ?? '—'} />
        <MetaField label={t('billing.invoiceDate')} value={formatDate(invoice.invoice_date, language)} dir="ltr" />
        <MetaField label={t('billing.dueDate')} value={invoice.due_date ? formatDate(invoice.due_date, language) : '—'} dir="ltr" />
      </div>

      <div className="mb-5 overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="px-2 py-2 text-start text-xs font-semibold text-slate-400">{t('billing.description')}</th>
              <th className="px-2 py-2 text-end text-xs font-semibold text-slate-400">{t('billing.quantity')}</th>
              <th className="px-2 py-2 text-end text-xs font-semibold text-slate-400">{t('billing.unitPrice')}</th>
              <th className="px-2 py-2 text-end text-xs font-semibold text-slate-400">{t('billing.lineTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item) => (
              <tr key={item.id} className="border-b border-slate-100">
                <td className="px-2 py-2.5 text-slate-700"><BidiText>{item.description}</BidiText></td>
                <td className="whitespace-nowrap px-2 py-2.5 text-end text-slate-600">{item.quantity}</td>
                <td className="whitespace-nowrap px-2 py-2.5 text-end text-slate-600"><BidiText>{money(item.unit_price)}</BidiText></td>
                <td className="whitespace-nowrap px-2 py-2.5 text-end font-semibold text-slate-800"><BidiText>{money(item.line_total)}</BidiText></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ms-auto grid max-w-xs grid-cols-2 gap-y-1.5">
        <span className="text-sm text-slate-500">{t('billing.subtotal')}</span>
        <span className="text-end text-sm font-medium text-slate-700"><BidiText>{money(invoice.subtotal)}</BidiText></span>
        <span className="text-sm text-slate-500">{t('billing.discount')}</span>
        <span className="text-end text-sm font-medium text-slate-700"><BidiText>{`−${money(invoice.discount)}`}</BidiText></span>
        <span className="border-t border-slate-200 pt-1.5 text-sm font-bold text-slate-800">{t('billing.total')}</span>
        <span className="border-t border-slate-200 pt-1.5 text-end text-sm font-bold text-slate-800"><BidiText>{money(invoice.total)}</BidiText></span>
        <span className="text-sm text-slate-500">{t('billing.paid')}</span>
        <span className="text-end text-sm font-medium text-slate-700"><BidiText>{money(invoice.paid_amount)}</BidiText></span>
        <span className="border-t border-slate-200 pt-1.5 text-sm font-bold text-[#0D9488]">{t('billing.balance')}</span>
        <span className="border-t border-slate-200 pt-1.5 text-end text-sm font-bold text-[#0D9488]"><BidiText>{money(invoice.balance)}</BidiText></span>
      </div>

      {invoice.payments.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-sm font-bold text-slate-800">{t('billing.payments')}</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="px-2 py-2 text-start text-xs font-semibold text-slate-400">{t('billing.paidAt')}</th>
                  <th className="px-2 py-2 text-start text-xs font-semibold text-slate-400">{t('billing.method')}</th>
                  <th className="px-2 py-2 text-start text-xs font-semibold text-slate-400">{t('billing.reference')}</th>
                  <th className="px-2 py-2 text-end text-xs font-semibold text-slate-400">{t('billing.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {invoice.payments.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100">
                    <td className="px-2 py-2.5 text-slate-600"><BidiText dir="ltr">{formatDateTime(p.paid_at, language)}</BidiText></td>
                    <td className="px-2 py-2.5 text-slate-600">{t(`billing.methods.${p.payment_method}`)}</td>
                    <td className="px-2 py-2.5 text-slate-600">{p.reference || '—'}</td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-end font-semibold text-slate-800"><BidiText>{money(p.amount)}</BidiText></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {invoice.notes && <p className="mt-5 text-xs text-slate-400" dir="auto">{invoice.notes}</p>}
    </div>
  )
}
