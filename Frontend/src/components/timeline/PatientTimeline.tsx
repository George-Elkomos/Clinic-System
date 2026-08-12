import { useInfiniteQuery } from '@tanstack/react-query'
import { History } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CustomDatePicker } from '../primitives/CustomDatePicker'
import { CenteredSpinner, Spinner } from '../primitives/Spinner'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate, formatDateTime } from '../../lib/format'
import { timelineApi } from '../../services/timeline.api'
import type { TimelineEvent, TimelineEventType } from '../../services/types'

const PAGE_SIZE = 20

// ---- Prescription item helpers ---------------------------------------------

interface RxItem {
  drug_name: string
  dosage?: string
  frequency?: string
  duration?: string
}

// Matches ISO 8601 datetime strings: "2026-06-13T10:30:00Z", "2026-06-13T10:30:00+03:00", etc.
function isISODatetime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)
}

function parsePrescriptionItems(value: unknown): RxItem[] | null {
  // Already an array of objects with drug_name — the normal case.
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === 'object' &&
    value[0] !== null &&
    'drug_name' in value[0]
  ) {
    return value as RxItem[]
  }
  // Legacy / edge-case: the field arrived as a JSON string instead of a parsed array.
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      if (
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        typeof parsed[0] === 'object' &&
        parsed[0] !== null &&
        'drug_name' in parsed[0]
      ) {
        return parsed as RxItem[]
      }
    } catch {
      // Not valid JSON — fall through and render as plain text.
    }
  }
  return null
}

// Chip → which event types it selects. `null` means "all".
const CHIPS: { key: string; types: TimelineEventType[] | null }[] = [
  { key: 'all', types: null },
  { key: 'vitals', types: ['VITAL_SIGNS'] },
  { key: 'labs', types: ['LAB_ORDER'] },
  { key: 'prescriptions', types: ['PRESCRIPTION'] },
  { key: 'notes', types: ['CLINICAL_NOTE'] },
  { key: 'records', types: ['MEDICAL_RECORD'] },
  { key: 'appointments', types: ['APPOINTMENT_COMPLETED'] },
]

// Fields whose values are always English medical data — force LTR even in Arabic UI.
const LTR_FIELDS = new Set([
  'diagnosis', 'chief_complaint', 'treatment_plan',
  'body', 'clinical_notes', 'notes', 'doctor_name', 'reason',
])

// Maps an event type to its left indicator border color.
const BORDER_COLOR: Record<TimelineEventType, string> = {
  VITAL_SIGNS: 'border-s-violet-500',
  LAB_ORDER: 'border-s-blue-500',
  PRESCRIPTION: 'border-s-emerald-500',
  CLINICAL_NOTE: 'border-s-slate-400',
  MEDICAL_RECORD: 'border-s-slate-400',
  APPOINTMENT_COMPLETED: 'border-s-slate-400',
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
        bp: d.bp_systolic ?? '—', dbp: d.bp_diastolic ?? '—',
        hr: d.heart_rate ?? '—', temp: d.temperature ?? '—',
      })
    case 'LAB_ORDER':
      return t('timeline.event.LAB_ORDER.summary', {
        order_number: d.order_number ?? '—',
        status: d.status ? t(`timeline.status.${String(d.status)}`, { defaultValue: String(d.status) }) : '—',
      })
    case 'PRESCRIPTION':
      return t('timeline.event.PRESCRIPTION.summary', {
        count: Array.isArray(d.items) ? d.items.length : 0,
      })
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
  const rows = Object.entries(event.detail).filter(
    ([, v]) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0),
  )

  if (rows.length === 0) {
    return <p className="mt-2 text-xs text-slate-400">{t('timeline.noDetail')}</p>
  }

  return (
    <div className="mt-2 overflow-x-auto rounded-xl border border-slate-100">
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
                  if (key === 'status' && typeof value === 'string') {
                    return t(`timeline.status.${value}`, { defaultValue: value })
                  }
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

function EventCard({ event }: { event: TimelineEvent }) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const [open, setOpen] = useState(false)

  return (
    <div className={`overflow-hidden rounded-2xl border border-slate-100 border-s-4 bg-white shadow-sm transition-all hover:shadow-md ${BORDER_COLOR[event.event_type]}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 border-none bg-transparent p-4 text-start sm:p-5"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-900 sm:text-base">{getEventTitle(event, t)}</div>
          <div className="mt-0.5 truncate text-xs text-slate-600 sm:text-sm">{getEventSummary(event, t)}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-slate-500">
          <span>{event.event_date ? formatDate(event.event_date, language) : ''}</span>
          <span aria-hidden="true" className={`text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
          <EventDetailTable event={event} />
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

export function PatientTimeline({ patientId }: { patientId: number }) {
  const { t } = useTranslation()
  const { language } = useLanguage()
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

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['timeline', patientId, filters],
      queryFn: ({ pageParam }) => timelineApi.list(patientId, filters, pageParam, PAGE_SIZE),
      initialPageParam: 1,
      getNextPageParam: (lastPage, allPages) =>
        lastPage.next ? allPages.length + 1 : undefined,
      staleTime: 15_000,
      retry: 1,
    })

  // Infinite scroll: fetch the next page when the sentinel scrolls into view.
  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !hasNextPage) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingNextPage) fetchNextPage()
      },
      { rootMargin: '200px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const events = useMemo(() => data?.pages.flatMap((p) => p.results) ?? [], [data])

  // Group consecutive events under a "Month YYYY" sticky header.
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-slate-100 pb-4 mb-2 lg:flex-row lg:items-center">
        <div className="patient-hide-scrollbar flex min-w-0 items-center gap-2 overflow-x-auto pb-1 lg:flex-1">
          {CHIPS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setActiveChip(c.key)}
              className={
                activeChip === c.key
                  ? 'shrink-0 whitespace-nowrap rounded-xl border border-[#0B7A70] bg-[#0D9488] px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all sm:text-sm'
                  : 'shrink-0 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 transition-all hover:bg-slate-50 sm:text-sm'
              }
            >
              {t(`timeline.chip.${c.key}`)}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 sm:text-sm">
            <span className="shrink-0">{t('timeline.dateFrom')}</span>
            <CustomDatePicker value={dateFrom} max={dateTo || undefined} onChange={setDateFrom} placeholder={t('timeline.dateFrom')} />
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 sm:text-sm">
            <span className="shrink-0">{t('timeline.dateTo')}</span>
            <CustomDatePicker value={dateTo} min={dateFrom || undefined} onChange={setDateTo} placeholder={t('timeline.dateTo')} />
          </div>
        </div>
      </div>

      {isLoading ? (
        <CenteredSpinner />
      ) : isError ? (
        <EmptyTimelineState text={t('timeline.loadError')} />
      ) : events.length === 0 ? (
        <EmptyTimelineState text={t('timeline.noEvents')} />
      ) : (
        <>
          {groups.map((group) => (
            <section key={group.label} className="flex flex-col gap-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-[#0D9488]">{group.label}</h3>
              {group.events.map((ev) => (
                <EventCard key={ev.id} event={ev} />
              ))}
            </section>
          ))}
          <div ref={sentinelRef} className="flex justify-center py-2">
            {isFetchingNextPage && <Spinner size={22} />}
          </div>
        </>
      )}
    </div>
  )
}
