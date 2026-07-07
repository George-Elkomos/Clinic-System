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
import { formatDate, formatDateTime } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { labOrdersApi } from '../../services/labOrders.api'
import type { LabOrderSummary, SampleType } from '../../services/types'

type LabQueueTab = 'ORDERED' | 'SAMPLE_COLLECTED' | 'PROCESSING'

const QUEUE_TABS: LabQueueTab[] = ['ORDERED', 'SAMPLE_COLLECTED', 'PROCESSING']

const SAMPLE_TYPES: SampleType[] = [
  'SERUM', 'WHOLE_BLOOD', 'URINE', 'CSF', 'SWAB', 'STOOL', 'OTHER',
]

const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  padding: 'var(--space-3) 0',
  borderBottom: '1px solid var(--border)',
  flexWrap: 'wrap',
  gap: 'var(--space-3)',
}

// ---------- Collect Sample Modal ----------
interface CollectModalProps {
  order: LabOrderSummary
  onClose: () => void
  onConfirm: (sampleType: SampleType, notes: string) => void
  loading: boolean
}

function CollectSampleModal({ order, onClose, onConfirm, loading }: CollectModalProps) {
  const { t } = useTranslation()
  const [sampleType, setSampleType] = useState<SampleType>('SERUM')
  const [notes, setNotes] = useState('')

  const OVERLAY: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
  }
  const DIALOG: React.CSSProperties = {
    background: 'var(--surface)', borderRadius: 'var(--radius)',
    padding: 'var(--space-6)', width: 360, maxWidth: '95vw',
    boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
  }

  const sampleTypeKey = (st: SampleType) => {
    const map: Record<SampleType, string> = {
      SERUM: 'sampleTypeSerum', WHOLE_BLOOD: 'sampleTypeWholeBlood',
      URINE: 'sampleTypeUrine', CSF: 'sampleTypeCSF',
      SWAB: 'sampleTypeSwab', STOOL: 'sampleTypeStool', OTHER: 'sampleTypeOther',
    }
    return map[st]
  }

  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={DIALOG} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 var(--space-4)' }}>
          {t('lab.collectSampleTitle')} — {order.order_number}
        </h3>
        <p style={{ margin: '0 0 var(--space-2)', color: 'var(--text-muted)', fontSize: 'var(--font-small)' }}>
          {order.patient_name}
        </p>

        <label style={{ display: 'block', marginBottom: 'var(--space-4)' }}>
          <span style={{ fontSize: 'var(--font-small)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
            {t('lab.sampleType')} *
          </span>
          <select
            value={sampleType}
            onChange={(e) => setSampleType(e.target.value as SampleType)}
            style={{
              width: '100%', padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text)', fontSize: 'var(--font-base)',
            }}
          >
            {SAMPLE_TYPES.map((st) => (
              <option key={st} value={st}>{t(`lab.${sampleTypeKey(st)}`)}</option>
            ))}
          </select>
        </label>

        <label style={{ display: 'block', marginBottom: 'var(--space-5)' }}>
          <span style={{ fontSize: 'var(--font-small)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
            {t('lab.sampleNotes')}
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            style={{
              width: '100%', padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)', resize: 'vertical',
              background: 'var(--surface)', color: 'var(--text)',
              fontFamily: 'inherit', fontSize: 'var(--font-base)', boxSizing: 'border-box',
            }}
          />
        </label>

        <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            {t('common.cancel')}
          </Button>
          <Button loading={loading} onClick={() => onConfirm(sampleType, notes)}>
            {t('lab.collectSample')}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------- Collection status strip ----------
function SampleStatus({ order, language, t }: {
  order: LabOrderSummary
  language: string
  t: (key: string) => string
}) {
  const sc = order.sample_collection
  if (!sc) return null

  const dot = (filled: boolean) => (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: filled ? 'var(--success)' : 'var(--border)',
      marginRight: 4,
    }} />
  )

  return (
    <div style={{ fontSize: 'var(--font-xs, 0.75rem)', color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.6 }}>
      <div>
        <span style={{
          fontFamily: 'monospace', fontWeight: 700,
          color: 'var(--primary)', marginRight: 8,
        }}>
          {sc.sample_id}
        </span>
        <span style={{
          background: 'var(--border)', borderRadius: 4, padding: '1px 6px',
          fontSize: '0.7rem', textTransform: 'uppercase',
        }}>
          {sc.sample_type.replace('_', ' ')}
        </span>
      </div>
      <div>
        {dot(true)}
        {t('lab.collectedAt')}: {formatDateTime(sc.collected_at, language)}
      </div>
      {sc.sent_to_lab_at && (
        <div>
          {dot(true)}
          {t('lab.sentAt')}: {formatDateTime(sc.sent_to_lab_at, language)}
        </div>
      )}
      {sc.received_at_lab && (
        <div>
          {dot(true)}
          {t('lab.receivedAt')}: {formatDateTime(sc.received_at_lab, language)}
        </div>
      )}
    </div>
  )
}

// ---------- Main page ----------
export function SampleCollectionPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { showToast } = useToast()
  const qc = useQueryClient()
  const [tab, setTab] = useState<LabQueueTab>('ORDERED')
  const [collectingOrder, setCollectingOrder] = useState<LabOrderSummary | null>(null)

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

  const invalidate = () => qc.invalidateQueries({ queryKey: ['lab-orders'] })

  const collectMut = useMutation({
    mutationFn: ({ id, sampleType, notes }: { id: number; sampleType: SampleType; notes: string }) =>
      labOrdersApi.collectSample(id, { sample_type: sampleType, notes }),
    onSuccess: () => {
      showToast(t('lab.sampleCollected'), 'success')
      setCollectingOrder(null)
      invalidate()
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const sendMut = useMutation({
    mutationFn: (id: number) => labOrdersApi.sendToLab(id),
    onSuccess: () => {
      showToast(t('lab.sentToLab'), 'success')
      invalidate()
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const receiveMut = useMutation({
    mutationFn: (id: number) => labOrdersApi.receiveAtLab(id),
    onSuccess: () => {
      showToast(t('lab.receivedAtLab'), 'success')
      invalidate()
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const tabMeta: Record<LabQueueTab, { orders: typeof orderedData; isLoading: boolean }> = {
    ORDERED:          { orders: orderedData,    isLoading: loadingOrdered },
    SAMPLE_COLLECTED: { orders: collectedData,  isLoading: loadingCollected },
    PROCESSING:       { orders: processingData, isLoading: loadingProcessing },
  }

  const count = (status: LabQueueTab) => tabMeta[status].orders?.results?.length ?? 0
  const { orders, isLoading } = {
    orders: tabMeta[tab].orders?.results ?? [],
    isLoading: tabMeta[tab].isLoading,
  }

  const openLabelInNewTab = async (id: number) => {
    try {
      const html = await labOrdersApi.fetchSampleLabel(id)
      const blob = new Blob([html], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      const tab = window.open(url, '_blank')
      // Revoke the blob URL after the tab has had time to load and print.
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      if (!tab) showToast('Allow pop-ups to print the label.', 'error')
    } catch (err) {
      showToast(errorMessage(err), 'error')
    }
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
              {/* Left: order info + specimen status */}
              <div style={{ flex: 1 }}>
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
                <SampleStatus order={order} language={language} t={t as (k: string) => string} />
              </div>

              {/* Right: action buttons */}
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                {tab === 'ORDERED' && (
                  <Button
                    loading={collectMut.isPending && collectMut.variables?.id === order.id}
                    disabled={collectMut.isPending}
                    onClick={() => setCollectingOrder(order)}
                  >
                    {t('lab.collectSample')}
                  </Button>
                )}

                {tab === 'SAMPLE_COLLECTED' && (
                  <>
                    {order.sample_collection && (
                      <Button
                        variant="secondary"
                        onClick={() => openLabelInNewTab(order.id)}
                        title={t('lab.printLabel')}
                      >
                        {t('lab.printLabel')}
                      </Button>
                    )}
                    <Button
                      loading={sendMut.isPending && sendMut.variables === order.id}
                      disabled={sendMut.isPending}
                      onClick={() => sendMut.mutate(order.id)}
                    >
                      {t('lab.sendToLab')}
                    </Button>
                  </>
                )}

                {tab === 'PROCESSING' && (
                  <>
                    {order.sample_collection && (
                      <Button
                        variant="secondary"
                        onClick={() => openLabelInNewTab(order.id)}
                        title={t('lab.printLabel')}
                      >
                        {t('lab.printLabel')}
                      </Button>
                    )}
                    {order.sample_collection && !order.sample_collection.received_at_lab && (
                      <Button
                        variant="secondary"
                        loading={receiveMut.isPending && receiveMut.variables === order.id}
                        disabled={receiveMut.isPending}
                        onClick={() => receiveMut.mutate(order.id)}
                      >
                        {t('lab.receiveAtLab')}
                      </Button>
                    )}
                    <Link to={`/secretary/lab/${order.id}`}>
                      <Button>{t('lab.enterResults')}</Button>
                    </Link>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </Card>

      {/* Collect Sample Modal */}
      {collectingOrder && (
        <CollectSampleModal
          order={collectingOrder}
          onClose={() => setCollectingOrder(null)}
          loading={collectMut.isPending}
          onConfirm={(sampleType, notes) =>
            collectMut.mutate({ id: collectingOrder.id, sampleType, notes })
          }
        />
      )}
    </div>
  )
}
