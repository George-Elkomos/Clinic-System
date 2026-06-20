import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Button } from '../../components/primitives/Button'
import { Card } from '../../components/primitives/Card'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { StatusBadge } from '../../components/primitives/StatusBadge'
import { useToast } from '../../components/primitives/Toast'
import { CriticalResultsWidget } from '../../components/lab/CriticalResultsWidget'
import { PendingOrdersWidget } from '../../components/lab/PendingOrdersWidget'
import { RecentLabsWidget } from '../../components/lab/RecentLabsWidget'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { labOrdersApi } from '../../services/labOrders.api'

type LabQueueTab = 'ORDERED' | 'SAMPLE_COLLECTED' | 'PROCESSING'

const QUEUE_TABS: LabQueueTab[] = ['ORDERED', 'SAMPLE_COLLECTED', 'PROCESSING']

const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: 'var(--space-3) 0',
  borderBottom: '1px solid var(--border)',
  flexWrap: 'wrap',
  gap: 'var(--space-3)',
}

export function SampleCollectionPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { showToast } = useToast()
  const qc = useQueryClient()
  const [tab, setTab] = useState<LabQueueTab>('ORDERED')

  // Run all three queues simultaneously so tab badge counts are always accurate.
  const { data: orderedData, isLoading: loadingOrdered } = useQuery({
    queryKey: ['lab-orders', { status: 'ORDERED' }],
    queryFn: () => labOrdersApi.list({ status: 'ORDERED', page_size: 50 }),
    staleTime: 15_000,
    retry: 1,
  })
  const { data: collectedData, isLoading: loadingCollected } = useQuery({
    queryKey: ['lab-orders', { status: 'SAMPLE_COLLECTED' }],
    queryFn: () => labOrdersApi.list({ status: 'SAMPLE_COLLECTED', page_size: 50 }),
    staleTime: 15_000,
    retry: 1,
  })
  const { data: processingData, isLoading: loadingProcessing } = useQuery({
    queryKey: ['lab-orders', { status: 'PROCESSING' }],
    queryFn: () => labOrdersApi.list({ status: 'PROCESSING', page_size: 50 }),
    staleTime: 15_000,
    retry: 1,
  })

  const collectMut = useMutation({
    mutationFn: (id: number) => labOrdersApi.collectSample(id),
    onSuccess: () => {
      showToast(t('lab.sampleCollected'), 'success')
      qc.invalidateQueries({ queryKey: ['lab-orders'] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const processMut = useMutation({
    mutationFn: (id: number) => labOrdersApi.startProcessing(id),
    onSuccess: () => {
      showToast(t('lab.processingStarted'), 'success')
      qc.invalidateQueries({ queryKey: ['lab-orders'] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const tabMeta: Record<LabQueueTab, { orders: typeof orderedData; isLoading: boolean }> = {
    ORDERED:          { orders: orderedData,   isLoading: loadingOrdered },
    SAMPLE_COLLECTED: { orders: collectedData, isLoading: loadingCollected },
    PROCESSING:       { orders: processingData, isLoading: loadingProcessing },
  }

  const count = (status: LabQueueTab) => tabMeta[status].orders?.results?.length ?? 0
  const { orders, isLoading } = {
    orders: tabMeta[tab].orders?.results ?? [],
    isLoading: tabMeta[tab].isLoading,
  }

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('nav.labOrders') }]} />
      <h1>{t('nav.labOrders')}</h1>

      <div className="lab-kpi-row">
        <PendingOrdersWidget />
        <CriticalResultsWidget />
      </div>

      <RecentLabsWidget />

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 'var(--space-4)', borderBottom: '2px solid var(--border)' }}>
        {QUEUE_TABS.map((tabId) => {
          const n = count(tabId)
          return (
            <button
              key={tabId}
              onClick={() => setTab(tabId)}
              style={{
                padding: 'var(--space-2) var(--space-5)',
                border: 'none',
                borderBottom: tab === tabId ? '2px solid var(--primary)' : '2px solid transparent',
                background: 'none',
                cursor: 'pointer',
                fontWeight: tab === tabId ? 700 : 400,
                color: tab === tabId ? 'var(--primary)' : 'var(--text-muted)',
                marginBottom: '-2px',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
              }}
            >
              {t(`status.${tabId}`)}
              {n > 0 && (
                <span
                  className="badge badge--active"
                  style={{ fontSize: 'var(--font-small)', padding: '2px 6px', minHeight: 'unset' }}
                >
                  {n}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <Card>
        {isLoading ? (
          <CenteredSpinner />
        ) : orders.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>{t('lab.noOrders')}</p>
        ) : (
          orders.map((order) => (
            <div key={order.id} style={ROW_STYLE}>
              <div>
                <Link
                  to={`/secretary/lab/${order.id}`}
                  style={{ fontWeight: 600, color: 'var(--primary)' }}
                >
                  {order.order_number}
                </Link>
                <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-small)' }}>
                  {order.patient_name} · {formatDate(order.created_at, language)}
                </div>
                {order.priority !== 'ROUTINE' && (
                  <StatusBadge status={order.priority} ns="status" />
                )}
              </div>

              {tab === 'ORDERED' && (
                <Button
                  loading={collectMut.isPending && collectMut.variables === order.id}
                  disabled={collectMut.isPending}
                  onClick={() => collectMut.mutate(order.id)}
                >
                  {t('lab.collectSample')}
                </Button>
              )}

              {tab === 'SAMPLE_COLLECTED' && (
                <Button
                  loading={processMut.isPending && processMut.variables === order.id}
                  disabled={processMut.isPending}
                  onClick={() => processMut.mutate(order.id)}
                >
                  {t('lab.startProcessing')}
                </Button>
              )}

              {tab === 'PROCESSING' && (
                <Link to={`/secretary/lab/${order.id}`}>
                  <Button variant="secondary">{t('lab.enterResults')}</Button>
                </Link>
              )}
            </div>
          ))
        )}
      </Card>
    </div>
  )
}
