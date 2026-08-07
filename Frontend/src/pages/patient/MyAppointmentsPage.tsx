import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Calendar, Clock, Star } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Button } from '../../components/primitives/Button'
import { Card } from '../../components/primitives/Card'
import { useConfirm } from '../../components/primitives/ConfirmDialog'
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
}

// Doctor initials for the avatar fallback circle — strips a leading "Dr."
// so e.g. "Dr. Sarah Johnson" reads as "SJ", not "DS".
function doctorInitials(name: string) {
  const parts = name.replace(/^Dr\.?\s+/i, '').trim().split(/\s+/).filter(Boolean)
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('')
}

type ApptFilter = 'all' | 'upcoming' | 'completed'
const UPCOMING_STATUSES: AppointmentStatus[] = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS']

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
          className="h-20 w-full resize-none rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-800 transition-all focus:border-[#3BC9CB] focus:outline-none"
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

  const onCancel = async (a: Appointment) => {
    const ok = await confirm({
      title: t('appointments.cancel'),
      message: t('appointments.cancelConfirm', { name: a.doctor_name, when: formatDateTime(a.scheduled_start, language) }),
      confirmLabel: t('appointments.cancel'), danger: true,
    })
    if (ok) cancel.mutate(a.id)
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
    if (filter === 'completed') return a.status === 'COMPLETED'
    return true
  })
  const FILTERS: { key: ApptFilter; label: string }[] = [
    { key: 'all', label: t('appointments.filterAll') },
    { key: 'upcoming', label: t('appointments.filterUpcoming') },
    { key: 'completed', label: t('appointments.filterCompleted') },
  ]

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs trail={[{ label: t('appointments.myTitle') }]} />
        <h1>{t('appointments.myTitle')}</h1>
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
        <div className="mb-4 inline-flex gap-1 rounded-xl bg-slate-100 p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={
                filter === f.key
                  ? 'rounded-xl border border-slate-200/60 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm'
                  : 'rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700'
              }
            >
              {f.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <CenteredSpinner />
        ) : appointments.length === 0 ? (
          <Card><p>{t('appointments.none')}</p></Card>
        ) : filteredAppointments.length === 0 ? (
          <Card><p>{t('appointments.noResults')}</p></Card>
        ) : (
          <div className="flex flex-col gap-3">
          {filteredAppointments.map((a) => {
          const start = new Date(a.scheduled_start)
          const dateLabel = new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', year: 'numeric' }).format(start)
          const timeLabel = new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' }).format(start)
          const canCancel = ['PENDING', 'CONFIRMED'].includes(a.status)
          const canReview = a.status === 'COMPLETED' && !reviewedIds.has(a.id) && reviewingId !== a.id
          return (
            <div key={a.id} className="flex flex-col">
              <div className="flex flex-col gap-3 rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">
                    {doctorInitials(a.doctor_name)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold text-slate-800">{a.doctor_name}</div>
                    <div className="truncate text-xs text-slate-500">{a.type_display}</div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-4 sm:gap-6">
                  <div className="flex items-center gap-2 whitespace-nowrap text-xs font-medium text-slate-600">
                    <Calendar size={14} className="text-slate-400" />
                    {dateLabel}
                  </div>
                  <div className="flex items-center gap-2 whitespace-nowrap text-xs font-medium text-slate-600">
                    <Clock size={14} className="text-slate-400" />
                    {timeLabel}
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${STATUS_BADGE[a.status] ?? STATUS_BADGE.CANCELLED}`}
                  >
                    {t(`status.${a.status}`)}
                  </span>
                  {canCancel && (
                    <button
                      type="button"
                      onClick={() => onCancel(a)}
                      disabled={cancel.isPending && cancel.variables === a.id}
                      className="h-9 rounded-xl border border-rose-200 bg-rose-50/50 px-4 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-100"
                    >
                      {t('appointments.cancel')}
                    </button>
                  )}
                  {canReview && (
                    <button
                      type="button"
                      onClick={() => setReviewingId(a.id)}
                      className="h-9 rounded-xl border border-sky-200 bg-sky-50/50 px-4 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-100"
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
                className="mb-3 flex flex-col gap-3 rounded-2xl border border-[#F3F4F6] bg-white p-4 shadow-sm last:mb-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">
                    {doctorInitials(w.doctor_name)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-800">{w.doctor_name}</div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <Calendar size={13} className="text-slate-400" />
                      {rangeLabel}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${badgeClass}`}>
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
    </div>
  )
}
