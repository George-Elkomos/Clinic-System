import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Button } from '../../components/primitives/Button'
import { Card } from '../../components/primitives/Card'
import { FormField } from '../../components/primitives/FormField'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { StatusBadge } from '../../components/primitives/StatusBadge'
import { useToast } from '../../components/primitives/Toast'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDateTime } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { appointmentsApi } from '../../services/appointments.api'
import { followupsApi } from '../../services/followups.api'
import type { Appointment, AppointmentStatus } from '../../services/types'

const STATUSES: AppointmentStatus[] = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function FollowUpBox({ appointmentId, onDone }: { appointmentId: number; onDone: () => void }) {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const [date, setDate] = useState(todayISO())
  const [notes, setNotes] = useState('')

  const create = useMutation({
    mutationFn: () => followupsApi.create(appointmentId, date, notes),
    onSuccess: () => { showToast(t('followups.created'), 'success'); onDone() },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  return (
    <div className="appt-followup-box">
      <FormField label={t('followups.recommendedDate')}>
        {(p) => <input {...p} type="date" min={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />}
      </FormField>
      <FormField label={t('followups.notes')}>
        {(p) => <input {...p} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </FormField>
      <Button loading={create.isPending} onClick={() => create.mutate()}>{t('followups.create')}</Button>
    </div>
  )
}

export function DoctorAppointmentsPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { showToast } = useToast()
  const qc = useQueryClient()
  const [status, setStatus] = useState<string>('')
  const [followUpId, setFollowUpId] = useState<number | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['appointments', 'doctor', status],
    queryFn: () => appointmentsApi.list(status ? { status } : undefined),
  })

  // Always-on query — IN_PROGRESS appointments are pinned regardless of the status filter.
  const { data: inProgressData } = useQuery({
    queryKey: ['appointments', 'doctor', 'in-progress-pinned'],
    queryFn: () => appointmentsApi.list({ status: 'IN_PROGRESS' }),
    refetchInterval: 15_000,
  })
  const pinnedRows = inProgressData?.results ?? []
  const pinnedIds = new Set(pinnedRows.map((a) => a.id))

  const transition = useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'checkIn' | 'start' | 'complete' }) =>
      appointmentsApi[action](id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['appointments'] }),
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const nextAction = (a: Appointment) => {
    if (a.status === 'CONFIRMED') return { action: 'checkIn' as const, label: t('appointments.checkIn') }
    if (a.status === 'CHECKED_IN') return { action: 'start' as const, label: t('appointments.start') }
    if (a.status === 'IN_PROGRESS') return { action: 'complete' as const, label: t('appointments.complete') }
    return null
  }

  // Exclude appointments already shown in the pinned section to avoid duplication.
  const rows = (data?.results ?? []).filter((a) => !pinnedIds.has(a.id))

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('nav.appointments') }]} />
      <h1>{t('appointments.title')}</h1>

      {pinnedRows.length > 0 && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 'var(--space-2)', color: 'var(--color-primary)' }}>
            {t('encounters.activeEncounters')}
          </h2>
          {pinnedRows.map((a) => (
            <div key={a.id} style={{ borderInlineStart: '3px solid var(--color-primary)', borderRadius: 'var(--radius-md)', overflow: 'hidden', marginBottom: 'var(--space-2)' }}>
              <Card>
                <div className="appt-card__row">
                  <div className="appt-card__info">
                    <h3 className="appt-card__name">{a.patient_name}</h3>
                    <div className="appt-card__date">{formatDateTime(a.scheduled_start, language)}</div>
                  </div>
                  <div className="appt-card__actions">
                    <StatusBadge status={a.status} />
                    <Link to={`/doctor/encounters/${a.id}`}>
                      <Button>🩻 {t('encounters.open')}</Button>
                    </Link>
                  </div>
                </div>
              </Card>
            </div>
          ))}
        </div>
      )}

      <div className="appt-filter-wrap">
        <Card>
          <FormField label={t('appointments.status')}>
            {(p) => (
              <Select
                id={p.id}
                options={[
                  { value: '', label: t('appointments.filterAll') },
                  ...STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) })),
                ]}
                value={status}
                onChange={(v) => setStatus(Array.isArray(v) ? '' : String(v))}
              />
            )}
          </FormField>
        </Card>
      </div>

      {isLoading ? (
        <CenteredSpinner />
      ) : rows.length === 0 ? (
        <Card><p>{t('appointments.noResults')}</p></Card>
      ) : (
        rows.map((a) => {
          const action = nextAction(a)
          return (
            <Card key={a.id}>
              <div className="appt-card__row">
                <div className="appt-card__info">
                  <h3 className="appt-card__name">{a.patient_name}</h3>
                  <div className="appt-card__date">{formatDateTime(a.scheduled_start, language)}</div>
                </div>
                <div className="appt-card__actions">
                  <StatusBadge status={a.status} />
                  {a.status === 'IN_PROGRESS' && (
                    <Link to={`/doctor/encounters/${a.id}`}>
                      <Button>🩻 {t('encounters.open')}</Button>
                    </Link>
                  )}
                  {action && (
                    <Button onClick={() => transition.mutate({ id: a.id, action: action.action })}>
                      {action.label}
                    </Button>
                  )}
                  {a.status === 'COMPLETED' && followUpId !== a.id && (
                    <Button variant="secondary" onClick={() => setFollowUpId(a.id)}>{t('followups.create')}</Button>
                  )}
                </div>
              </div>
              {followUpId === a.id && <FollowUpBox appointmentId={a.id} onDone={() => setFollowUpId(null)} />}
            </Card>
          )
        })
      )}
    </div>
  )
}
