import { useTranslation } from 'react-i18next'
import { Link, Outlet } from 'react-router-dom'

import { useAuth } from '../../hooks/useAuth'
import { Button } from '../primitives/Button'
import { LanguageSwitcher } from '../primitives/LanguageSwitcher'
import { NotificationBell } from './NotificationBell'
import { RoleNav } from './RoleNav'
import './layout.css'

export function AppShell() {
  const { t } = useTranslation()
  const { user, logout } = useAuth()
  if (!user) return null

  return (
    <div className="shell">
      {/* Hidden checkbox — drives the CSS-only mobile drawer */}
      <input type="checkbox" id="nav-open" className="nav-toggle__input" aria-hidden="true" />

      <header className="shell__header">
        <label htmlFor="nav-open" className="nav-toggle__btn" aria-label={t('nav.menu')}>
          <span aria-hidden="true">☰</span>
        </label>
        <h1 className="shell__brand">{t('app.name')}</h1>
        <div className="shell__spacer" />
        <div className="shell__actions">
          <span className="shell__user">
            {user.full_name || user.email} · {t(`roles.${user.role}`)}
          </span>
          <NotificationBell />
          <Link to="/account/notifications" className="btn btn--secondary shell__action-settings">
            {t('nav.settings')}
          </Link>
          <LanguageSwitcher />
          <Button variant="secondary" onClick={() => void logout()}>
            {t('nav.signOut')}
          </Button>
        </div>
      </header>

      {/* Clicking overlay closes the drawer */}
      <label htmlFor="nav-open" className="nav-overlay" aria-hidden="true" />

      <div className="shell__body">
        <RoleNav role={user.role} />
        <main className="shell__main">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
