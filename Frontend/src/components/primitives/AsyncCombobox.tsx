import { Check, ChevronDown, Search, X } from 'lucide-react'
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
 * Debounced async-search combobox. Shares the same floating-menu visual
 * language as the static `Select`, but loads options remotely as the user types.
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
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
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
    if (open) setTimeout(() => searchRef.current?.focus(), 50)
  }, [open])

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

  return (
    <div className="relative" ref={containerRef} onKeyDown={handleKeyDown}>
      <div
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={`flex w-full items-center gap-2 rounded-xl border bg-white px-3 py-2.5 text-sm transition-colors ${
          disabled ? 'cursor-not-allowed bg-slate-50 opacity-60' : 'cursor-pointer'
        } ${open ? 'border-teal-500 ring-2 ring-teal-500/15' : 'border-slate-200 hover:border-slate-300'}`}
      >
        <div className="min-w-0 flex-1">
          {value ? <span className="truncate text-slate-800">{value.label}</span> : <span className="text-slate-400">{placeholder ?? t('common.select')}</span>}
        </div>
        {value && !disabled && (
          <button
            type="button"
            onClick={clear}
            className="shrink-0 rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label={t('common.clear')}
          ><X size={14} /></button>
        )}
        <ChevronDown size={16} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </div>

      {open && (
        <div className="absolute z-50 mt-1.5 w-full overflow-hidden rounded-xl border border-slate-100 bg-white shadow-xl" role="listbox">
          <div className="relative flex items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-3 py-2">
            <Search size={15} className="shrink-0 text-slate-400" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              placeholder={t('common.search')}
              className="w-full border-none bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1.5">
            {loading ? (
              <div className="flex justify-center p-3"><Spinner size={20} /></div>
            ) : options.length === 0 ? (
              <div className="px-3 py-3 text-sm italic text-slate-400">{t('common.noOptions')}</div>
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
