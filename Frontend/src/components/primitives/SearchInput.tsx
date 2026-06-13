import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface SearchInputProps {
  onSearch: (value: string) => void
  placeholder?: string
  debounceMs?: number
  defaultValue?: string
}

export function SearchInput({ onSearch, placeholder, debounceMs = 300, defaultValue = '' }: SearchInputProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState(defaultValue)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => onSearch(value.trim()), debounceMs)
    return () => clearTimeout(timerRef.current)
  }, [value, debounceMs, onSearch])

  return (
    <div className="search-input">
      <span className="search-input__icon" aria-hidden="true">🔍</span>
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder ?? t('common.searchPlaceholder')}
        aria-label={placeholder ?? t('common.searchPlaceholder')}
      />
      {value && (
        <button
          className="search-input__clear"
          onClick={() => setValue('')}
          aria-label={t('common.clear')}
        >×</button>
      )}
    </div>
  )
}
