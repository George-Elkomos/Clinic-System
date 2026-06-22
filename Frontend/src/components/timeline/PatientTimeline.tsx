import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CenteredSpinner, Spinner } from '../primitives/Spinner'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate } from '../../lib/format'
import { timelineApi } from '../../services/timeline.api'
import type { TimelineEvent, TimelineEventType } from '../../services/types'

const PAGE_SIZE = 20

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

// Maps an event type to its CSS border modifier.
const BORDER_CLASS: Record<TimelineEventType, string> = {
  VITAL_SIGNS: 'timeline__event--vitals',
  LAB_ORDER: 'timeline__event--labs',
  PRESCRIPTION: 'timeline__event--rx',
  CLINICAL_NOTE: 'timeline__event--notes',
  MEDICAL_RECORD: 'timeline__event--notes',
  APPOINTMENT_COMPLETED: 'timeline__event--notes',
}

function monthKey(iso: string | null, locale: string): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(iso))
}

function EventCard({ event }: { event: TimelineEvent }) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const [open, setOpen] = useState(false)

  const detailRows = Object.entries(event.detail).filter(
    ([, v]) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0),
  )

  return (
    <div className={`timeline__event ${BORDER_CLASS[event.event_type]}`}>
      <button type="button" className="timeline__event-head" onClick={() => setOpen((o) => !o)}>
        <div className="timeline__event-main">
          <span className="timeline__event-title">{event.title}</span>
          <span className="timeline__event-summary">{event.summary}</span>
        </div>
        <div className="timeline__event-meta">
          <span>{event.event_date ? formatDate(event.event_date, language) : ''}</span>
          <span className="timeline__event-caret">{open ? '▾' : '▸'}</span>
        </div>
      </button>

      {open && (
        <div className="timeline__detail">
          {detailRows.length === 0 ? (
            <p className="timeline__detail-empty">{t('timeline.noDetail')}</p>
          ) : (
            <table className="timeline__detail-table">
              <tbody>
                {detailRows.map(([key, value]) => (
                  <tr key={key}>
                    <th>{t(`timeline.field.${key}`, key)}</th>
                    <td dir="auto">
                      {Array.isArray(value)
                        ? value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ')
                        : String(value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
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
    <div className="timeline">
      <div className="timeline__filters">
        <div className="timeline__chips">
          {CHIPS.map((c) => (
            <button
              key={c.key}
              type="button"
              className={`timeline-chip${activeChip === c.key ? ' timeline-chip--active' : ''}`}
              onClick={() => setActiveChip(c.key)}
            >
              {t(`timeline.chip.${c.key}`)}
            </button>
          ))}
        </div>
        <div className="timeline__dates">
          <label>
            {t('timeline.dateFrom')}
            <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label>
            {t('timeline.dateTo')}
            <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} />
          </label>
        </div>
      </div>

      {isLoading ? (
        <CenteredSpinner />
      ) : isError ? (
        <p className="timeline__empty">{t('timeline.loadError')}</p>
      ) : events.length === 0 ? (
        <p className="timeline__empty">{t('timeline.noEvents')}</p>
      ) : (
        <>
          {groups.map((group) => (
            <section key={group.label} className="timeline__group">
              <h3 className="timeline__month">{group.label}</h3>
              {group.events.map((ev) => (
                <EventCard key={ev.id} event={ev} />
              ))}
            </section>
          ))}
          <div ref={sentinelRef} className="timeline__sentinel">
            {isFetchingNextPage && <Spinner size={22} />}
          </div>
        </>
      )}
    </div>
  )
}
