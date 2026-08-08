import { useTranslation } from 'react-i18next'

import { useAuth } from '../../hooks/useAuth'
import { useLanguage } from '../../hooks/useLanguage'
import { authApi } from '../../services/auth.api'
import type { Language } from '../../services/types'

// Single pill button showing both languages ("AR | EN", active one teal) that
// toggles on click — same data/behavior as the dashboard's PatientLanguageToggle,
// just one clickable pill instead of a dropdown. Shared by PublicLayout's navbar
// and the standalone auth pages (forgot/reset password) that don't render the navbar.
export function PublicLanguageToggle() {
  const { t } = useTranslation()
  const { language, setLanguage } = useLanguage()
  const { user } = useAuth()

  const toggle = () => {
    const next: Language = language === 'ar' ? 'en' : 'ar'
    setLanguage(next)
    if (user) void authApi.updateMe({ preferred_language: next }).catch(() => {})
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={t('language.label')}
      className="public-btn--xs flex items-center gap-1 sm:gap-1.5 font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200/80 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full transition-colors shrink-0"
    >
      <span className={language === 'ar' ? 'text-[#0D9488]' : ''}>AR</span>
      <span aria-hidden="true" className="text-slate-300">
        |
      </span>
      <span className={language === 'en' ? 'text-[#0D9488]' : ''}>EN</span>
    </button>
  )
}
