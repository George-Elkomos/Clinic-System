import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Card } from '../../components/primitives/Card'
import { useAuth } from '../../hooks/useAuth'

export function SecretaryDashboard() {
  const { t } = useTranslation()
  const { user } = useAuth()
  return (
    <div>
      <h1>{t('dashboard.welcome', { name: user?.first_name || user?.email })}</h1>
      <p>{t('dashboard.secretaryIntro')}</p>
      <Card title={t('dashboard.quickActions')}>
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <Link to="/secretary/desk" className="btn btn--primary">{t('nav.appointmentDesk')}</Link>
          <Link to="/secretary/doctors" className="btn btn--secondary">{t('nav.doctors')}</Link>
        </div>
      </Card>
    </div>
  )
}
