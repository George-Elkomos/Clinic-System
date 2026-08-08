import { useInfiniteQuery } from '@tanstack/react-query'
import { CalendarDays, ChevronLeft, ChevronRight, History } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { CenteredSpinner, Spinner } from '../../components/primitives/Spinner'
import { useAuth } from '../../hooks/useAuth'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate, formatDateTime } from '../../lib/format'
import { timelineApi } from '../../services/timeline.api'
import type { TimelineEvent, TimelineEventType } from '../../services/types'

const PAGE_SIZE = 20

interface RxItem {
  drug_name: string
  dosage?: string
  frequency?: string
  duration?: string
}

function isISODatetime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)
}

function parsePrescriptionItems(value: unknown): RxItem[] | null {
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && value[0] !== null && 'drug_name' in value[0]) {
    return value as RxItem[]
  }
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object' && parsed[0] !== null && 'drug_name' in parsed[0]) {
        return parsed as RxItem[]
      }
    } catch {
      // Not valid JSON — fall through and render as plain text.
    }
  }
  return null
}

const LTR_FIELDS = new Set(['diagnosis', 'chief_complaint', 'treatment_plan', 'body', 'clinical_notes', 'notes', 'doctor_name', 'reason'])

const CHIPS: { key: string; types: TimelineEventType[] | null }[] = [
  { key: 'all', types: null },
  { key: 'vitals', types: ['VITAL_SIGNS'] },
  { key: 'labs', types: ['LAB_ORDER'] },
  { key: 'prescriptions', types: ['PRESCRIPTION'] },
  { key: 'notes', types: ['CLINICAL_NOTE'] },
  { key: 'records', types: ['MEDICAL_RECORD'] },
  { key: 'appointments', types: ['APPOINTMENT_COMPLETED'] },
]

const BORDER_COLOR: Record<TimelineEventType, string> = {
  VITAL_SIGNS: 'border-s-[#0D9488]',
  APPOINTMENT_COMPLETED: 'border-s-blue-500',
  PRESCRIPTION: 'border-s-emerald-500',
  LAB_ORDER: 'border-s-amber-500',
  CLINICAL_NOTE: 'border-s-purple-500',
  MEDICAL_RECORD: 'border-s-slate-400',
}

function monthKey(iso: string | null, locale: string): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(iso))
}

function getEventTitle(event: TimelineEvent, t: (k: string, o?: Record<string, unknown>) => string): string {
  const d = event.detail
  if (event.event_type === 'MEDICAL_RECORD') {
    return t('timeline.event.MEDICAL_RECORD.title', { version: d.version ?? 1 })
  }
  return t(`timeline.event.${event.event_type}.title`, { defaultValue: event.title })
}

function getEventSummary(event: TimelineEvent, t: (k: string, o?: Record<string, unknown>) => string): string {
  const d = event.detail
  switch (event.event_type) {
    case 'VITAL_SIGNS':
      return t('timeline.event.VITAL_SIGNS.summary', {
        bp: d.bp_systolic ?? '—', dbp: d.bp_diastolic ?? '—', hr: d.heart_rate ?? '—', temp: d.temperature ?? '—',
      })
    case 'LAB_ORDER':
      return t('timeline.event.LAB_ORDER.summary', {
        order_number: d.order_number ?? '—',
        status: d.status ? t(`timeline.status.${String(d.status)}`, { defaultValue: String(d.status) }) : '—',
      })
    case 'PRESCRIPTION':
      return t('timeline.event.PRESCRIPTION.summary', { count: Array.isArray(d.items) ? d.items.length : 0 })
    case 'CLINICAL_NOTE':
      return typeof d.body === 'string' ? d.body.slice(0, 120) : ''
    case 'MEDICAL_RECORD':
      return (typeof d.diagnosis === 'string' && d.diagnosis
        ? d.diagnosis
        : typeof d.chief_complaint === 'string' ? d.chief_complaint : ''
      ).slice(0, 120)
    case 'APPOINTMENT_COMPLETED':
      return t('timeline.event.APPOINTMENT_COMPLETED.summary', { doctor_name: d.doctor_name ?? '—' })
    default:
      return event.summary
  }
}

function EventDetailTable({ event }: { event: TimelineEvent }) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const rows = Object.entries(event.detail).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0))

  if (rows.length === 0) {
    return <p className="mt-3 text-xs text-slate-400">{t('timeline.noDetail')}</p>
  }

  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-slate-100">
      <table className="w-full min-w-[360px] border-collapse text-xs sm:text-sm">
        <tbody>
          {rows.map(([key, value]) => (
            <tr key={key} className="border-b border-slate-50 last:border-0">
              <th className="w-1/3 px-3 py-2 text-start font-semibold text-slate-500">
                {t(`timeline.field.${key}`, { defaultValue: key })}
              </th>
              <td className="px-3 py-2 text-slate-700" dir={LTR_FIELDS.has(key) ? 'ltr' : 'auto'}>
                {(() => {
                  const rxItems = parsePrescriptionItems(value)
                  if (rxItems) {
                    return (
                      <ul dir="ltr" className="space-y-1">
                        {rxItems.map((item, idx) => (
                          <li key={idx}>
                            <span className="font-semibold">{item.drug_name}</span>
                            {item.dosage && <> · {t('medical.dosage')}: {item.dosage}</>}
                            {item.frequency && <> · {t('medical.frequency')}: {item.frequency}</>}
                            {item.duration && <> · {t('medical.duration')}: {item.duration}</>}
                          </li>
                        ))}
                      </ul>
                    )
                  }
                  if (key === 'status' && typeof value === 'string') return t(`timeline.status.${value}`, { defaultValue: value })
                  if (Array.isArray(value)) return value.map(String).join(', ')
                  if (typeof value === 'string' && isISODatetime(value)) return formatDateTime(value, language)
                  return String(value)
                })()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EventRow({ event }: { event: TimelineEvent }) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <span
        className="absolute -ms-[31px] top-6 h-3 w-3 -translate-y-1/2 rounded-full bg-[#0D9488] ring-4 ring-white"
        aria-hidden="true"
      />
      <div
        className={`overflow-hidden rounded-2xl border border-slate-100 border-s-4 bg-white shadow-sm transition-all hover:shadow-md ${BORDER_COLOR[event.event_type]}`}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-3 border-none bg-transparent p-4 text-start"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold text-slate-800 sm:text-base">{getEventTitle(event, t)}</div>
            <div className="mt-0.5 truncate text-xs font-normal text-slate-500 sm:text-sm">{getEventSummary(event, t)}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-slate-400">
            {event.event_date ? formatDate(event.event_date, language) : ''}
            <ChevronRight className={`h-4 w-4 text-slate-300 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
          </div>
        </button>
        {open && (
          <div className="px-4 pb-4">
            <EventDetailTable event={event} />
          </div>
        )}
      </div>
    </div>
  )
}

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Closes a popover on outside click, since it isn't a native element that gives us that for free.
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

// Custom calendar popover replacing the native <input type="date"> for the From/To
// filters — the OS-rendered native popup can't be restyled and clipped behind the
// timeline's own content on some browsers.
function DateFilterPicker({
  value,
  onChange,
  min,
  max,
  locale,
  placeholder,
}: {
  value: string
  onChange: (iso: string) => void
  min?: string
  max?: string
  locale: string
  placeholder: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useOutsideClose(open, () => setOpen(false))

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const weekdayLabels = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' })
    // Jan 4, 2026 is a Sunday — a stable anchor to enumerate Sun..Sat labels from.
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2026, 0, 4 + i)))
  }, [locale])

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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs text-slate-700 outline-none transition-all focus:border-[#0D9488] focus:ring-2 focus:ring-[#0D9488]/20 sm:text-sm"
      >
        <CalendarDays size={14} className="shrink-0 text-slate-400" aria-hidden="true" />
        <span className={value ? '' : 'text-slate-400'}>
          {selectedDate
            ? selectedDate.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
            : placeholder}
        </span>
      </button>

      {open && (
        <div className="absolute start-0 z-50 mt-2 w-72 rounded-2xl border border-slate-100 bg-white p-4 text-slate-700 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
              className="rounded-lg border-none bg-transparent p-1 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-bold text-slate-800">
              {viewMonth.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
            </span>
            <button
              type="button"
              onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
              className="rounded-lg border-none bg-transparent p-1 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 text-center text-xs font-semibold text-slate-400">
            {weekdayLabels.map((d, i) => (
              <div key={i}>{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
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
                      ? 'pointer-events-none flex h-8 w-8 items-center justify-center rounded-xl border-none bg-transparent text-xs text-slate-300'
                      : isSelected
                        ? 'flex h-8 w-8 items-center justify-center rounded-xl border-none bg-[#0D9488] text-xs font-bold text-white shadow-sm'
                        : isDisabled
                          ? 'flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-xl border-none bg-transparent text-xs text-slate-300'
                          : 'flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl border-none bg-transparent text-xs text-slate-700 transition-all hover:bg-teal-50 hover:text-[#0D9488]'
                  }
                >
                  {date.getDate()}
                </button>
              )
            })}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => {
                onChange('')
                setOpen(false)
              }}
              className="border-none bg-transparent text-xs font-semibold text-[#0D9488] transition-all hover:text-[#0B7A70]"
            >
              {t('common.clear')}
            </button>
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
              className={`border-none bg-transparent text-xs font-semibold transition-all ${
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

function EmptyTimelineState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-100 bg-slate-50/60 p-8 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0D9488]/10 text-[#0D9488]">
        <History className="h-6 w-6" aria-hidden="true" />
      </div>
      <span className="text-sm font-medium text-slate-500">{text}</span>
    </div>
  )
}

export function PatientTimelinePage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { user } = useAuth()
  const patientId = user?.patient_profile?.id
  const [activeChip, setActiveChip] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const sentinelRef = useRef<HTMLDivElement>(null)

  const selectedTypes = CHIPS.find((c) => c.key === activeChip)?.types ?? null
  const typesParam = selectedTypes ? selectedTypes.join(',') : undefined

  const filters = useMemo(
    () => ({ types: typesParam, date_from: dateFrom || undefined, date_to: dateTo || undefined }),
    [typesParam, dateFrom, dateTo],
  )

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['timeline', patientId, filters],
    queryFn: ({ pageParam }) => timelineApi.list(patientId!, filters, pageParam, PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (lastPage.next ? allPages.length + 1 : undefined),
    enabled: patientId != null,
    staleTime: 15_000,
    retry: 1,
  })

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !hasNextPage) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting && !isFetchingNextPage) fetchNextPage() },
      { rootMargin: '200px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const events = useMemo(() => data?.pages.flatMap((p) => p.results) ?? [], [data])

  const groups = useMemo(() => {
    const out: { label: string; events: TimelineEvent[] }[] = []
    for (const ev of events) {
      const label = monthKey(ev.event_date, language)
      const last = out[out.length - 1]
      if (last && last.label === label) last.events.push(ev)
      else out.push({ label, events: [ev] })
    }
    return out
  }, [events, language])

  if (!patientId) return <CenteredSpinner />

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('nav.timeline') }]} />
      {/* PatientShell already renders this same title (hidden lg:block) in its
          own sticky header — shown only below lg so the two never duplicate. */}
      <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>
        {t('nav.timeline')}
      </h1>
      <div className="mt-1 mb-6">
        <p className="text-sm text-slate-500">{t('timeline.pageSubtitle')}</p>
      </div>

      <div className="patient-hide-scrollbar mb-4 flex items-center gap-2 overflow-x-auto pb-2">
        {CHIPS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setActiveChip(c.key)}
            className={
              activeChip === c.key
                ? 'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-[#0D9488] bg-[#0D9488] px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all sm:text-sm'
                : 'cursor-pointer shrink-0 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800 sm:text-sm'
            }
          >
            {t(`timeline.chip.${c.key}`)}
          </button>
        ))}
      </div>

      <div className="relative z-30 mb-6 flex flex-wrap items-center gap-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 sm:text-sm">
          <span className="shrink-0">{t('timeline.dateFrom')}</span>
          <DateFilterPicker
            value={dateFrom}
            max={dateTo || undefined}
            onChange={setDateFrom}
            locale={language}
            placeholder={t('timeline.dateFrom')}
          />
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 sm:text-sm">
          <span className="shrink-0">{t('timeline.dateTo')}</span>
          <DateFilterPicker
            value={dateTo}
            min={dateFrom || undefined}
            onChange={setDateTo}
            locale={language}
            placeholder={t('timeline.dateTo')}
          />
        </div>
      </div>

      {isLoading ? (
        <CenteredSpinner />
      ) : isError ? (
        <EmptyTimelineState text={t('timeline.loadError')} />
      ) : events.length === 0 ? (
        <EmptyTimelineState text={t('timeline.noEvents')} />
      ) : (
        <div className="relative my-6 ms-4 space-y-6 border-s-2 border-slate-100 ps-6">
          {groups.map((group) => (
            <div key={group.label}>
              <div className="mb-3 text-sm font-bold uppercase tracking-wider text-[#0D9488]">{group.label}</div>
              <div className="space-y-3">
                {group.events.map((ev) => (
                  <EventRow key={ev.id} event={ev} />
                ))}
              </div>
            </div>
          ))}
          <div ref={sentinelRef} className="flex justify-center py-2">
            {isFetchingNextPage && <Spinner size={22} />}
          </div>
        </div>
      )}
    </div>
  )
}
