import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { Language } from '../services/types'

interface LanguageContextValue {
  language: Language
  dir: 'ltr' | 'rtl'
  setLanguage: (lng: Language) => void
}

// eslint-disable-next-line react-refresh/only-export-components
export const LanguageContext = createContext<LanguageContextValue | null>(null)

function applyDocument(lng: Language) {
  document.documentElement.lang = lng
  document.documentElement.dir = lng === 'ar' ? 'rtl' : 'ltr'
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation()
  const [language, setLanguageState] = useState<Language>(
    (i18n.resolvedLanguage as Language) || 'en',
  )

  useEffect(() => {
    applyDocument(language)
  }, [language])

  const setLanguage = useCallback(
    (lng: Language) => {
      void i18n.changeLanguage(lng)
      setLanguageState(lng)
      applyDocument(lng)
    },
    [i18n],
  )

  const value = useMemo<LanguageContextValue>(
    () => ({ language, dir: language === 'ar' ? 'rtl' : 'ltr', setLanguage }),
    [language, setLanguage],
  )

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}
