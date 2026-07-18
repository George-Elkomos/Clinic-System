import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { InvoiceViewer } from '../../components/billing/InvoiceViewer'
import { PaymentFormModal } from '../../components/billing/PaymentFormModal'
import { printInvoice } from '../../components/billing/print'
import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Button } from '../../components/primitives/Button'
import { Card } from '../../components/primitives/Card'
import { Modal } from '../../components/primitives/Modal'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { StatusBadge } from '../../components/primitives/StatusBadge'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate, formatMoney } from '../../lib/format'
import { billingApi } from '../../services/billing.api'
import type { Invoice } from '../../services/types'

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

export function BillingDeskPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
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
    <div>
      <Breadcrumbs trail={[{ label: t('nav.billing') }]} />
      <h1>{t('nav.billing')}</h1>

      <div className="billing-tabs" role="tablist">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={`billing-tabs__tab${tab === key ? ' billing-tabs__tab--active' : ''}`}
            onClick={() => switchTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <CenteredSpinner />
      ) : rows.length === 0 ? (
        <Card><p>{t('billing.noInvoices')}</p></Card>
      ) : (
        <>
          {rows.map((inv) => (
            <Card key={inv.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <div>
                  <h3 style={{ margin: 0 }}>
                    {inv.number} · {inv.patient_name}
                  </h3>
                  <div style={{ color: 'var(--text-muted)' }}>
                    {inv.doctor_name ?? '—'} · {formatDate(inv.invoice_date, language)}
                  </div>
                </div>
                <div className="invoice-row__money">
                  <span>
                    {t('billing.total')}: {formatMoney(inv.total, inv.currency, language)}
                  </span>
                  <span className="invoice-row__balance">
                    {t('billing.balance')}: {formatMoney(inv.balance, inv.currency, language)}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                  <StatusBadge status={inv.status} />
                  <Button variant="secondary" onClick={() => setViewing(inv)}>
                    {t('billing.viewInvoice')}
                  </Button>
                  {PAYABLE.has(inv.status) && (
                    <Button onClick={() => setPaying(inv)}>{t('billing.recordPayment')}</Button>
                  )}
                </div>
              </div>
            </Card>
          ))}

          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', justifyContent: 'center', marginTop: 'var(--space-4)' }}>
              <Button variant="secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>‹</Button>
              <span>{t('common.page')} {page} {t('common.of')} {totalPages}</span>
              <Button variant="secondary" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>›</Button>
            </div>
          )}
        </>
      )}

      {paying && <PaymentFormModal invoice={paying} onClose={() => setPaying(null)} />}

      {viewing && (
        <Modal title={viewing.number} onClose={() => setViewing(null)} wide>
          <InvoiceViewer invoice={viewing} />
          <div className="modal__actions">
            <Button variant="secondary" onClick={() => setViewing(null)}>{t('common.close')}</Button>
            <Button onClick={printInvoice}>{t('billing.printReceipt')}</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
