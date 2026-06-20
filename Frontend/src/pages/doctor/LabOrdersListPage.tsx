import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Button } from '../../components/primitives/Button'
import { Card } from '../../components/primitives/Card'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { StatusBadge } from '../../components/primitives/StatusBadge'
import { CriticalResultsWidget } from '../../components/lab/CriticalResultsWidget'
import { PendingOrdersWidget } from '../../components/lab/PendingOrdersWidget'
import { useAuth } from '../../hooks/useAuth'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate } from '../../lib/format'
import { labOrdersApi } from '../../services/labOrders.api'
import type { LabOrderStatus } from '../../services/types'

const PAGE_SIZE = 20

const STATUSES: (LabOrderStatus | '')[] = [
  '', 'DRAFT', 'ORDERED', 'SAMPLE_COLLECTED', 'PROCESSING', 'COMPLETED', 'REVIEWED',
]

export function LabOrdersListPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState<LabOrderStatus | ''>('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['lab-orders', { status, page }],
    queryFn: () => labOrdersApi.list({ status: status || undefined, page, page_size: PAGE_SIZE }),
    staleTime: 15_000,
    retry: 1,
  })

  const totalPages = data ? Math.ceil(data.count / PAGE_SIZE) : 1

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('lab.title') }]} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
        <h1 style={{ margin: 0 }}>{t('lab.title')}</h1>
        {user?.role === 'DOCTOR' && (
          <Button onClick={() => navigate('/doctor/lab-orders/new')}>{t('lab.newOrder')}</Button>
        )}
      </div>

      <div className="lab-kpi-row">
        <PendingOrdersWidget />
        <CriticalResultsWidget />
      </div>

      <Card>
        <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
          <div>
            <label style={{ fontWeight: 600, marginBottom: 'var(--space-1)', display: 'block' }}>{t('lab.filterStatus')}</label>
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value as LabOrderStatus | ''); setPage(1) }}
              style={{ minHeight: 'var(--tap-min)', padding: '0 var(--space-3)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s ? t(`status.${s}`) : t('common.none')}</option>
              ))}
            </select>
          </div>
        </div>

        {isLoading ? <CenteredSpinner /> : (data?.results ?? []).length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>{t('lab.noOrders')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-body)' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: 'var(--space-2) var(--space-3)' }}>{t('lab.orderNumber')}</th>
                  <th style={{ textAlign: 'left', padding: 'var(--space-2) var(--space-3)' }}>{t('lab.patient')}</th>
                  <th style={{ textAlign: 'left', padding: 'var(--space-2) var(--space-3)' }}>{t('lab.status')}</th>
                  <th style={{ textAlign: 'left', padding: 'var(--space-2) var(--space-3)' }}>{t('lab.priority')}</th>
                  <th style={{ textAlign: 'left', padding: 'var(--space-2) var(--space-3)' }}>{t('appointments.when')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(data?.results ?? []).map((order) => (
                  <tr key={order.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: 'var(--space-2) var(--space-3)', fontWeight: 600 }}>{order.order_number}</td>
                    <td style={{ padding: 'var(--space-2) var(--space-3)' }}>{order.patient_name}</td>
                    <td style={{ padding: 'var(--space-2) var(--space-3)' }}><StatusBadge status={order.status} /></td>
                    <td style={{ padding: 'var(--space-2) var(--space-3)' }}><StatusBadge status={order.priority} ns="status" /></td>
                    <td style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--text-muted)' }}>
                      {formatDate(order.created_at, language)}
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                      <Link to={`/doctor/lab-orders/${order.id}`} className="btn btn--secondary" style={{ minHeight: 'unset', padding: 'var(--space-1) var(--space-3)' }}>
                        {t('common.actions')}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', justifyContent: 'center', marginTop: 'var(--space-4)' }}>
            <Button variant="secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>‹</Button>
            <span>{t('lab.page')} {page} {t('lab.of')} {totalPages}</span>
            <Button variant="secondary" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>›</Button>
          </div>
        )}
      </Card>
    </div>
  )
}
