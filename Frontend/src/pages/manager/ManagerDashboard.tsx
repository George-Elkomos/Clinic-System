import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Card } from '../../components/primitives/Card'
import { useAuth } from '../../hooks/useAuth'
import { reportsApi } from '../../services/reports.api'

export function ManagerDashboard() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { data } = useQuery({ queryKey: ['report', 'month'], queryFn: () => reportsApi.dashboard('month') })

  return (
    <div>
      <h1>{t('dashboard.welcome', { name: user?.first_name || user?.email })}</h1>
      <p>{t('dashboard.managerIntro')}</p>

      {data && (
        <Card title={t('reports.month')}>
          <div style={{ display: 'flex', gap: 'var(--space-5)', flexWrap: 'wrap' }}>
            {[
              [t('reports.total'), data.overall.total],
              [t('reports.completed'), data.overall.completed],
              [t('reports.noShow'), data.overall.no_show],
              [t('reports.avgWait'), data.avg_wait_minutes],
              [t('reports.newPatients'), data.new_patients_total],
            ].map(([label, value]) => (
              <div key={label as string} style={{ minWidth: 110 }}>
                <div style={{ fontSize: 'var(--font-h2)', fontWeight: 700 }}>{value as number}</div>
                <div style={{ color: 'var(--text-muted)' }}>{label as string}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title={t('dashboard.quickActions')}>
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <Link to="/manager/reports" className="btn btn--primary">{t('nav.reports')}</Link>
          <Link to="/manager/reviews" className="btn btn--secondary">{t('nav.reviews')}</Link>
          <Link to="/manager/audit" className="btn btn--secondary">{t('nav.auditLog')}</Link>
        </div>
      </Card>
    </div>
  )
}
