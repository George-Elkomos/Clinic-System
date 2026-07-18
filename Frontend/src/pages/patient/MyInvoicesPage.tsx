import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { InvoiceViewer } from '../../components/billing/InvoiceViewer'
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

const PAGE_SIZE = 20

export function MyInvoicesPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const [viewing, setViewing] = useState<Invoice | null>(null)
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['invoices', 'mine', page],
    queryFn: () => billingApi.invoices({ page, page_size: PAGE_SIZE }),
  })

  const rows = data?.results ?? []
  const totalPages = data ? Math.ceil(data.count / PAGE_SIZE) : 1

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('nav.myInvoices') }]} />
      <h1>{t('nav.myInvoices')}</h1>

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
                  <h3 style={{ margin: 0 }}>{inv.number}</h3>
                  <div style={{ color: 'var(--text-muted)' }}>
                    {inv.doctor_name ?? '—'} · {formatDate(inv.invoice_date, language)}
                  </div>
                </div>
                <div className="invoice-row__money">
                  <span>
                    {t('billing.total')}: {formatMoney(inv.total, inv.currency, language)}
                  </span>
                  {inv.status !== 'PAID' && (
                    <span className="invoice-row__balance">
                      {t('billing.balance')}: {formatMoney(inv.balance, inv.currency, language)}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                  <StatusBadge status={inv.status} />
                  <Button variant="secondary" onClick={() => setViewing(inv)}>
                    {t('billing.viewInvoice')}
                  </Button>
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

      {viewing && (
        <Modal title={viewing.number} onClose={() => setViewing(null)} wide>
          <InvoiceViewer invoice={viewing} />
          <div className="modal__actions">
            <Button variant="secondary" onClick={() => setViewing(null)}>{t('common.close')}</Button>
            {/* Browser print dialog doubles as the PDF download ("Save as PDF"). */}
            <Button onClick={printInvoice}>{t('billing.downloadPdf')}</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
