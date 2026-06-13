import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Card } from '../../components/primitives/Card'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { StatusBadge } from '../../components/primitives/StatusBadge'
import { useAuth } from '../../hooks/useAuth'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDateTime } from '../../lib/format'
import { appointmentsApi } from '../../services/appointments.api'

export function PatientDashboard() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { user } = useAuth()

  const { data, isLoading } = useQuery({
    queryKey: ['appointments', 'mine'],
    queryFn: () => appointmentsApi.list(),
  })

  const upcoming = (data?.results ?? []).filter((a) =>
    ['PENDING', 'CONFIRMED', 'CHECKED_IN'].includes(a.status),
  )

  return (
    <div>
      <h1>{t('dashboard.welcome', { name: user?.first_name || user?.email })}</h1>
      <p>{t('dashboard.patientIntro')}</p>

      <Card title={t('dashboard.quickActions')}>
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <Link to="/patient/book" className="btn btn--primary">{t('nav.bookAppointment')}</Link>
          <Link to="/patient/appointments" className="btn btn--secondary">{t('nav.myAppointments')}</Link>
        </div>
      </Card>

      <Card title={t('dashboard.upcoming')}>
        {isLoading ? (
          <CenteredSpinner />
        ) : upcoming.length === 0 ? (
          <p>{t('appointments.none')}</p>
        ) : (
          upcoming.map((a) => (
            <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--space-3) 0', borderBottom: '1px solid var(--surface-2)' }}>
              <div>
                <strong>{a.doctor_name}</strong>
                <div style={{ color: 'var(--text-muted)' }}>{formatDateTime(a.scheduled_start, language)}</div>
              </div>
              <StatusBadge status={a.status} />
            </div>
          ))
        )}
      </Card>
    </div>
  )
}
