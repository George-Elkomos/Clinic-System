import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { DoctorCard } from '../../components/DoctorCard'
import { PublicLayout } from '../../components/layout/PublicLayout'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { publicApi } from '../../services/apiClient'
import type { Paginated, PublicDoctor } from '../../services/types'

const STEPS = [
  { icon: '🔍', titleKey: 'landing.step1Title', descKey: 'landing.step1Desc' },
  { icon: '📅', titleKey: 'landing.step2Title', descKey: 'landing.step2Desc' },
  { icon: '🏥', titleKey: 'landing.step3Title', descKey: 'landing.step3Desc' },
]

export function LandingPage() {
  const { t } = useTranslation()

  const { data, isLoading } = useQuery({
    queryKey: ['public-doctors-landing'],
    queryFn: () =>
      publicApi.get<Paginated<PublicDoctor>>('/public/doctors/?ordering=-average_rating').then(
        (r) => r.data.results.slice(0, 6)
      ),
  })

  return (
    <PublicLayout>
      {/* Hero */}
      <section className="hero">
        <h1 className="hero__title">{t('landing.heroTitle')}</h1>
        <p className="hero__sub">{t('landing.heroSub')}</p>
        <div className="hero__cta-row">
          <Link to="/doctors" className="btn btn--primary btn--block" style={{ maxWidth: 220 }}>
            {t('landing.findDoctor')}
          </Link>
          <Link to="/login" className="btn btn--secondary btn--block" style={{ maxWidth: 220 }}>
            {t('auth.signIn')}
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section className="pub-section pub-section--alt">
        <h2 className="section-title">{t('landing.howItWorks')}</h2>
        <div className="steps">
          {STEPS.map((step) => (
            <div key={step.titleKey} className="step">
              <div className="step__icon">{step.icon}</div>
              <h3 className="step__title">{t(step.titleKey)}</h3>
              <p style={{ color: 'var(--text-muted)' }}>{t(step.descKey)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Top doctors */}
      <section className="pub-section">
        <h2 className="section-title">{t('landing.topDoctors')}</h2>
        {isLoading ? (
          <CenteredSpinner />
        ) : (
          <div className="doctor-grid">
            {(data ?? []).map((d) => (
              <DoctorCard key={d.id} doctor={d} />
            ))}
          </div>
        )}
      </section>

      {/* Register CTA */}
      <section className="pub-section pub-section--alt" style={{ textAlign: 'center' }}>
        <h2>{t('landing.registerCta')}</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-5)' }}>
          {t('landing.registerCtaSub')}
        </p>
        <Link to="/register" className="btn btn--primary" style={{ fontSize: 'var(--font-h3)', padding: 'var(--space-3) var(--space-6)' }}>
          {t('auth.createAccount')}
        </Link>
      </section>
    </PublicLayout>
  )
}
