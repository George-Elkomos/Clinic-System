import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useLanguage } from '../../hooks/useLanguage'

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Closes the popover (and any open month/year menu) on outside click, since
// it isn't a native element that gives us that for free.
function useOutsideClose(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onClose])
  return ref
}

export interface CustomDatePickerProps {
  /** ISO date string ("YYYY-MM-DD"), or '' when unset. */
  value: string
  onChange: (iso: string) => void
  /** ISO date strings bounding the selectable range (inclusive). */
  min?: string
  max?: string
  placeholder?: string
  id?: string
  disabled?: boolean
  /** 'field' matches a full-width form input (FormField-driven forms); 'filter' is
   * the compact style used in inline filter bars. Defaults to 'filter'. */
  variant?: 'filter' | 'field'
  /** Shows the "Clear" footer action. Turn off for required fields (e.g. a
   * booking date that always needs a value). Defaults to true. */
  allowClear?: boolean
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}

/**
 * Custom calendar popover shared by every date field in the app, replacing the
 * native `<input type="date">` (unstylable OS popup) with a consistent Nabda
 * teal design. Includes Month/Year quick-jump dropdowns so far-back dates
 * (e.g. a date of birth) don't require paging one month at a time.
 */
export function CustomDatePicker({
  value,
  onChange,
  min,
  max,
  placeholder,
  id,
  disabled = false,
  variant = 'filter',
  allowClear = true,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: CustomDatePickerProps) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const [open, setOpen] = useState(false)
  const [headerMenu, setHeaderMenu] = useState<'month' | 'year' | null>(null)
  const ref = useOutsideClose(open, () => {
    setOpen(false)
    setHeaderMenu(null)
  })
  const popoverRef = useRef<HTMLDivElement>(null)
  const [popoverLeft, setPopoverLeft] = useState(0)

  // Clamp the popover to a fully-visible horizontal position — a trigger near the
  // edge of a wide row (e.g. a "To" filter at the right edge) or on a narrow mobile
  // screen would otherwise clip the browser's own popup, unlike the native
  // <input type="date"> this replaces, which the browser always kept on-screen.
  // Uses real pixel math (not a start/end class flip) so it also covers the case
  // where the trigger sits in the middle of a viewport too narrow for the popover
  // to fit fully on either side.
  useEffect(() => {
    if (!open) return
    const wrapper = ref.current
    const popover = popoverRef.current
    if (!wrapper || !popover) return
    const margin = 8
    const isRTL = getComputedStyle(wrapper).direction === 'rtl'
    const wrapperRect = wrapper.getBoundingClientRect()
    const popoverWidth = popover.offsetWidth
    // The popover's own first-paint position (before this effect corrects it) can
    // itself force a mobile browser to expand the layout viewport to fit it, which
    // would make window.innerWidth report that already-too-wide size instead of the
    // real screen — visualViewport.width reflects the true physical viewport and
    // isn't affected by that reflow, so prefer the smaller of the two.
    const viewportWidth = Math.min(window.innerWidth, window.visualViewport?.width ?? window.innerWidth)
    let viewportLeft = isRTL ? wrapperRect.right - popoverWidth : wrapperRect.left
    viewportLeft = Math.min(viewportLeft, viewportWidth - popoverWidth - margin)
    viewportLeft = Math.max(viewportLeft, margin)
    setPopoverLeft(viewportLeft - wrapperRect.left)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const selectedDate = value ? new Date(`${value}T00:00:00`) : null
  const minDate = min ? new Date(`${min}T00:00:00`) : null
  const maxDate = max ? new Date(`${max}T00:00:00`) : null
  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const isTodayDisabled = !!((minDate && todayStart < minDate) || (maxDate && todayStart > maxDate))

  const [viewMonth, setViewMonth] = useState(() => {
    const base = selectedDate ?? today
    return new Date(base.getFullYear(), base.getMonth(), 1)
  })

  // Jump the visible month back to the current selection whenever the popover reopens.
  useEffect(() => {
    if (!open) return
    const base = selectedDate ?? today
    setViewMonth(new Date(base.getFullYear(), base.getMonth(), 1))
    setHeaderMenu(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const weekdayLabels = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(language, { weekday: 'short' })
    // Jan 4, 2026 is a Sunday — a stable anchor to enumerate Sun..Sat labels from.
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2026, 0, 4 + i)))
  }, [language])

  const monthLabels = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(language, { month: 'long' })
    return Array.from({ length: 12 }, (_, i) => fmt.format(new Date(2026, i, 1)))
  }, [language])

  const yearOptions = useMemo(() => {
    const minYear = minDate ? minDate.getFullYear() : today.getFullYear() - 100
    const maxYear = maxDate ? maxDate.getFullYear() : today.getFullYear() + 10
    const years: number[] = []
    for (let y = maxYear; y >= minYear; y--) years.push(y)
    return years
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [min, max])

  const cells = useMemo(() => {
    const firstOfMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1)
    const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate()
    const out: { date: Date; outside: boolean }[] = []
    for (let i = firstOfMonth.getDay(); i > 0; i--) {
      out.push({ date: new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1 - i), outside: true })
    }
    for (let d = 1; d <= daysInMonth; d++) {
      out.push({ date: new Date(viewMonth.getFullYear(), viewMonth.getMonth(), d), outside: false })
    }
    while (out.length < 42) {
      const last = out[out.length - 1].date
      out.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), outside: true })
    }
    return out
  }, [viewMonth])

  const triggerLabel = selectedDate
    ? selectedDate.toLocaleDateString(language, { day: 'numeric', month: 'short', year: 'numeric' })
    : (placeholder ?? t('common.select'))

  const sizingClass = variant === 'field' ? 'h-12 w-full px-4 text-sm' : 'px-3.5 py-2 text-xs sm:text-sm'
  const colorClass = ariaInvalid
    ? 'border-[color:var(--danger)] bg-rose-50/50 text-slate-700 focus:ring-2 focus:ring-[color:var(--danger)]/20'
    : variant === 'field'
      ? 'border-slate-200 bg-white text-slate-800 focus:border-[#0D9488] focus:ring-2 focus:ring-[#0D9488]/20'
      : 'border-slate-200 bg-slate-50 text-slate-700 focus:border-[#0D9488] focus:ring-2 focus:ring-[#0D9488]/20'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-2 rounded-xl border outline-none transition-all disabled:cursor-not-allowed disabled:opacity-60 ${sizingClass} ${colorClass}`}
      >
        <CalendarIcon size={variant === 'field' ? 16 : 14} className="shrink-0 text-slate-400" aria-hidden="true" />
        <span className={value ? '' : 'text-slate-400'}>{triggerLabel}</span>
      </button>

      {open && (
        <div
          ref={popoverRef}
          style={{ left: popoverLeft }}
          className="absolute z-50 mt-2 w-80 max-w-[90vw] rounded-2xl border border-slate-100 bg-white p-3 text-slate-700 shadow-xl"
        >
          <div className="mb-3 flex items-center justify-between gap-1">
            <button
              type="button"
              onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-none bg-transparent text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
              aria-label={t('common.previous', { defaultValue: 'Previous' })}
            >
              <ChevronLeft size={16} />
            </button>

            <div className="relative flex min-w-0 items-center justify-center gap-1">
              <button
                type="button"
                onClick={() => setHeaderMenu((m) => (m === 'month' ? null : 'month'))}
                className="flex h-10 items-center truncate rounded-lg border-none bg-transparent px-1.5 text-sm font-bold text-slate-800 transition-colors hover:bg-slate-50"
              >
                {monthLabels[viewMonth.getMonth()]}
              </button>
              <button
                type="button"
                onClick={() => setHeaderMenu((m) => (m === 'year' ? null : 'year'))}
                className="flex h-10 items-center rounded-lg border-none bg-transparent px-1.5 text-sm font-bold text-slate-800 transition-colors hover:bg-slate-50"
              >
                {viewMonth.getFullYear()}
              </button>

              {headerMenu === 'month' && (
                <div className="absolute start-0 top-full z-10 mt-1 max-h-48 w-36 overflow-y-auto rounded-xl border border-slate-100 bg-white p-1 shadow-xl">
                  {monthLabels.map((label, i) => {
                    const isCurrent = i === viewMonth.getMonth()
                    return (
                      <button
                        key={label}
                        type="button"
                        ref={isCurrent ? (el) => el?.scrollIntoView({ block: 'center' }) : undefined}
                        onClick={() => {
                          setViewMonth(new Date(viewMonth.getFullYear(), i, 1))
                          setHeaderMenu(null)
                        }}
                        className={`flex h-10 w-full items-center rounded-lg border-none px-2 text-start text-xs transition-colors ${
                          isCurrent
                            ? 'bg-[#0D9488] font-bold text-white'
                            : 'bg-transparent text-slate-700 hover:bg-teal-50 hover:text-[#0D9488]'
                        }`}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              )}
              {headerMenu === 'year' && (
                <div className="absolute start-0 top-full z-10 mt-1 max-h-48 w-28 overflow-y-auto rounded-xl border border-slate-100 bg-white p-1 shadow-xl">
                  {yearOptions.map((y) => {
                    const isCurrent = y === viewMonth.getFullYear()
                    return (
                      <button
                        key={y}
                        type="button"
                        ref={isCurrent ? (el) => el?.scrollIntoView({ block: 'center' }) : undefined}
                        onClick={() => {
                          setViewMonth(new Date(y, viewMonth.getMonth(), 1))
                          setHeaderMenu(null)
                        }}
                        className={`flex h-10 w-full items-center rounded-lg border-none px-2 text-start text-xs transition-colors ${
                          isCurrent
                            ? 'bg-[#0D9488] font-bold text-white'
                            : 'bg-transparent text-slate-700 hover:bg-teal-50 hover:text-[#0D9488]'
                        }`}
                      >
                        {y}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-none bg-transparent text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
              aria-label={t('common.next', { defaultValue: 'Next' })}
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-xs font-semibold text-slate-400">
            {weekdayLabels.map((d, i) => (
              <div key={i} className="flex h-8 items-center justify-center">{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {cells.map(({ date, outside }, i) => {
              const iso = toISO(date)
              const isSelected = !outside && iso === value
              const isDisabled = !!((minDate && date < minDate) || (maxDate && date > maxDate))
              return (
                <button
                  key={i}
                  type="button"
                  disabled={outside || isDisabled}
                  onClick={() => {
                    onChange(iso)
                    setOpen(false)
                  }}
                  className={
                    outside
                      ? 'pointer-events-none flex h-10 w-10 items-center justify-center rounded-xl border-none bg-transparent text-xs text-slate-300'
                      : isSelected
                        ? 'flex h-10 w-10 items-center justify-center rounded-xl border-none bg-[#0D9488] text-xs font-bold text-white shadow-sm'
                        : isDisabled
                          ? 'flex h-10 w-10 cursor-not-allowed items-center justify-center rounded-xl border-none bg-transparent text-xs text-slate-300'
                          : 'flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border-none bg-transparent text-xs text-slate-700 transition-all hover:bg-teal-50 hover:text-[#0D9488]'
                  }
                >
                  {date.getDate()}
                </button>
              )
            })}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
            {allowClear ? (
              <button
                type="button"
                onClick={() => {
                  onChange('')
                  setOpen(false)
                }}
                className="flex h-10 items-center rounded-lg border-none bg-transparent px-1 text-xs font-semibold text-[#0D9488] transition-all hover:text-[#0B7A70]"
              >
                {t('common.clear')}
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              disabled={isTodayDisabled}
              onClick={() => {
                setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1))
                if (!isTodayDisabled) {
                  onChange(toISO(today))
                  setOpen(false)
                }
              }}
              className={`flex h-10 items-center rounded-lg border-none bg-transparent px-1 text-xs font-semibold transition-all ${
                isTodayDisabled ? 'cursor-not-allowed text-slate-300' : 'text-[#0D9488] hover:text-[#0B7A70]'
              }`}
            >
              {t('common.today')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
