import { Check, ChevronDown, Plus, Search, X } from 'lucide-react'
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
  // Shown as an inline action in the empty-results state (e.g. "no patients
  // matched this search — register a new one") instead of just the plain
  // "No options found" text.
  onCreateNew?: () => void
  createNewLabel?: string
}

/**
 * Debounced async-search combobox. The trigger IS the search field — typing
 * directly filters the remote options, rather than opening a second nested
 * search box, so there's only ever one input and one focus ring on screen.
 */
export function AsyncCombobox({
  value,
  onChange,
  fetcher,
  placeholder,
  disabled = false,
  id,
  onCreateNew,
  createNewLabel,
}: AsyncComboboxProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<ComboOption[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const optionRefs = useRef<Array<HTMLDivElement | null>>([])

  // Debounced remote search whenever the menu is open and the query changes.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    const handle = window.setTimeout(async () => {
      try {
        const result = await fetcher(query)
        if (!cancelled) { setOptions(result); setActiveIndex(0) }
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
    optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

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
    setQuery('')
  }

  const toggleChevron = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (open) {
      setOpen(false)
      setQuery('')
      inputRef.current?.blur()
    } else {
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    if (e.key === 'Escape') {
      setOpen(false)
      setQuery('')
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) setOpen(true)
      else setActiveIndex((i) => Math.min(i + 1, options.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (open) setActiveIndex((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (!open) { setOpen(true); return }
      const opt = options[activeIndex]
      if (opt) pick(opt)
    }
  }

  // While closed the field shows the selected label; opening it (focus) clears
  // the text so the full remote list loads immediately, same as before — it's
  // just rendered in the trigger itself now instead of a second box below it.
  const displayValue = open ? query : value?.label ?? ''

  return (
    <div className="relative" ref={containerRef} onKeyDown={handleKeyDown}>
      <div
        onClick={() => !disabled && inputRef.current?.focus()}
        className={`flex w-full items-center gap-2 rounded-xl border bg-white px-3 py-2.5 text-sm transition-colors focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/20 ${
          disabled ? 'cursor-not-allowed bg-slate-50 opacity-60' : 'cursor-text border-slate-200 hover:border-slate-300'
        }`}
      >
        <Search size={15} className="shrink-0 text-slate-400" />
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          disabled={disabled}
          value={displayValue}
          onFocus={() => { setOpen(true); setQuery('') }}
          onChange={(e) => {
            setQuery(e.target.value)
            setActiveIndex(0)
            if (!open) setOpen(true)
          }}
          placeholder={placeholder ?? t('common.select')}
          autoComplete="off"
          className="combo-input-reset min-w-0 flex-1 text-sm text-slate-800 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
        />
        {value && !disabled && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={clear}
            className="shrink-0 rounded-full border-none bg-transparent p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label={t('common.clear')}
          ><X size={14} /></button>
        )}
        <ChevronDown
          size={16}
          onClick={toggleChevron}
          className={`shrink-0 text-slate-400 transition-transform ${disabled ? '' : 'cursor-pointer'} ${open ? 'rotate-180' : ''}`}
        />
      </div>

      {open && (
        <div className="absolute z-50 mt-1.5 w-full overflow-hidden rounded-xl border border-slate-100 bg-white shadow-xl" role="listbox">
          <div className="max-h-64 overflow-y-auto p-1.5">
            {loading ? (
              <div className="flex justify-center p-3"><Spinner size={20} /></div>
            ) : options.length === 0 ? (
              <div className="px-2 py-2">
                <p className="px-1 py-2 text-sm italic text-slate-400">{t('common.noOptions')}</p>
                {onCreateNew && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      e.stopPropagation()
                      setOpen(false)
                      setQuery('')
                      onCreateNew()
                    }}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-teal-300 bg-teal-50/50 py-2 text-sm font-semibold text-teal-700 transition-colors hover:bg-teal-50"
                  >
                    <Plus size={15} className="shrink-0" />
                    {createNewLabel ?? t('common.createNew')}
                  </button>
                )}
              </div>
            ) : (
              options.map((o, i) => {
                const selected = value?.value === o.value
                const active = i === activeIndex
                return (
                  <div
                    key={o.value}
                    ref={(el) => { optionRefs.current[i] = el }}
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setActiveIndex(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => { e.stopPropagation(); pick(o) }}
                    className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg p-3 text-sm transition-colors duration-150 ${
                      selected
                        ? 'bg-teal-50 font-medium text-teal-800'
                        : active
                          ? 'bg-teal-50/60 text-teal-900'
                          : 'text-slate-700 hover:bg-teal-50/60 hover:text-teal-900'
                    }`}
                  >
                    <span className="truncate">{o.label}</span>
                    {selected && <Check size={16} className="shrink-0 text-teal-600" />}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
