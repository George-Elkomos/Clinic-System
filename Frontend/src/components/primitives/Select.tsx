import { Check, ChevronDown, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface SelectOption {
  value: string | number
  label: string
  /** Optional secondary text rendered as a pill next to the label (e.g. an age or ID) — also triggers the initials avatar. */
  sublabel?: string
}

interface SelectProps {
  options: SelectOption[]
  value?: string | number | Array<string | number>
  onChange: (value: string | number | Array<string | number>) => void
  placeholder?: string
  searchable?: boolean
  multi?: boolean
  disabled?: boolean
  id?: string
}

function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export function Select({
  options,
  value,
  onChange,
  placeholder,
  searchable = false,
  multi = false,
  disabled = false,
  id,
}: SelectProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const optionRefs = useRef<Array<HTMLDivElement | null>>([])

  const selectedValues: Array<string | number> = multi
    ? (Array.isArray(value) ? value : [])
    : value != null && value !== '' && !Array.isArray(value) ? [value] : []

  const filtered = searchable && search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options

  useEffect(() => {
    optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Highlights the currently-selected row (or the first row) so keyboard nav has a sane starting point.
  const openMenu = () => {
    const initial = !multi ? options.findIndex((o) => o.value === selectedValues[0]) : -1
    setActiveIndex(initial >= 0 ? initial : 0)
    setSearch('')
    setOpen(true)
  }

  const closeMenu = () => {
    setOpen(false)
    setSearch('')
  }

  const toggle = (optVal: string | number) => {
    if (multi) {
      const arr = selectedValues.includes(optVal)
        ? selectedValues.filter((v) => v !== optVal)
        : [...selectedValues, optVal]
      onChange(arr)
      // Reset the query so the full option list reappears for the next pick,
      // instead of staying filtered down to just the tag that was just added.
      setSearch('')
      setActiveIndex(0)
    } else {
      onChange(optVal)
      closeMenu()
    }
  }

  const removeTag = (optVal: string | number, e: React.MouseEvent) => {
    e.stopPropagation()
    onChange(selectedValues.filter((v) => v !== optVal))
  }

  const clearAll = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange(multi ? [] : '')
    setSearch('')
  }

  const toggleChevron = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (open) {
      closeMenu()
      inputRef.current?.blur()
    } else {
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    if (e.key === 'Escape') {
      closeMenu()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) openMenu()
      else setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (open) setActiveIndex((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (!open) { openMenu(); return }
      const opt = filtered[activeIndex]
      if (opt) toggle(opt.value)
      return
    }
    if (e.key === ' ' && !searchable) {
      e.preventDefault()
      if (open) closeMenu()
      else openMenu()
    }
  }

  const hasValue = selectedValues.length > 0

  const optionRows = filtered.length === 0 ? (
    <div className="px-3 py-3 text-sm italic text-slate-400">{t('common.noOptions')}</div>
  ) : (
    filtered.map((o, i) => {
      const selected = selectedValues.includes(o.value)
      const active = i === activeIndex
      return (
        <div
          key={o.value}
          ref={(el) => { optionRefs.current[i] = el }}
          role="option"
          aria-selected={selected}
          onMouseEnter={() => setActiveIndex(i)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => { e.stopPropagation(); toggle(o.value) }}
          className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg p-3 text-sm transition-colors duration-150 ${
            selected
              ? 'bg-teal-50 font-medium text-teal-800'
              : active
                ? 'bg-teal-50/60 text-teal-900'
                : 'text-slate-700 hover:bg-teal-50/60 hover:text-teal-900'
          }`}
        >
          <span className="flex min-w-0 items-center gap-3">
            {multi && (
              selected
                ? <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-teal-600 text-white"><Check size={10} /></span>
                : <span className="h-4 w-4 shrink-0 rounded-full border border-slate-300" />
            )}
            {o.sublabel && (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-100 text-xs font-semibold text-teal-700">
                {initials(o.label)}
              </span>
            )}
            <span className="truncate">{o.label}</span>
            {o.sublabel && (
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">{o.sublabel}</span>
            )}
          </span>
          {!multi && selected && <Check size={16} className="shrink-0 text-teal-600" />}
        </div>
      )
    })
  )

  // Plain (non-searchable) dropdown: a click-only <div> trigger, no typing —
  // there's nothing to filter, so it never had a nested search box to begin with.
  if (!searchable) {
    return (
      <div className="relative" ref={containerRef} onKeyDown={handleKeyDown}>
        <div
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          tabIndex={disabled ? -1 : 0}
          onClick={() => {
            if (disabled) return
            if (open) closeMenu(); else openMenu()
          }}
          className={`flex w-full items-center gap-2 rounded-xl border bg-white px-3 py-2.5 text-sm transition-colors ${
            disabled ? 'cursor-not-allowed bg-slate-50 opacity-60' : 'cursor-pointer'
          } ${open ? 'border-teal-500 ring-2 ring-teal-500/15' : 'border-slate-200 hover:border-slate-300'}`}
        >
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {!hasValue && <span className="text-slate-400">{placeholder ?? t('common.select')}</span>}
            {multi
              ? selectedValues.map((v) => {
                  const opt = options.find((o) => o.value === v)
                  return opt ? (
                    <span key={v} className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700">
                      {opt.label}
                      <button
                        type="button"
                        onClick={(e) => removeTag(v, e)}
                        className="rounded-full border-none bg-transparent p-0.5 text-teal-500 transition-colors hover:bg-teal-100 hover:text-teal-700"
                        aria-label={`Remove ${opt.label}`}
                      ><X size={12} /></button>
                    </span>
                  ) : null
                })
              : hasValue && (
                  <span className="truncate text-slate-800">{options.find((o) => o.value === selectedValues[0])?.label}</span>
                )}
          </div>
          {hasValue && !disabled && (
            <button
              type="button"
              onClick={clearAll}
              className="shrink-0 rounded-full border-none bg-transparent p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              aria-label={t('common.clear')}
            ><X size={14} /></button>
          )}
          <ChevronDown size={16} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>

        {open && (
          <div className="absolute z-50 mt-1.5 w-full overflow-hidden rounded-xl border border-slate-100 bg-white shadow-xl" role="listbox">
            <div className="max-h-64 overflow-y-auto p-1.5">{optionRows}</div>
          </div>
        )}
      </div>
    )
  }

  // Searchable dropdown: single-input pattern — the trigger IS the search
  // field (same idea as AsyncCombobox), so there's only ever one input and
  // one focus ring on screen, never a second nested search box in the popover.
  const selectedLabel = !multi && hasValue ? options.find((o) => o.value === selectedValues[0])?.label ?? '' : ''
  const displayValue = multi ? search : (open ? search : selectedLabel)

  return (
    <div className="relative" ref={containerRef} onKeyDown={handleKeyDown}>
      <div
        onClick={() => !disabled && inputRef.current?.focus()}
        className={`flex w-full flex-wrap items-center gap-1.5 rounded-xl border bg-white px-3 py-2 text-sm transition-colors focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/20 ${
          disabled ? 'cursor-not-allowed bg-slate-50 opacity-60' : 'cursor-text border-slate-200 hover:border-slate-300'
        }`}
      >
        <Search size={15} className="shrink-0 text-slate-400" />
        {multi && selectedValues.map((v) => {
          const opt = options.find((o) => o.value === v)
          return opt ? (
            <span key={v} className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700">
              {opt.label}
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => removeTag(v, e)}
                className="rounded-full border-none bg-transparent p-0.5 text-teal-500 transition-colors hover:bg-teal-100 hover:text-teal-700"
                aria-label={`Remove ${opt.label}`}
              ><X size={12} /></button>
            </span>
          ) : null
        })}
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          disabled={disabled}
          value={displayValue}
          onFocus={openMenu}
          onChange={(e) => {
            setSearch(e.target.value)
            setActiveIndex(0)
            if (!open) setOpen(true)
          }}
          placeholder={multi && hasValue ? '' : placeholder ?? t('common.select')}
          autoComplete="off"
          className="combo-input-reset min-w-[100px] flex-1 text-sm text-slate-800 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
        />
        {hasValue && !disabled && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={clearAll}
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
          <div className="max-h-64 overflow-y-auto p-1.5">{optionRows}</div>
        </div>
      )}
    </div>
  )
}
