import { useQuery } from '@tanstack/react-query'
import { AlertCircle, FlaskConical } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { useAuth } from '../../hooks/useAuth'
import { labOrdersApi } from '../../services/labOrders.api'
import type { LabOrderStatus } from '../../services/types'

const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all sm:text-sm'
const BTN_SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-all sm:text-sm'

const LAB_STATUS_BADGE: Record<LabOrderStatus, string> = {
  DRAFT: 'bg-slate-50 text-slate-500 border-slate-200/60',
  ORDERED: 'bg-amber-50 text-amber-700 border-amber-200/60',
  SAMPLE_COLLECTED: 'bg-sky-50 text-sky-700 border-sky-200/60',
  PROCESSING: 'bg-sky-50 text-sky-700 border-sky-200/60',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  REVIEWED: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
}

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
        <div className="patient-text-body-secondary text-[#94A3B8]">{label}</div>
        <div className="mt-1 text-2xl font-extrabold" style={{ color: iconColor }}>{value}</div>
      </div>
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full" style={{ background: iconBg }}>
        <Icon className="h-6 w-6" style={{ color: iconColor }} />
      </span>
    </div>
  )
}

export function SecretaryDashboard() {
  const { t } = useTranslation()
  const { user } = useAuth()

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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="patient-text-page-title" style={{ color: 'var(--text-primary)' }}>
          {t('dashboard.welcome', { name: user?.first_name || user?.email })}
        </h1>
        <p className="patient-text-body-secondary mt-1" style={{ color: 'var(--text-secondary)' }}>
          {t('dashboard.secretaryIntro')}
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

      <div className="rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6">
        <h2 className="patient-text-card-title mb-3" style={{ color: 'var(--text-primary)' }}>{t('dashboard.quickActions')}</h2>
        <div className="flex flex-wrap gap-3">
          <Link to="/secretary/desk"><button type="button" className={BTN_PRIMARY}>{t('nav.appointmentDesk')}</button></Link>
          <Link to="/secretary/lab"><button type="button" className={BTN_SECONDARY}>{t('nav.labOrders')}</button></Link>
          <Link to="/secretary/doctors"><button type="button" className={BTN_SECONDARY}>{t('nav.doctors')}</button></Link>
        </div>
      </div>
    </div>
  )
}
