import { Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface SearchInputProps {
  onSearch: (value: string) => void
  placeholder?: string
  debounceMs?: number
  defaultValue?: string
  autoComplete?: string
}

export function SearchInput({
  onSearch,
  placeholder,
  debounceMs = 300,
  defaultValue = '',
  autoComplete,
}: SearchInputProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState(defaultValue)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => onSearch(value.trim()), debounceMs)
    return () => clearTimeout(timerRef.current)
  }, [value, debounceMs, onSearch])

  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-slate-400">
        <Search size={16} aria-hidden="true" />
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder ?? t('common.searchPlaceholder')}
        aria-label={placeholder ?? t('common.searchPlaceholder')}
        // patient-field / .public-shell input already supply the real
        // border/background/color/focus-ring per-shell (see the "Tailwind vs
        // unlayered CSS" trap notes in patient-tokens.css and public.css) —
        // search-input-control just adds icon-clearance padding on top.
        className="patient-field search-input-control focus:ring-2 focus:ring-teal-500/20"
      />
      {value && (
        <button
          type="button"
          onClick={() => setValue('')}
          aria-label={t('common.clear')}
          className="absolute inset-y-0 end-2 my-auto flex h-7 w-7 items-center justify-center rounded-full border-none bg-transparent text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <X size={16} />
        </button>
      )}
    </div>
  )
}
