import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Calendar, Clock, Star } from 'lucide-react'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Button } from '../../components/primitives/Button'
import { Card } from '../../components/primitives/Card'
import { useConfirm } from '../../components/primitives/ConfirmDialog'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { StatusBadge } from '../../components/primitives/StatusBadge'
import { useToast } from '../../components/primitives/Toast'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDateTime, formatTime } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { appointmentsApi } from '../../services/appointments.api'
import { followupsApi } from '../../services/followups.api'
import { reviewsApi } from '../../services/reviews.api'
import { waitlistApi } from '../../services/waitlist.api'
import type { Appointment, AppointmentStatus } from '../../services/types'

// Matches the Dashboard's Appointment Row badge language, extended to the
// three statuses that row never shows (PENDING/IN_PROGRESS/CANCELLED-family).
const STATUS_BADGE: Record<AppointmentStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200/60',
  CONFIRMED: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  CHECKED_IN: 'bg-teal-50 text-teal-700 border-teal-200/60',
  IN_PROGRESS: 'bg-sky-50 text-sky-700 border-sky-200/60',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  CANCELLED: 'bg-slate-50 text-slate-500 border-slate-200/60',
  NO_SHOW: 'bg-slate-50 text-slate-500 border-slate-200/60',
  EXPIRED: 'bg-slate-50 text-slate-500 border-slate-200/60',
}

// Doctor initials for the avatar fallback circle — strips a leading "Dr."
// so e.g. "Dr. Sarah Johnson" reads as "SJ", not "DS".
function doctorInitials(name: string) {
  const parts = name.replace(/^Dr\.?\s+/i, '').trim().split(/\s+/).filter(Boolean)
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('')
}

type ApptFilter = 'all' | 'upcoming' | 'history'
type ApptSort = 'newest' | 'oldest' | 'doctor'
const UPCOMING_STATUSES: AppointmentStatus[] = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS']
// Everything past/resolved — including auto-EXPIRED bookings — belongs in
// History, never in the active "upcoming" list.
const HISTORY_STATUSES: AppointmentStatus[] = ['COMPLETED', 'CANCELLED', 'EXPIRED', 'NO_SHOW']

function TodayStatusCard({ appt }: { appt: Appointment }) {
  const { t } = useTranslation()
  const { language } = useLanguage()

  const { data: pos } = useQuery({
    queryKey: ['queue-position', appt.id],
    queryFn: () => appointmentsApi.queuePosition(appt.id),
    refetchInterval: appt.status === 'CHECKED_IN' || appt.status === 'IN_PROGRESS' ? 30_000 : false,
    enabled: ['CHECKED_IN', 'CONFIRMED', 'IN_PROGRESS'].includes(appt.status),
  })

  const isActive = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'].includes(appt.status)
  if (!isActive) return null

  return (
    <div style={{
      background: 'var(--primary)',
      color: 'var(--on-primary)',
      borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-4) var(--space-5)',
      marginBottom: 'var(--space-4)',
    }}>
      <div style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.8, marginBottom: 'var(--space-1)' }}>
        {t('queue.yourStatus')}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 2 }}>{appt.doctor_name}</div>
          <div style={{ opacity: 0.85, fontSize: '0.9rem' }}>{formatTime(appt.scheduled_start, language)}</div>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <StatusBadge status={appt.status} />
          {appt.status === 'IN_PROGRESS' && (
            <div style={{ marginTop: 'var(--space-1)', fontSize: '0.9rem', opacity: 0.9 }}>{t('queue.youAreCurrent')}</div>
          )}
          {appt.status === 'CHECKED_IN' && pos && (
            <div style={{ marginTop: 'var(--space-1)', fontSize: '0.9rem' }}>
              {pos.position === 1
                ? t('queue.youAreNext')
                : t('queue.position', { pos: pos.position, total: pos.total_waiting })}
              {pos.estimated_wait_minutes > 0 && (
                <span style={{ opacity: 0.8, marginLeft: 6 }}>
                  · ~{pos.estimated_wait_minutes} {t('common.minutes')}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Scoped to this inline form only — the shared StarRating primitive (used by
// Doctor/Manager/Public review pages) isn't touched by this page's redesign.
function ReviewStars({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(0)

  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label={t('reviews.ratingLabel', { value, max: 5 })}>
      {[1, 2, 3, 4, 5].map((n) => {
        const active = n <= (hovered || value)
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            onMouseEnter={() => setHovered(n)}
            onMouseLeave={() => setHovered(0)}
            aria-label={t('reviews.starLabel', { n })}
            aria-pressed={n <= value}
            className="border-0 bg-transparent p-0"
          >
            <Star
              className={`h-6 w-6 cursor-pointer transition-transform hover:scale-110 ${
                active ? 'fill-amber-400 text-amber-400 drop-shadow-sm' : 'fill-slate-100 text-slate-300'
              }`}
            />
          </button>
        )
      })}
    </div>
  )
}

function LeaveReviewBox({ appointmentId, onDone }: { appointmentId: number; onDone: () => void }) {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const qc = useQueryClient()
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState('')

  const submit = useMutation({
    mutationFn: () => reviewsApi.create(appointmentId, rating, comment),
    onSuccess: () => {
      showToast(t('reviews.submitted'), 'success')
      qc.invalidateQueries({ queryKey: ['my-reviews'] })
      onDone()
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
      <div>
        <div className="mb-1.5 text-xs font-semibold text-slate-700">{t('reviews.yourRating')}</div>
        <ReviewStars value={rating} onChange={setRating} />
      </div>
      <div>
        <div className="mb-1.5 text-xs font-semibold text-slate-700">{t('reviews.comment')}</div>
        <textarea
          className="patient-field patient-field--compact h-20 resize-none"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>
      <button
        type="button"
        onClick={() => submit.mutate()}
        disabled={submit.isPending}
        className="inline-flex h-10 items-center justify-center rounded-xl bg-gradient-to-r from-[#0769AE] to-[#4B9AF0] px-6 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-95 disabled:opacity-60"
      >
        {t('reviews.submit')}
      </button>
    </div>
  )
}

export function MyAppointmentsPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const [reviewingId, setReviewingId] = useState<number | null>(null)
  const [filter, setFilter] = useState<ApptFilter>('all')
  const [sortBy, setSortBy] = useState<ApptSort>('newest')
  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null)

  const { data, isLoading } = useQuery({ queryKey: ['appointments', 'mine'], queryFn: () => appointmentsApi.list() })
  const { data: waitlist = [] } = useQuery({ queryKey: ['waitlist'], queryFn: () => waitlistApi.mine() })
  const { data: reviews = [] } = useQuery({ queryKey: ['my-reviews'], queryFn: () => reviewsApi.list() })
  const { data: followups = [] } = useQuery({ queryKey: ['my-followups'], queryFn: () => followupsApi.mine() })

  const reviewedIds = new Set(reviews.map((r) => r.appointment))
  const suggestedFollowups = followups.filter((f) => f.status === 'SUGGESTED')

  const cancel = useMutation({
    mutationFn: (id: number) => appointmentsApi.cancel(id),
    onSuccess: () => { showToast(t('appointments.cancelled'), 'success'); qc.invalidateQueries({ queryKey: ['appointments'] }) },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })
  const leaveWaitlist = useMutation({
    mutationFn: (id: number) => waitlistApi.cancel(id),
    onSuccess: () => { showToast(t('waitlist.left'), 'success'); qc.invalidateQueries({ queryKey: ['waitlist'] }) },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })
  const confirmFollowup = useMutation({
    mutationFn: (id: number) => followupsApi.confirm(id),
    onSuccess: () => { showToast(t('followups.confirmed'), 'success'); qc.invalidateQueries({ queryKey: ['my-followups'] }); qc.invalidateQueries({ queryKey: ['appointments'] }) },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })
  const dismissFollowup = useMutation({
    mutationFn: (id: number) => followupsApi.dismiss(id),
    onSuccess: () => { showToast(t('followups.dismissed'), 'success'); qc.invalidateQueries({ queryKey: ['my-followups'] }) },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const onCancel = (a: Appointment) => setCancelTarget(a)
  const confirmCancel = () => {
    if (!cancelTarget) return
    cancel.mutate(cancelTarget.id)
    setCancelTarget(null)
  }
  const onLeaveWaitlist = async (id: number) => {
    if (await confirm({ title: t('waitlist.leave'), message: t('waitlist.leaveConfirm'), danger: true })) leaveWaitlist.mutate(id)
  }

  const appointments = data?.results ?? []
  const todayISO = new Date().toISOString().slice(0, 10)
  const todayActive = appointments.find(
    (a) => a.scheduled_start.slice(0, 10) === todayISO &&
      ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'].includes(a.status)
  )
  const filteredAppointments = appointments.filter((a) => {
    if (filter === 'upcoming') return UPCOMING_STATUSES.includes(a.status)
    if (filter === 'history') return HISTORY_STATUSES.includes(a.status)
    return true
  })
  const sortedAppointments = [...filteredAppointments].sort((a, b) => {
    if (sortBy === 'doctor') return a.doctor_name.localeCompare(b.doctor_name)
    const diff = new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime()
    return sortBy === 'oldest' ? diff : -diff
  })
  const FILTERS: { key: ApptFilter; label: string }[] = [
    { key: 'all', label: t('appointments.filterAll') },
    { key: 'upcoming', label: t('appointments.filterUpcoming') },
    { key: 'history', label: t('appointments.filterHistory') },
  ]
  const SORTS: { key: ApptSort; label: string }[] = [
    { key: 'newest', label: t('appointments.sortNewest') },
    { key: 'oldest', label: t('appointments.sortOldest') },
    { key: 'doctor', label: t('appointments.sortDoctor') },
  ]

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs trail={[{ label: t('appointments.myTitle') }]} />
        {/* PatientShell already renders this same title (hidden lg:block) in its
            own sticky header — shown only below lg so the two never duplicate. */}
        <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>
          {t('appointments.myTitle')}
        </h1>
      </div>

      {todayActive && <TodayStatusCard appt={todayActive} />}

      {suggestedFollowups.length > 0 && (
        <Card title={t('followups.title')}>
          {suggestedFollowups.map((f) => (
            <div key={f.id} className="appt-list-row">
              <div className="appt-list-info">
                <strong>{f.doctor_name}</strong>
                <div className="appt-list-meta">
                  {f.suggested_start ? `${t('followups.suggestedTime')}: ${formatDateTime(f.suggested_start, language)}` : t('followups.noSlot')}
                </div>
              </div>
              <div className="appt-list-actions">
                {f.suggested_slot && f.suggested_start && new Date(f.suggested_start) > new Date() ? (
                  <Button
                    onClick={() => confirmFollowup.mutate(f.id)}
                    loading={confirmFollowup.isPending && confirmFollowup.variables === f.id}
                  >
                    {t('followups.confirm')}
                  </Button>
                ) : (
                  f.suggested_slot && <span className="appt-list-meta">{t('followups.expired')}</span>
                )}
                <Button variant="secondary" onClick={() => dismissFollowup.mutate(f.id)}>{t('followups.dismiss')}</Button>
              </div>
            </div>
          ))}
        </Card>
      )}

      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={
                  filter === f.key
                    ? 'rounded-xl border border-[#0B7A70] bg-[#0D9488] px-4 py-2 text-xs font-semibold text-white shadow-sm sm:text-sm'
                    : 'rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 transition-all hover:bg-slate-50 sm:text-sm'
                }
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="w-full sm:w-56">
            <label htmlFor="appt-sort" className="visually-hidden">{t('appointments.sortLabel')}</label>
            <Select
              id="appt-sort"
              options={SORTS.map((s) => ({ value: s.key, label: s.label }))}
              value={sortBy}
              onChange={(v) => {
                // Select always renders a clear (×) button once a value is set — not
                // appropriate for a sort control, which has no valid "unset" state.
                // Falling back to the default keeps sortedAppointments' logic (and the
                // dropdown's displayed label) always in a valid state.
                const next = Array.isArray(v) ? v[0] : v
                setSortBy((next || 'newest') as ApptSort)
              }}
            />
          </div>
        </div>

        {isLoading ? (
          <CenteredSpinner />
        ) : appointments.length === 0 ? (
          <Card><p>{t('appointments.none')}</p></Card>
        ) : filteredAppointments.length === 0 ? (
          <Card><p>{t('appointments.noResults')}</p></Card>
        ) : (
          <div className="flex flex-col gap-3">
          {sortedAppointments.map((a) => {
          const start = new Date(a.scheduled_start)
          const dateLabel = new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', year: 'numeric' }).format(start)
          const timeLabel = new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' }).format(start)
          const canCancel = ['PENDING', 'CONFIRMED'].includes(a.status)
          const canReview = a.status === 'COMPLETED' && !reviewedIds.has(a.id) && reviewingId !== a.id
          return (
            <div key={a.id} className="flex w-full flex-col overflow-hidden">
              <div className="flex w-full flex-col items-start justify-between gap-2 overflow-hidden rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:flex-row sm:items-center">
                <div className="flex min-w-0 items-center gap-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">
                    {doctorInitials(a.doctor_name)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold text-slate-800">{a.doctor_name}</div>
                    <div className="truncate text-xs text-slate-500">{t(`appointments.type.${a.appointment_type}`)}</div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-4 sm:gap-6">
                  <div className="flex items-center gap-2 whitespace-nowrap text-xs font-medium text-slate-600">
                    <Calendar size={14} className="shrink-0 text-slate-400" />
                    {dateLabel}
                  </div>
                  <div className="flex items-center gap-2 whitespace-nowrap text-xs font-medium text-slate-600">
                    <Clock size={14} className="shrink-0 text-slate-400" />
                    {timeLabel}
                  </div>
                  <span
                    className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_BADGE[a.status] ?? STATUS_BADGE.CANCELLED}`}
                  >
                    {t(`status.${a.status}`)}
                  </span>
                  {canCancel && (
                    <button
                      type="button"
                      onClick={() => onCancel(a)}
                      disabled={cancel.isPending && cancel.variables === a.id}
                      className="rounded-xl border-none bg-rose-50 px-3.5 py-1.5 text-xs font-medium text-rose-600 transition-all hover:bg-rose-100"
                    >
                      {t('appointments.cancel')}
                    </button>
                  )}
                  {canReview && (
                    <button
                      type="button"
                      onClick={() => setReviewingId(a.id)}
                      className="rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-all"
                    >
                      {t('reviews.leaveReview')}
                    </button>
                  )}
                </div>
              </div>
              {reviewingId === a.id && <LeaveReviewBox appointmentId={a.id} onDone={() => setReviewingId(null)} />}
            </div>
          )
          })}
          </div>
        )}
      </div>

      {waitlist.length > 0 && (
        <Card
          title={
            <span className="flex items-center">
              {t('waitlist.title')}
              <span className="ms-2 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                {waitlist.length}
              </span>
            </span>
          }
        >
          {waitlist.map((w) => {
            // Waitlist entries carry a desired date range, not a fixed slot —
            // there's no time component to pair a Clock icon with here.
            const rangeLabel = `${new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric' }).format(
              new Date(w.desired_date_from),
            )} – ${new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', year: 'numeric' }).format(
              new Date(w.desired_date_to),
            )}`
            const badgeClass =
              w.status === 'NOTIFIED'
                ? 'bg-sky-50 text-sky-700 border-sky-200/60'
                : 'bg-amber-50 text-amber-700 border-amber-200/60'
            return (
              <div
                key={w.id}
                className="mb-3 flex w-full flex-col items-start justify-between gap-2 overflow-hidden rounded-2xl border border-[#F3F4F6] bg-white p-4 shadow-sm last:mb-0 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 items-center gap-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">
                    {doctorInitials(w.doctor_name)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-800">{w.doctor_name}</div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <Calendar size={13} className="shrink-0 text-slate-400" />
                      <span className="truncate">{rangeLabel}</span>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass}`}>
                    {w.status === 'NOTIFIED' ? t('waitlist.statusNotified') : t('waitlist.statusWaiting')}
                  </span>
                  <button
                    type="button"
                    onClick={() => onLeaveWaitlist(w.id)}
                    disabled={leaveWaitlist.isPending && leaveWaitlist.variables === w.id}
                    className="h-9 rounded-xl border border-rose-200 bg-rose-50/50 px-4 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-100"
                  >
                    {t('waitlist.leave')}
                  </button>
                </div>
              </div>
            )
          })}
        </Card>
      )}

      {cancelTarget && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-appt-title"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setCancelTarget(null) }}
          onKeyDown={(e) => e.key === 'Escape' && setCancelTarget(null)}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
              <AlertTriangle className="h-6 w-6" aria-hidden="true" />
            </div>
            <h2 id="cancel-appt-title" className="appt-cancel-modal-title text-center font-bold text-slate-900">
              {t('appointments.cancel')}
            </h2>
            <p className="text-center text-sm text-slate-500">{t('appointments.cancelWarning')}</p>
            <div className="my-4 rounded-xl border border-slate-100 bg-slate-50 p-3 text-center text-sm text-slate-700">
              <Trans
                i18nKey="appointments.cancelDetails"
                values={{ name: cancelTarget.doctor_name, when: formatDateTime(cancelTarget.scheduled_start, language) }}
                components={{ b: <strong /> }}
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setCancelTarget(null)}
                className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-red-500/20"
              >
                {t('common.keep')}
              </button>
              <button
                type="button"
                onClick={confirmCancel}
                disabled={cancel.isPending}
                className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500/20 disabled:opacity-60"
              >
                {t('appointments.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
