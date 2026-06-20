import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Card } from '../../components/primitives/Card'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { StatusBadge } from '../../components/primitives/StatusBadge'
import { LabStatusTimeline } from '../../components/lab/LabStatusTimeline'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate } from '../../lib/format'
import { labOrdersApi } from '../../services/labOrders.api'

export function PatientLabResultsPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const [expanded, setExpanded] = useState<number | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['lab-orders', { patient: 'mine' }],
    queryFn: () => labOrdersApi.list({ page_size: 50 }),
    staleTime: 30_000,
    retry: 1,
  })

  if (isLoading) return <CenteredSpinner />

  const orders = data?.results ?? []

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('nav.labResults') }]} />
      <h1>{t('nav.labResults')}</h1>

      {orders.length === 0 ? (
        <Card><p style={{ color: 'var(--text-muted)' }}>{t('lab.noOrders')}</p></Card>
      ) : (
        orders.map((order) => (
          <Card key={order.id}>
            <div
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
              onClick={() => setExpanded(expanded === order.id ? null : order.id)}
            >
              <div>
                <strong>{order.order_number}</strong>
                <span style={{ color: 'var(--text-muted)', marginInlineStart: 'var(--space-3)' }}>
                  {formatDate(order.created_at, language)}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                <StatusBadge status={order.status} />
                <span>{expanded === order.id ? '▲' : '▼'}</span>
              </div>
            </div>

            {expanded === order.id && (
              <ExpandedOrder orderId={order.id} language={language} t={t} />
            )}
          </Card>
        ))
      )}
    </div>
  )
}

function ExpandedOrder({ orderId, language, t }: { orderId: number; language: string; t: (k: string) => string }) {
  const { data: order, isLoading } = useQuery({
    queryKey: ['lab-orders', orderId],
    queryFn: () => labOrdersApi.get(orderId),
    staleTime: 15_000,
    retry: 1,
  })

  if (isLoading) return <CenteredSpinner />
  if (!order) return null

  return (
    <div style={{ marginTop: 'var(--space-4)' }}>
      <LabStatusTimeline status={order.status} />

      {order.results.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>{t('lab.noResults')}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-body)' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)' }}>
                {[t('lab.testName'), t('lab.resultValue'), t('lab.unit'), t('lab.referenceRange'), t('lab.resultDate')].map((h, i) => (
                  <th key={i} style={{ textAlign: 'left', padding: 'var(--space-2) var(--space-3)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {order.results.map((r) => (
                <tr
                  key={r.id}
                  className={r.is_critical ? 'lab-result-row--critical' : r.is_abnormal ? 'lab-result-row--abnormal' : ''}
                  style={{ borderBottom: '1px solid var(--border)' }}
                >
                  <td style={{ padding: 'var(--space-2) var(--space-3)' }}>{r.test_name}</td>
                  <td style={{ padding: 'var(--space-2) var(--space-3)', fontWeight: 600 }}>{r.result_value}</td>
                  <td style={{ padding: 'var(--space-2) var(--space-3)' }}>{r.unit}</td>
                  <td style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--text-muted)' }}>{r.reference_range}</td>
                  <td style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--text-muted)' }}>{formatDate(r.result_date, language)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
