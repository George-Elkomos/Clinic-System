import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Button } from '../../components/primitives/Button'
import { Card } from '../../components/primitives/Card'
import { useConfirm } from '../../components/primitives/ConfirmDialog'
import { FormField } from '../../components/primitives/FormField'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { StarRating } from '../../components/primitives/StarRating'
import { StatusBadge } from '../../components/primitives/StatusBadge'
import { useToast } from '../../components/primitives/Toast'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDateTime, formatTime } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { appointmentsApi } from '../../services/appointments.api'
import { followupsApi } from '../../services/followups.api'
import { reviewsApi } from '../../services/reviews.api'
import { waitlistApi } from '../../services/waitlist.api'
import type { Appointment } from '../../services/types'

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
    <div className="appt-review-box">
      <FormField label={t('reviews.yourRating')}>
        {() => <div><StarRating value={rating} onChange={setRating} /></div>}
      </FormField>
      <FormField label={t('reviews.comment')}>
        {(p) => <textarea {...p} rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />}
      </FormField>
      <Button loading={submit.isPending} onClick={() => submit.mutate()}>{t('reviews.submit')}</Button>
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

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('appointments.myTitle') }]} />
      <h1>{t('appointments.myTitle')}</h1>

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

      {isLoading ? (
        <CenteredSpinner />
      ) : appointments.length === 0 ? (
        <Card><p>{t('appointments.none')}</p></Card>
      ) : (
        appointments.map((a) => (
          <Card key={a.id}>
            <div className="appt-list-row appt-list-row--card">
              <div className="appt-list-info">
                <h3 className="appt-list-name">{a.doctor_name}</h3>
                <div className="appt-list-meta">{formatDateTime(a.scheduled_start, language)}</div>
                {a.reason && <div className="appt-list-reason">{t('appointments.reason')}: {a.reason}</div>}
              </div>
              <div className="appt-list-actions">
                <StatusBadge status={a.status} />
                {['PENDING', 'CONFIRMED'].includes(a.status) && (
                  <Button variant="danger" onClick={() => onCancel(a)} loading={cancel.isPending && cancel.variables === a.id}>
                    {t('appointments.cancel')}
                  </Button>
                )}
                {a.status === 'COMPLETED' && !reviewedIds.has(a.id) && reviewingId !== a.id && (
                  <Button variant="secondary" onClick={() => setReviewingId(a.id)}>{t('reviews.leaveReview')}</Button>
                )}
              </div>
            </div>
            {reviewingId === a.id && <LeaveReviewBox appointmentId={a.id} onDone={() => setReviewingId(null)} />}
          </Card>
        ))
      )}

      {waitlist.length > 0 && (
        <Card title={t('waitlist.title')}>
          {waitlist.map((w) => (
            <div key={w.id} className="appt-list-row">
              <div className="appt-list-info">
                <strong>{w.doctor_name}</strong>
                <div className="appt-list-meta">
                  {w.status === 'NOTIFIED' ? t('waitlist.statusNotified') : t('waitlist.statusWaiting')}
                </div>
              </div>
              <Button variant="danger" onClick={() => onLeaveWaitlist(w.id)}>{t('waitlist.leave')}</Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
