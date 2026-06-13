import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface SelectOption {
  value: string | number
  label: string
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

const TAG_COLORS = ['tag--blue', 'tag--green', 'tag--orange', 'tag--purple', 'tag--teal']

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
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const selectedValues: Array<string | number> = multi
    ? (Array.isArray(value) ? value : [])
    : value != null && value !== '' && !Array.isArray(value) ? [value] : []

  const filtered = searchable && search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options

  useEffect(() => {
    if (open && searchable) setTimeout(() => searchRef.current?.focus(), 50)
  }, [open, searchable])

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

  const toggle = (optVal: string | number) => {
    if (multi) {
      const arr = selectedValues.includes(optVal)
        ? selectedValues.filter((v) => v !== optVal)
        : [...selectedValues, optVal]
      onChange(arr)
    } else {
      onChange(optVal)
      setOpen(false)
      setSearch('')
    }
  }

  const removeTag = (optVal: string | number, e: React.MouseEvent) => {
    e.stopPropagation()
    onChange(selectedValues.filter((v) => v !== optVal))
  }

  const clearAll = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange(multi ? [] : '')
  }

  const hasValue = selectedValues.length > 0

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
          if (e.key === 'Escape') { setOpen(false); setSearch('') }
        }}
      >
        <div className="select__value">
          {!hasValue && <span className="select__placeholder">{placeholder ?? t('common.select')}</span>}
          {multi
            ? selectedValues.map((v, i) => {
                const opt = options.find((o) => o.value === v)
                return opt ? (
                  <span key={v} className={`select__tag ${TAG_COLORS[i % TAG_COLORS.length]}`}>
                    {opt.label}
                    <button
                      className="select__tag-remove"
                      onClick={(e) => removeTag(v, e)}
                      aria-label={`Remove ${opt.label}`}
                    >×</button>
                  </span>
                ) : null
              })
            : hasValue && (
                <span>{options.find((o) => o.value === selectedValues[0])?.label}</span>
              )}
        </div>
        {hasValue && (
          <button className="select__clear" onClick={clearAll} aria-label={t('common.clear')}>×</button>
        )}
        <span className="select__arrow">{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div className="select__menu" role="listbox">
          {searchable && (
            <input
              ref={searchRef}
              className="select__search"
              placeholder={t('common.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
          )}
          {filtered.length === 0 ? (
            <div className="select__empty">{t('common.noOptions')}</div>
          ) : (
            filtered.map((o) => {
              const selected = selectedValues.includes(o.value)
              return (
                <div
                  key={o.value}
                  className={`select__option${selected ? ' select__option--selected' : ''}`}
                  role="option"
                  aria-selected={selected}
                  onClick={(e) => { e.stopPropagation(); toggle(o.value) }}
                >
                  {multi && <span style={{ marginInlineEnd: '8px' }}>{selected ? '✓' : '○'}</span>}
                  {o.label}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
