import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Calendar, ChevronRight, FlaskConical } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Spinner, CenteredSpinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { useAuth } from '../../hooks/useAuth'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDateTime, formatTime } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { appointmentsApi } from '../../services/appointments.api'
import { labOrdersApi } from '../../services/labOrders.api'
import type { Appointment, AppointmentStatus, LabOrderStatus } from '../../services/types'

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

const STATUS_BADGE: Record<AppointmentStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200/60',
  CONFIRMED: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  CHECKED_IN: 'bg-teal-50 text-teal-700 border-teal-200/60',
  IN_PROGRESS: 'bg-sky-50 text-sky-700 border-sky-200/60',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  CANCELLED: 'bg-slate-50 text-slate-500 border-slate-200/60',
  NO_SHOW: 'bg-slate-50 text-slate-500 border-slate-200/60',
  EXPIRED: 'bg-slate-50 text-slate-500 border-slate-200/60',
}

const LAB_STATUS_BADGE: Record<LabOrderStatus, string> = {
  DRAFT: 'bg-slate-50 text-slate-500 border-slate-200/60',
  ORDERED: 'bg-amber-50 text-amber-700 border-amber-200/60',
  SAMPLE_COLLECTED: 'bg-sky-50 text-sky-700 border-sky-200/60',
  PROCESSING: 'bg-sky-50 text-sky-700 border-sky-200/60',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  REVIEWED: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
}

// Doctor's own lightweight KPI + recent-labs tiles, inlined rather than reused
// from components/lab/*Widget — those are still imported by not-yet-redesigned
// Secretary pages, and retheming them directly would half-style those pages
// (they only pick up Tailwind once their own role is scoped into .patient-shell).
function KpiTile({
  icon: Icon,
  iconBg,
  iconColor,
  value,
  label,
}: {
  icon: typeof FlaskConical
  iconBg: string
  iconColor: string
  value: number | string
  label: string
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm">
      <div className="min-w-0">
        <div className="font-medium text-slate-600">{label}</div>
        <div className="mt-1 text-3xl font-bold text-slate-900">{value}</div>
      </div>
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full" style={{ background: iconBg }}>
        <Icon className="h-6 w-6" style={{ color: iconColor }} />
      </span>
    </div>
  )
}

export function DoctorDashboard() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { user } = useAuth()
  const { showToast } = useToast()
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['appointments', 'today'],
    queryFn: () => appointmentsApi.list({ date: todayISO() }),
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
  const { data: recentLabs } = useQuery({
    queryKey: ['lab-orders', 'recent'],
    queryFn: () => labOrdersApi.list({ page_size: 5 }),
    staleTime: 30_000,
    retry: 1,
  })

  // The doctor's only manual transition left is "Complete" — check-in/start
  // now happen automatically when the chart is opened (see EncounterPage).
  const complete = useMutation({
    mutationFn: (id: number) => appointmentsApi.complete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['appointments'] }),
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  // Today's queue only shows patients ready to be seen (or already being/been
  // seen) — PENDING bookings haven't been confirmed by the front desk yet, so
  // they don't belong in the doctor's active view (nor do CANCELLED/EXPIRED/
  // NO_SHOW, which never needed a doctor's attention).
  const ACTIVE_QUEUE_STATUSES: Appointment['status'][] = ['CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED']
  const rows = (data?.results ?? []).filter((a) => ACTIVE_QUEUE_STATUSES.includes(a.status))
  const isOpenable = (a: Appointment) => a.status === 'CONFIRMED' || a.status === 'CHECKED_IN' || a.status === 'IN_PROGRESS'

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="patient-text-page-title" style={{ color: 'var(--text-primary)' }}>
          {t('dashboard.welcome', { name: user?.first_name || user?.email })}
        </h1>
        <p className="patient-text-body-secondary mt-1" style={{ color: 'var(--text-secondary)' }}>
          {t('dashboard.doctorIntro')}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <KpiTile
          icon={FlaskConical}
          iconBg="#E6F7F7"
          iconColor="var(--brand-teal-start)"
          value={pendingOrders?.count ?? '—'}
          label={t('lab.pendingCount')}
        />
        <KpiTile
          icon={AlertCircle}
          iconBg="#FEF2F2"
          iconColor="#EF4444"
          value={completedOrders?.count ?? '—'}
          label={t('lab.criticalCount')}
        />
      </div>

      <div className="rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6">
        <h2 className="patient-text-card-title mb-3" style={{ color: 'var(--text-primary)' }}>
          {t('lab.recentLabs')}
        </h2>
        {(recentLabs?.results ?? []).length === 0 ? (
          <p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{t('lab.noOrders')}</p>
        ) : (
          <div className="flex flex-col divide-y divide-slate-100">
            {(recentLabs?.results ?? []).map((order) => {
              const testType = order.item_count > 0 ? t('lab.testCount', { count: order.item_count }) : ''
              return (
                <div key={order.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/doctor/lab-orders/${order.id}`} className="font-semibold text-slate-900 hover:underline">
                        {order.order_number}
                      </Link>
                      <span className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${LAB_STATUS_BADGE[order.status] ?? LAB_STATUS_BADGE.DRAFT}`}>
                        {t(`status.${order.status}`)}
                      </span>
                    </div>
                    <div className="mt-1 truncate text-sm text-slate-600">{order.patient_name}{testType && ` · ${testType}`}</div>
                    <div className="mt-0.5 text-xs text-slate-400">{formatDateTime(order.created_at, language)}</div>
                  </div>
                  <Link
                    to={`/doctor/lab-orders/${order.id}`}
                    className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 sm:self-center"
                  >
                    {t('lab.viewDetails')}
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-3 flex items-center gap-2">
          <Calendar size={18} style={{ color: 'var(--brand-teal-start)' }} />
          <h2 className="patient-text-card-title" style={{ color: 'var(--text-primary)' }}>{t('dashboard.todayQueue')}</h2>
        </div>
        {isLoading ? (
          <CenteredSpinner />
        ) : rows.length === 0 ? (
          <p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{t('appointments.none')}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {rows.map((a) => {
              const pending = complete.isPending && complete.variables === a.id
              return (
                <div
                  key={a.id}
                  className="flex flex-col gap-3 rounded-xl border border-slate-100 bg-slate-50/40 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="patient-text-body font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{a.patient_name}</div>
                    <div className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{formatTime(a.scheduled_start, language)}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_BADGE[a.status] ?? STATUS_BADGE.CANCELLED}`}>
                      {t(`status.${a.status}`)}
                    </span>
                    {isOpenable(a) && (
                      <Link
                        to={`/doctor/encounters/${a.id}`}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all"
                      >
                        🩻 {t('encounters.open')}
                      </Link>
                    )}
                    {a.status === 'IN_PROGRESS' && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => complete.mutate(a.id)}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-all disabled:opacity-60"
                      >
                        {pending && <Spinner size={14} />}
                        {t('appointments.complete')}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
