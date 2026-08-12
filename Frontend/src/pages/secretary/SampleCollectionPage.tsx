import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, FlaskConical } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { CenteredSpinner, Spinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate, formatDateTime } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { labOrdersApi } from '../../services/labOrders.api'
import type { LabOrderPriority, LabOrderSummary, SampleType } from '../../services/types'

type LabQueueTab = 'ORDERED' | 'SAMPLE_COLLECTED' | 'PROCESSING'

const QUEUE_TABS: LabQueueTab[] = ['ORDERED', 'SAMPLE_COLLECTED', 'PROCESSING']

const SAMPLE_TYPES: SampleType[] = [
  'SERUM', 'WHOLE_BLOOD', 'URINE', 'CSF', 'SWAB', 'STOOL', 'OTHER',
]

const LAB_PRIORITY_BADGE: Record<LabOrderPriority, string> = {
  ROUTINE: 'bg-slate-50 text-slate-500 border-slate-200/60',
  URGENT: 'bg-amber-50 text-amber-700 border-amber-200/60',
  STAT: 'bg-rose-50 text-rose-700 border-rose-200/60',
}
const LAB_STATUS_BADGE: Record<string, string> = {
  DRAFT: 'bg-slate-50 text-slate-500 border-slate-200/60',
  ORDERED: 'bg-amber-50 text-amber-700 border-amber-200/60',
  SAMPLE_COLLECTED: 'bg-sky-50 text-sky-700 border-sky-200/60',
  PROCESSING: 'bg-sky-50 text-sky-700 border-sky-200/60',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  REVIEWED: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
}

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all disabled:opacity-60'
const BTN_SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-60'

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

  const sampleTypeKey = (st: SampleType) => {
    const map: Record<SampleType, string> = {
      SERUM: 'sampleTypeSerum', WHOLE_BLOOD: 'sampleTypeWholeBlood',
      URINE: 'sampleTypeUrine', CSF: 'sampleTypeCSF',
      SWAB: 'sampleTypeSwab', STOOL: 'sampleTypeStool', OTHER: 'sampleTypeOther',
    }
    return map[st]
  }

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/45 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        <h3 className="patient-text-card-title mb-1" style={{ color: 'var(--text-primary)' }}>
          {t('lab.collectSampleTitle')} — {order.order_number}
        </h3>
        <p className="patient-text-body-secondary mb-4" style={{ color: 'var(--text-muted)' }}>{order.patient_name}</p>

        <label className="mb-4 block">
          <span className="patient-text-body mb-1 block font-semibold" style={{ color: 'var(--text-primary)' }}>{t('lab.sampleType')} *</span>
          <select value={sampleType} onChange={(e) => setSampleType(e.target.value as SampleType)} className="patient-field">
            {SAMPLE_TYPES.map((st) => (
              <option key={st} value={st}>{t(`lab.${sampleTypeKey(st)}`)}</option>
            ))}
          </select>
        </label>

        <label className="mb-5 block">
          <span className="patient-text-body mb-1 block font-semibold" style={{ color: 'var(--text-primary)' }}>{t('lab.sampleNotes')}</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="patient-field" />
        </label>

        <div className="flex justify-end gap-3">
          <button type="button" disabled={loading} onClick={onClose} className={BTN_SECONDARY}>{t('common.cancel')}</button>
          <button type="button" disabled={loading} onClick={() => onConfirm(sampleType, notes)} className={BTN_PRIMARY}>
            {loading && <Spinner size={14} />}{t('lab.collectSample')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- Collection status strip ----------
const STATUS_DOT = <span className="me-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500" />

function SampleStatus({ order, language, t }: {
  order: LabOrderSummary
  language: string
  t: (key: string) => string
}) {
  const sc = order.sample_collection
  if (!sc) return null

  return (
    <div className="patient-text-body-secondary mt-1.5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-bold" style={{ color: 'var(--brand-blue-start)' }}>{sc.sample_id}</span>
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
          {sc.sample_type.replace('_', ' ')}
        </span>
      </div>
      <div className="mt-1 flex items-center">{STATUS_DOT} {t('lab.collectedAt')}: {formatDateTime(sc.collected_at, language)}</div>
      {sc.sent_to_lab_at && (
        <div className="mt-0.5 flex items-center">{STATUS_DOT} {t('lab.sentAt')}: {formatDateTime(sc.sent_to_lab_at, language)}</div>
      )}
      {sc.received_at_lab && (
        <div className="mt-0.5 flex items-center">{STATUS_DOT} {t('lab.receivedAt')}: {formatDateTime(sc.received_at_lab, language)}</div>
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

  const { data: pendingOrders } = useQuery({
    queryKey: ['lab-orders', 'pending-count'],
    queryFn: () => labOrdersApi.list({ status: 'ORDERED', page_size: 1 }),
    staleTime: 30_000,
    retry: 1,
  })
  const { data: completedOrders } = useQuery({
    queryKey: ['lab-orders', 'critical-count'],
    queryFn: () => labOrdersApi.list({ status: 'COMPLETED', page_size: 1 }),
    staleTime: 30_000,
    retry: 1,
  })
  const { data: recentLabs } = useQuery({
    queryKey: ['lab-orders', 'recent'],
    queryFn: () => labOrdersApi.list({ page_size: 5 }),
    staleTime: 30_000,
    retry: 1,
  })

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
      const tabWin = window.open(url, '_blank')
      // Revoke the blob URL after the tab has had time to load and print.
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      if (!tabWin) showToast('Allow pop-ups to print the label.', 'error')
    } catch (err) {
      showToast(errorMessage(err), 'error')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[{ label: t('nav.labOrders') }]} />
        <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>{t('nav.labOrders')}</h1>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex items-center justify-between rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm">
          <div>
            <div className="patient-text-body-secondary text-[#94A3B8]">{t('lab.pendingCount')}</div>
            <div className="mt-1 text-2xl font-extrabold" style={{ color: 'var(--brand-teal-start)' }}>{pendingOrders?.count ?? '—'}</div>
          </div>
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full" style={{ background: '#E6F7F7' }}>
            <FlaskConical className="h-6 w-6" style={{ color: 'var(--brand-teal-start)' }} />
          </span>
        </div>
        <div className="flex items-center justify-between rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm">
          <div>
            <div className="patient-text-body-secondary text-[#94A3B8]">{t('lab.criticalCount')}</div>
            <div className="mt-1 text-2xl font-extrabold" style={{ color: '#EF4444' }}>{completedOrders?.count ?? '—'}</div>
          </div>
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full" style={{ background: '#FEF2F2' }}>
            <AlertCircle className="h-6 w-6" style={{ color: '#EF4444' }} />
          </span>
        </div>
      </div>

      <div className={CARD}>
        <h2 className="patient-text-card-title mb-3" style={{ color: 'var(--text-primary)' }}>{t('lab.recentLabs')}</h2>
        {(recentLabs?.results ?? []).length === 0 ? (
          <p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{t('lab.noOrders')}</p>
        ) : (
          <div className="flex flex-col divide-y divide-slate-100">
            {(recentLabs?.results ?? []).map((order) => (
              <div key={order.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <Link to={`/secretary/lab/${order.id}`} className="patient-text-body font-semibold hover:underline" style={{ color: 'var(--brand-blue-start)' }}>
                    {order.order_number}
                  </Link>
                  <div className="patient-text-body-secondary truncate" style={{ color: 'var(--text-secondary)' }}>{order.patient_name}</div>
                </div>
                <span className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${LAB_STATUS_BADGE[order.status] ?? LAB_STATUS_BADGE.DRAFT}`}>
                  {t(`status.${order.status}`)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist">
        {QUEUE_TABS.map((tabId) => {
          const n = count(tabId)
          return (
            <button
              key={tabId}
              role="tab"
              aria-selected={tab === tabId}
              onClick={() => setTab(tabId)}
              className={
                tab === tabId
                  ? 'shrink-0 whitespace-nowrap rounded-xl border border-[#0B7A70] bg-[#0D9488] px-4 py-2 text-xs font-semibold text-white shadow-sm sm:text-sm'
                  : 'shrink-0 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 transition-all hover:bg-slate-50 sm:text-sm'
              }
            >
              {t(`status.${tabId}`)}
              {n > 0 && (
                <span className={`ms-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${tab === tabId ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-500'}`}>
                  {n}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className={CARD}>
        {isLoading ? (
          <CenteredSpinner />
        ) : orders.length === 0 ? (
          <p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{t('lab.noOrders')}</p>
        ) : (
          <div className="flex flex-col divide-y divide-slate-100">
            {orders.map((order) => (
              <div key={order.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
                {/* Left: order info + specimen status */}
                <div className="flex-1">
                  <Link to={`/secretary/lab/${order.id}`} className="patient-text-body font-semibold hover:underline" style={{ color: 'var(--brand-blue-start)' }}>
                    {order.order_number}
                  </Link>
                  <div className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>
                    {order.patient_name} · {formatDate(order.created_at, language)}
                  </div>
                  {order.priority !== 'ROUTINE' && (
                    <span className={`mt-1 inline-block shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${LAB_PRIORITY_BADGE[order.priority] ?? LAB_PRIORITY_BADGE.ROUTINE}`}>
                      {t(`status.${order.priority}`)}
                    </span>
                  )}
                  <SampleStatus order={order} language={language} t={t as (k: string) => string} />
                </div>

                {/* Right: action buttons */}
                <div className="flex flex-wrap items-center gap-2">
                  {tab === 'ORDERED' && (
                    <button
                      type="button"
                      disabled={collectMut.isPending}
                      onClick={() => setCollectingOrder(order)}
                      className={BTN_PRIMARY}
                    >
                      {collectMut.isPending && collectMut.variables?.id === order.id && <Spinner size={14} />}{t('lab.collectSample')}
                    </button>
                  )}

                  {tab === 'SAMPLE_COLLECTED' && (
                    <>
                      {order.sample_collection && (
                        <button type="button" onClick={() => openLabelInNewTab(order.id)} title={t('lab.printLabel')} className={BTN_SECONDARY}>
                          {t('lab.printLabel')}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={sendMut.isPending}
                        onClick={() => sendMut.mutate(order.id)}
                        className={BTN_PRIMARY}
                      >
                        {sendMut.isPending && sendMut.variables === order.id && <Spinner size={14} />}{t('lab.sendToLab')}
                      </button>
                    </>
                  )}

                  {tab === 'PROCESSING' && (
                    <>
                      {order.sample_collection && (
                        <button type="button" onClick={() => openLabelInNewTab(order.id)} title={t('lab.printLabel')} className={BTN_SECONDARY}>
                          {t('lab.printLabel')}
                        </button>
                      )}
                      {order.sample_collection && !order.sample_collection.received_at_lab && (
                        <button
                          type="button"
                          disabled={receiveMut.isPending}
                          onClick={() => receiveMut.mutate(order.id)}
                          className={BTN_SECONDARY}
                        >
                          {receiveMut.isPending && receiveMut.variables === order.id && <Spinner size={14} />}{t('lab.receiveAtLab')}
                        </button>
                      )}
                      <Link to={`/secretary/lab/${order.id}`}>
                        <button type="button" className={BTN_PRIMARY}>{t('lab.enterResults')}</button>
                      </Link>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

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
