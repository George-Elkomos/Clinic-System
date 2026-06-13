import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '../../hooks/useAuth'
import { roleHome } from '../../routes/roleHome'
import { Button } from '../primitives/Button'
import { LanguageSwitcher } from '../primitives/LanguageSwitcher'

interface PublicLayoutProps {
  children: ReactNode
}

export function PublicLayout({ children }: PublicLayoutProps) {
  const { t } = useTranslation()
  const { status, user } = useAuth()
  const navigate = useNavigate()

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="pub-header">
        <Link to="/" className="pub-header__brand">{t('app.name')}</Link>
        <div className="pub-header__actions">
          <Link to="/doctors" style={{ color: 'var(--text)', textDecoration: 'none', fontSize: 'var(--font-action)', fontWeight: 600 }}>
            {t('nav.doctors')}
          </Link>
          <LanguageSwitcher />
          {status === 'authed' && user ? (
            <Button variant="primary" onClick={() => navigate(roleHome(user.role))}>
              {t('nav.dashboard')}
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => navigate('/login')}>
                {t('auth.signIn')}
              </Button>
              <Button variant="primary" onClick={() => navigate('/register')}>
                {t('auth.createAccount')}
              </Button>
            </>
          )}
        </div>
      </header>

      <main style={{ flex: 1 }}>
        {children}
      </main>

      <footer className="pub-footer">
        <p>{t('app.name')} — {t('app.tagline', { defaultValue: 'Professional healthcare management' })}</p>
      </footer>
    </div>
  )
}
