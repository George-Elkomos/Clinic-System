import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Spinner } from './Spinner'

export interface ComboOption {
  value: number
  label: string
}

interface AsyncComboboxProps {
  value: ComboOption | null
  onChange: (option: ComboOption | null) => void
  fetcher: (query: string) => Promise<ComboOption[]>
  placeholder?: string
  disabled?: boolean
  id?: string
}

/**
 * Debounced async-search combobox. Reuses the `.select__*` styling so it matches
 * the static Select, but loads options remotely as the user types.
 */
export function AsyncCombobox({
  value,
  onChange,
  fetcher,
  placeholder,
  disabled = false,
  id,
}: AsyncComboboxProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<ComboOption[]>([])
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Debounced remote search whenever the menu is open and the query changes.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    const handle = window.setTimeout(async () => {
      try {
        const result = await fetcher(query)
        if (!cancelled) setOptions(result)
      } catch {
        if (!cancelled) setOptions([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [open, query, fetcher])

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50)
  }, [open])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const pick = (opt: ComboOption) => {
    onChange(opt)
    setOpen(false)
    setQuery('')
  }

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange(null)
  }

  return (
    <div className="select" ref={containerRef}>
      <div
        id={id}
        className={`select__control${open ? ' select__control--open' : ''}`}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!disabled) setOpen((o) => !o) }
          if (e.key === 'Escape') { setOpen(false); setQuery('') }
        }}
      >
        <div className="select__value">
          {value ? <span>{value.label}</span> : <span className="select__placeholder">{placeholder ?? t('common.select')}</span>}
        </div>
        {value && !disabled && (
          <button className="select__clear" onClick={clear} aria-label={t('common.clear')}>×</button>
        )}
        <span className="select__arrow">{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div className="select__menu" role="listbox">
          <input
            ref={searchRef}
            className="select__search"
            placeholder={t('common.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
          {loading ? (
            <div className="select__empty"><Spinner size={20} /></div>
          ) : options.length === 0 ? (
            <div className="select__empty">{t('common.noOptions')}</div>
          ) : (
            options.map((o) => (
              <div
                key={o.value}
                className={`select__option${value?.value === o.value ? ' select__option--selected' : ''}`}
                role="option"
                aria-selected={value?.value === o.value}
                onClick={(e) => { e.stopPropagation(); pick(o) }}
              >
                {o.label}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
