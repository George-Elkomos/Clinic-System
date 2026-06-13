import { useTranslation } from 'react-i18next'

import { useAuth } from '../../hooks/useAuth'
import { useLanguage } from '../../hooks/useLanguage'
import { authApi } from '../../services/auth.api'
import type { Language } from '../../services/types'

export function LanguageSwitcher() {
  const { t } = useTranslation()
  const { language, setLanguage } = useLanguage()
  const { user } = useAuth()

  const change = (lng: Language) => {
    setLanguage(lng)
    // Persist the choice to the signed-in user's profile (localStorage is also
    // updated by the detector for anonymous/kiosk visitors).
    if (user) void authApi.updateMe({ preferred_language: lng }).catch(() => {})
  }

  return (
    <div role="group" aria-label={t('language.label')} style={{ display: 'flex', gap: 4 }}>
      {(['en', 'ar'] as Language[]).map((lng) => (
        <button
          key={lng}
          type="button"
          className={`btn ${language === lng ? 'btn--primary' : 'btn--secondary'}`}
          style={{ minHeight: 40, padding: '4px 12px', fontSize: 'var(--font-small)' }}
          aria-pressed={language === lng}
          onClick={() => change(lng)}
        >
          {t(`language.${lng}`)}
        </button>
      ))}
    </div>
  )
}
