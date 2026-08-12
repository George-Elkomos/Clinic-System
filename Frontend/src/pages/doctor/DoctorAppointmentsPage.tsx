import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { CustomDatePicker } from '../../components/primitives/CustomDatePicker'
import { FormField } from '../../components/primitives/FormField'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner, Spinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDateTime } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { appointmentsApi } from '../../services/appointments.api'
import { followupsApi } from '../../services/followups.api'
import type { Appointment, AppointmentStatus } from '../../services/types'

const STATUSES: AppointmentStatus[] = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']

const STATUS_BADGE: Record<AppointmentStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200/60',
  CONFIRMED: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  CHECKED_IN: 'bg-teal-50 text-teal-700 border-teal-200/60',
  IN_PROGRESS: 'bg-sky-50 text-sky-700 border-sky-200/60',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  CANCELLED: 'bg-slate-50 text-slate-500 border-slate-200/60',
  NO_SHOW: 'bg-slate-50 text-slate-500 border-slate-200/60',
}

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#1AB5B3] to-[#38E4DD] px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-95 disabled:opacity-60'
const BTN_SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 transition-all hover:border-[#0D9488] hover:text-[#0D9488] disabled:opacity-60'

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function StatusPill({ status }: { status: AppointmentStatus }) {
  const { t } = useTranslation()
  return (
    <span className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_BADGE[status] ?? STATUS_BADGE.CANCELLED}`}>
      {t(`status.${status}`)}
    </span>
  )
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
    <div className="mt-3 space-y-3 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
      <FormField label={t('followups.recommendedDate')}>
        {(p) => <CustomDatePicker {...p} variant="field" allowClear={false} min={todayISO()} value={date} onChange={setDate} />}
      </FormField>
      <FormField label={t('followups.notes')}>
        {(p) => <input {...p} className="patient-field" value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </FormField>
      <button type="button" disabled={create.isPending} onClick={() => create.mutate()} className={BTN_PRIMARY}>
        {create.isPending && <Spinner size={14} />}{t('followups.create')}
      </button>
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

  const AppointmentCard = ({ a, pinned }: { a: Appointment; pinned?: boolean }) => {
    const action = nextAction(a)
    const pending = transition.isPending && transition.variables?.id === a.id
    return (
      <div className={pinned ? 'overflow-hidden rounded-2xl border-l-4 border-[#1AB5B3]' : undefined}>
        <div className={CARD}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h3 className="patient-text-card-title truncate" style={{ color: 'var(--text-primary)' }}>{a.patient_name}</h3>
              <div className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{formatDateTime(a.scheduled_start, language)}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={a.status} />
              {a.encounter_id != null && (
                <Link to={`/doctor/encounters/${a.id}`}>
                  <button type="button" className={a.status === 'IN_PROGRESS' ? BTN_PRIMARY : BTN_SECONDARY}>
                    🩻 {t(a.status === 'IN_PROGRESS' ? 'encounters.open' : 'encounters.view')}
                  </button>
                </Link>
              )}
              {action && (
                <button type="button" disabled={pending} onClick={() => transition.mutate({ id: a.id, action: action.action })} className={BTN_PRIMARY}>
                  {pending && <Spinner size={14} />}{action.label}
                </button>
              )}
              {a.status === 'COMPLETED' && followUpId !== a.id && (
                <button type="button" onClick={() => setFollowUpId(a.id)} className={BTN_SECONDARY}>{t('followups.create')}</button>
              )}
            </div>
          </div>
          {followUpId === a.id && <FollowUpBox appointmentId={a.id} onDone={() => setFollowUpId(null)} />}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[{ label: t('nav.appointments') }]} />
        <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>{t('appointments.title')}</h1>
      </div>

      {pinnedRows.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="patient-text-h2" style={{ color: 'var(--brand-teal-start)' }}>
            {t('encounters.activeEncounters')}
          </h2>
          {pinnedRows.map((a) => <AppointmentCard key={a.id} a={a} pinned />)}
        </div>
      )}

      <div className={CARD}>
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
      </div>

      {isLoading ? (
        <CenteredSpinner />
      ) : rows.length === 0 ? (
        <div className={CARD}><p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{t('appointments.noResults')}</p></div>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((a) => <AppointmentCard key={a.id} a={a} />)}
        </div>
      )}
    </div>
  )
}
