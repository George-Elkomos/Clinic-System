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
      <header className="shell__header">
        <h1 className="shell__brand">{t('app.name')}</h1>
        <div className="shell__spacer" />
        <span className="shell__user">
          {user.full_name || user.email} · {t(`roles.${user.role}`)}
        </span>
        <NotificationBell />
        <Link to="/account/notifications" className="btn btn--secondary" style={{ minHeight: 44 }}>
          {t('nav.settings')}
        </Link>
        <LanguageSwitcher />
        <Button variant="secondary" onClick={() => void logout()} style={{ minHeight: 44 }}>
          {t('nav.signOut')}
        </Button>
      </header>
      <div className="shell__body">
        <RoleNav role={user.role} />
        <main className="shell__main">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
