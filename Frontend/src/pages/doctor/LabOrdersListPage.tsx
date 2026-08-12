import { useQuery } from '@tanstack/react-query'
import { AlertCircle, FlaskConical } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { useAuth } from '../../hooks/useAuth'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate } from '../../lib/format'
import { labOrdersApi } from '../../services/labOrders.api'
import type { LabOrderPriority, LabOrderStatus } from '../../services/types'

const PAGE_SIZE = 20

const STATUSES: (LabOrderStatus | '')[] = [
  '', 'DRAFT', 'ORDERED', 'SAMPLE_COLLECTED', 'PROCESSING', 'COMPLETED', 'REVIEWED',
]

const LAB_STATUS_BADGE: Record<LabOrderStatus, string> = {
  DRAFT: 'bg-slate-50 text-slate-500 border-slate-200/60',
  ORDERED: 'bg-amber-50 text-amber-700 border-amber-200/60',
  SAMPLE_COLLECTED: 'bg-sky-50 text-sky-700 border-sky-200/60',
  PROCESSING: 'bg-sky-50 text-sky-700 border-sky-200/60',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  REVIEWED: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
}
const LAB_PRIORITY_BADGE: Record<LabOrderPriority, string> = {
  ROUTINE: 'bg-slate-50 text-slate-500 border-slate-200/60',
  URGENT: 'bg-amber-50 text-amber-700 border-amber-200/60',
  STAT: 'bg-rose-50 text-rose-700 border-rose-200/60',
}

function Pill({ text, className }: { text: string; className: string }) {
  return <span className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>{text}</span>
}

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all disabled:opacity-60 sm:text-sm'
const BTN_SECONDARY_SM = 'inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-60'

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

  const totalPages = data ? Math.ceil(data.count / PAGE_SIZE) : 1

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[{ label: t('lab.title') }]} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>{t('lab.title')}</h1>
          {user?.role === 'DOCTOR' && (
            <button type="button" onClick={() => navigate('/doctor/lab-orders/new')} className={BTN_PRIMARY}>{t('lab.newOrder')}</button>
          )}
        </div>
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
        <div className="mb-4">
          <label className="patient-text-body mb-1.5 block font-semibold" style={{ color: 'var(--text-primary)' }}>{t('lab.filterStatus')}</label>
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value as LabOrderStatus | ''); setPage(1) }}
            className="patient-field w-full sm:w-64"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s ? t(`status.${s}`) : t('common.none')}</option>
            ))}
          </select>
        </div>

        {isLoading ? <CenteredSpinner /> : (data?.results ?? []).length === 0 ? (
          <p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{t('lab.noOrders')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-slate-100">
                  <th className="patient-text-overline px-3 py-2 text-left" style={{ color: 'var(--text-muted)' }}>{t('lab.orderNumber')}</th>
                  <th className="patient-text-overline px-3 py-2 text-left" style={{ color: 'var(--text-muted)' }}>{t('lab.patient')}</th>
                  <th className="patient-text-overline px-3 py-2 text-left" style={{ color: 'var(--text-muted)' }}>{t('lab.status')}</th>
                  <th className="patient-text-overline px-3 py-2 text-left" style={{ color: 'var(--text-muted)' }}>{t('lab.priority')}</th>
                  <th className="patient-text-overline px-3 py-2 text-left" style={{ color: 'var(--text-muted)' }}>{t('appointments.when')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(data?.results ?? []).map((order) => (
                  <tr key={order.id} className="border-b border-slate-100">
                    <td className="px-3 py-2.5 font-semibold">
                      <Link to={`/doctor/lab-orders/${order.id}`} className="hover:underline" style={{ color: 'var(--brand-blue-start)' }}>
                        {order.order_number}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 patient-text-body" style={{ color: 'var(--text-primary)' }}>{order.patient_name}</td>
                    <td className="px-3 py-2.5"><Pill text={t(`status.${order.status}`)} className={LAB_STATUS_BADGE[order.status] ?? LAB_STATUS_BADGE.DRAFT} /></td>
                    <td className="px-3 py-2.5"><Pill text={t(`status.${order.priority}`)} className={LAB_PRIORITY_BADGE[order.priority] ?? LAB_PRIORITY_BADGE.ROUTINE} /></td>
                    <td className="px-3 py-2.5 patient-text-body-secondary" style={{ color: 'var(--text-muted)' }}>
                      {formatDate(order.created_at, language)}
                    </td>
                    <td className="px-3 py-2.5">
                      <Link to={`/doctor/lab-orders/${order.id}`} className={BTN_SECONDARY_SM}>
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
          <div className="mt-4 flex items-center justify-center gap-3">
            <button type="button" disabled={page === 1} onClick={() => setPage((p) => p - 1)} className={BTN_SECONDARY_SM}>‹</button>
            <span className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{t('lab.page')} {page} {t('lab.of')} {totalPages}</span>
            <button type="button" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)} className={BTN_SECONDARY_SM}>›</button>
          </div>
        )}
      </div>
    </div>
  )
}
