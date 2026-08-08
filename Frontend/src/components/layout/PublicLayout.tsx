import { Stethoscope } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '../../hooks/useAuth'
import { roleHome } from '../../routes/roleHome'
import { Logo } from './Logo'
import { PublicLanguageToggle } from './PublicLanguageToggle'
import './public.css'

interface PublicLayoutProps {
  children: ReactNode
}

export function PublicLayout({ children }: PublicLayoutProps) {
  const { t } = useTranslation()
  const { status, user } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="public-shell" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-100 px-3 sm:px-8 py-3 sm:py-3.5 flex items-center justify-between gap-1.5">
        <Link to="/" className="flex min-w-0 shrink-0 items-center">
          <Logo className="h-7 w-auto sm:h-8" />
        </Link>

        <nav className="flex min-w-0 items-center gap-1 sm:gap-3">
          <Link
            to="/doctors"
            className="hidden min-[400px]:flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-600 no-underline transition-colors hover:bg-slate-50 hover:text-[#0D9488] sm:px-2.5 sm:text-sm"
          >
            <Stethoscope className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="whitespace-nowrap">{t('nav.doctors')}</span>
          </Link>

          <PublicLanguageToggle />

          {status === 'authed' && user ? (
            <button
              type="button"
              onClick={() => navigate(roleHome(user.role))}
              className="public-btn--responsive-text shrink-0 whitespace-nowrap rounded-xl bg-[#0D9488] px-2.5 py-1 font-semibold text-white shadow-sm transition-all hover:bg-[#0B7A70] sm:px-4 sm:py-2"
            >
              {t('nav.dashboard')}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="public-btn--responsive-text shrink-0 whitespace-nowrap rounded-xl bg-transparent px-2 py-1 font-semibold text-slate-700 hover:text-[#0D9488] transition-all sm:px-3.5 sm:py-1.5"
              >
                {t('auth.signIn')}
              </button>
              <button
                type="button"
                onClick={() => navigate('/register')}
                className="public-btn--responsive-text shrink-0 whitespace-nowrap rounded-xl bg-[#0D9488] px-2.5 py-1 font-semibold text-white shadow-sm transition-all hover:bg-[#0B7A70] sm:px-4 sm:py-2"
              >
                {t('auth.createAccount')}
              </button>
            </>
          )}
        </nav>
      </header>

      <main style={{ flex: 1 }}>{children}</main>

      <footer className="py-8 border-t border-slate-100 text-center text-xs text-slate-400 font-medium">
        <p>
          {t('app.name')} — {t('app.tagline', { defaultValue: 'Professional healthcare management' })}
        </p>
      </footer>
    </div>
  )
}
