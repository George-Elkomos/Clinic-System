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
    if (user) void authApi.updateMe({ preferred_language: lng }).catch(() => {})
  }

  return (
    <details key={language} className="lang-dropdown">
      <summary className="lang-dropdown__trigger" aria-label={t('language.label')}>
        <span>{t(`language.${language}`)}</span>
        <span className="lang-dropdown__arrow" aria-hidden="true">▾</span>
      </summary>
      <div className="lang-dropdown__menu">
        {(['en', 'ar'] as Language[]).map((lng) => (
          <button
            key={lng}
            type="button"
            className={`lang-dropdown__item${language === lng ? ' lang-dropdown__item--active' : ''}`}
            onClick={() => change(lng)}
          >
            {t(`language.${lng}`)}
          </button>
        ))}
      </div>
    </details>
  )
}
