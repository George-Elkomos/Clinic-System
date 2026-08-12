import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { useAuth } from '../../hooks/useAuth'
import { reportsApi } from '../../services/reports.api'

const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all sm:text-sm'
const BTN_SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-all sm:text-sm'

export function ManagerDashboard() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { data } = useQuery({ queryKey: ['report', 'month'], queryFn: () => reportsApi.dashboard('month') })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="patient-text-page-title" style={{ color: 'var(--text-primary)' }}>
          {t('dashboard.welcome', { name: user?.first_name || user?.email })}
        </h1>
        <p className="patient-text-body-secondary mt-1" style={{ color: 'var(--text-secondary)' }}>
          {t('dashboard.managerIntro')}
        </p>
      </div>

      {data && (
        <div className="rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6">
          <h2 className="patient-text-card-title mb-3" style={{ color: 'var(--text-primary)' }}>{t('reports.month')}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {[
              [t('reports.total'), data.overall.total],
              [t('reports.completed'), data.overall.completed],
              [t('reports.noShow'), data.overall.no_show],
              [t('reports.avgWait'), data.avg_wait_minutes],
              [t('reports.newPatients'), data.new_patients_total],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
                <div className="text-2xl font-extrabold" style={{ color: 'var(--brand-teal-start)' }}>{value as number}</div>
                <div className="patient-text-body-secondary mt-0.5" style={{ color: 'var(--text-secondary)' }}>{label as string}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6">
        <h2 className="patient-text-card-title mb-3" style={{ color: 'var(--text-primary)' }}>{t('dashboard.quickActions')}</h2>
        <div className="flex flex-wrap gap-3">
          <Link to="/manager/reports"><button type="button" className={BTN_PRIMARY}>{t('nav.reports')}</button></Link>
          <Link to="/manager/reviews"><button type="button" className={BTN_SECONDARY}>{t('nav.reviews')}</button></Link>
          <Link to="/manager/audit"><button type="button" className={BTN_SECONDARY}>{t('nav.auditLog')}</button></Link>
        </div>
      </div>
    </div>
  )
}
