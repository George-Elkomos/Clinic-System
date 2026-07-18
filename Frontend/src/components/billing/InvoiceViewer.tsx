import { useTranslation } from 'react-i18next'

import { useLanguage } from '../../hooks/useLanguage'
import { formatDate, formatDateTime, formatMoney } from '../../lib/format'
import type { Invoice } from '../../services/types'
import { StatusBadge } from '../primitives/StatusBadge'

/** Printable invoice sheet: header, line items, totals, payment history. */
export function InvoiceViewer({ invoice }: { invoice: Invoice }) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const money = (v: string) => formatMoney(v, invoice.currency, language)

  return (
    <div className="invoice-viewer">
      <div className="invoice-viewer__header">
        <div>
          <div className="invoice-viewer__clinic">{t('app.name')}</div>
          <div style={{ color: 'var(--text-muted)' }}>{t('billing.invoiceTitle')}</div>
        </div>
        <div>
          <div className="invoice-viewer__number">{invoice.number}</div>
          <StatusBadge status={invoice.status} />
        </div>
      </div>

      <dl className="invoice-viewer__meta">
        <div>
          <dt>{t('billing.patient')}</dt>
          <dd>{invoice.patient_name}</dd>
        </div>
        <div>
          <dt>{t('billing.doctor')}</dt>
          <dd>{invoice.doctor_name ?? '—'}</dd>
        </div>
        <div>
          <dt>{t('billing.invoiceDate')}</dt>
          <dd>{formatDate(invoice.invoice_date, language)}</dd>
        </div>
        <div>
          <dt>{t('billing.dueDate')}</dt>
          <dd>{invoice.due_date ? formatDate(invoice.due_date, language) : '—'}</dd>
        </div>
      </dl>

      <table className="invoice-viewer__table">
        <thead>
          <tr>
            <th>{t('billing.description')}</th>
            <th className="num">{t('billing.quantity')}</th>
            <th className="num">{t('billing.unitPrice')}</th>
            <th className="num">{t('billing.lineTotal')}</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item) => (
            <tr key={item.id}>
              <td dir="auto">{item.description}</td>
              <td className="num">{item.quantity}</td>
              <td className="num">{money(item.unit_price)}</td>
              <td className="num">{money(item.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="invoice-viewer__totals">
        <span className="label">{t('billing.subtotal')}</span>
        <span className="value">{money(invoice.subtotal)}</span>
        <span className="label">{t('billing.discount')}</span>
        <span className="value">−{money(invoice.discount)}</span>
        <span className="label grand">{t('billing.total')}</span>
        <span className="value grand">{money(invoice.total)}</span>
        <span className="label">{t('billing.paid')}</span>
        <span className="value">{money(invoice.paid_amount)}</span>
        <span className="label grand">{t('billing.balance')}</span>
        <span className="value grand">{money(invoice.balance)}</span>
      </div>

      {invoice.payments.length > 0 && (
        <div className="invoice-viewer__payments">
          <h3>{t('billing.payments')}</h3>
          <table className="invoice-viewer__table">
            <thead>
              <tr>
                <th>{t('billing.paidAt')}</th>
                <th>{t('billing.method')}</th>
                <th>{t('billing.reference')}</th>
                <th className="num">{t('billing.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {invoice.payments.map((p) => (
                <tr key={p.id}>
                  <td>{formatDateTime(p.paid_at, language)}</td>
                  <td>{t(`billing.methods.${p.payment_method}`)}</td>
                  <td>{p.reference || '—'}</td>
                  <td className="num">{money(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {invoice.notes && <p className="invoice-viewer__footer-note" dir="auto">{invoice.notes}</p>}
    </div>
  )
}
