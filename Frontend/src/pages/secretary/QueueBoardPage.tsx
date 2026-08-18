import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { OverrideWarningModal } from '../../components/OverrideWarningModal'
import { ReliabilityBadge } from '../../components/ReliabilityBadge'
import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { FormField } from '../../components/primitives/FormField'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner, Spinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { useLanguage } from '../../hooks/useLanguage'
import { formatTime } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { appointmentsApi } from '../../services/appointments.api'
import { doctorsApi } from '../../services/doctors.api'
import type { Appointment } from '../../services/types'
import { PatientProfileEditorModal } from './PatientProfileEditorModal'
import { RegisterPatientModal } from './RegisterPatientModal'

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all disabled:opacity-60 sm:text-sm'
const BTN_SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-60 sm:text-sm'
const BTN_SECONDARY_SM = 'inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-60'

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200/60',
  CONFIRMED: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  CHECKED_IN: 'bg-teal-50 text-teal-700 border-teal-200/60',
  IN_PROGRESS: 'bg-sky-50 text-sky-700 border-sky-200/60',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  CANCELLED: 'bg-slate-50 text-slate-500 border-slate-200/60',
  NO_SHOW: 'bg-slate-50 text-slate-500 border-slate-200/60',
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export function QueueBoardPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { showToast } = useToast()
  const qc = useQueryClient()
  const [doctorId, setDoctorId] = useState<number | ''>('')
  const [patientSearch, setPatientSearch] = useState('')
  const [walkInPatient, setWalkInPatient] = useState<number | ''>('')
  const [emergency, setEmergency] = useState(false)
  const [registeringPatient, setRegisteringPatient] = useState(false)
  const [editingProfile, setEditingProfile] = useState<number | null>(null)
  const [pendingWalkInWarning, setPendingWalkInWarning] = useState(false)

  const { data: doctors } = useQuery({ queryKey: ['doctors'], queryFn: () => doctorsApi.list() })
  const selectedDoctor = (doctors?.results ?? []).find((d) => d.id === Number(doctorId))

  const { data: queue, isLoading } = useQuery({
    queryKey: ['queue', doctorId],
    queryFn: () => appointmentsApi.list({ doctor: Number(doctorId), date: todayISO() }),
    enabled: doctorId !== '',
    refetchInterval: 20_000,
  })

  const { data: patients = [] } = useQuery({
    queryKey: ['patient-directory', patientSearch],
    queryFn: () => appointmentsApi.patients(patientSearch || undefined),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['queue', doctorId] })

  const addWalkIn = useMutation({
    mutationFn: (override?: string) =>
      appointmentsApi.walkIn({
        patient: Number(walkInPatient),
        doctor: Number(doctorId),
        emergency,
        ...(override !== undefined ? { override: true, override_reason: override } : {}),
      }),
    onSuccess: () => {
      showToast(t('queue.added'), 'success')
      setWalkInPatient('')
      setEmergency(false)
      setPendingWalkInWarning(false)
      invalidate()
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const handleAddWalkIn = () => {
    if (selectedDoctor && !selectedDoctor.accepts_walk_ins) {
      setPendingWalkInWarning(true)
      return
    }
    addWalkIn.mutate(undefined)
  }

  const transition = useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'checkIn' | 'start' | 'complete' | 'markEmergency' }) =>
      appointmentsApi[action](id),
    onSuccess: () => invalidate(),
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const nextAction = (a: Appointment) => {
    if (a.status === 'CONFIRMED') return { action: 'checkIn' as const, label: t('appointments.checkIn') }
    if (a.status === 'CHECKED_IN') return { action: 'start' as const, label: t('appointments.start') }
    if (a.status === 'IN_PROGRESS') return { action: 'complete' as const, label: t('appointments.complete') }
    return null
  }

  const handleTransition = (a: Appointment, action: 'checkIn' | 'start' | 'complete' | 'markEmergency') => {
    // The backend rejects completing a visit with no documented clinical
    // encounter (Finding #3) — catch the common case client-side so the
    // desk gets a clear pointer instead of a raw error after clicking.
    if (action === 'complete' && a.encounter_id == null) {
      showToast(t('queue.completeNoEncounterBlocked'), 'error')
      return
    }
    transition.mutate({ id: a.id, action })
  }

  const rows = (queue?.results ?? [])
    .filter((a) => ['CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'].includes(a.status))
    .sort((a, b) => b.priority - a.priority || a.scheduled_start.localeCompare(b.scheduled_start))

  // Pending bookings never show in the queue below (there's nothing to check
  // in yet) -- surface a hint so the desk doesn't quietly disappear from view
  // and get mistaken for "not booked", which used to push people toward
  // "Add walk-in" as a workaround instead of confirming the real booking.
  const pendingCount = (queue?.results ?? []).filter((a) => a.status === 'PENDING').length

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[{ label: t('queue.title') }]} />
        <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>{t('queue.title')}</h1>
      </div>

      <div className={CARD}>
        <FormField label={t('queue.selectDoctor')}>
          {(p) => (
            <Select
              id={p.id}
              options={(doctors?.results ?? []).map((d) => ({ value: d.id, label: d.full_name }))}
              value={doctorId}
              onChange={(value) => setDoctorId(value === '' ? '' : Number(value))}
              searchable
            />
          )}
        </FormField>
      </div>

      {doctorId !== '' && (
        <>
          <div className={CARD}>
            <h2 className="patient-text-card-title mb-3" style={{ color: 'var(--text-primary)' }}>{t('queue.addWalkIn')}</h2>
            <FormField label={t('queue.searchPatient')}>
              {(p) => <input {...p} className="patient-field" value={patientSearch} onChange={(e) => setPatientSearch(e.target.value)} />}
            </FormField>
            <FormField label={t('appointments.patient')}>
              {(p) => (
                <Select
                  id={p.id}
                  options={patients.map((pt) => ({ value: pt.id, label: pt.full_name || pt.email || String(pt.id) }))}
                  value={walkInPatient}
                  onChange={(v) => setWalkInPatient(Array.isArray(v) || v === '' ? '' : Number(v))}
                  placeholder="—"
                  searchable
                />
              )}
            </FormField>
            <label className="patient-text-body mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <input type="checkbox" checked={emergency} onChange={(e) => setEmergency(e.target.checked)} />
              {t('queue.emergency')}
            </label>
            <div className="flex flex-wrap gap-3">
              <button type="button" disabled={addWalkIn.isPending || !walkInPatient} onClick={handleAddWalkIn} className={BTN_PRIMARY}>
                {addWalkIn.isPending && <Spinner size={14} />}{t('queue.addWalkIn')}
              </button>
              <button type="button" onClick={() => setRegisteringPatient(true)} className={BTN_SECONDARY}>{t('patients.register')}</button>
              {walkInPatient !== '' && (
                <button type="button" onClick={() => setEditingProfile(Number(walkInPatient))} className={BTN_SECONDARY}>{t('patients.editProfile')}</button>
              )}
            </div>
          </div>

          {pendingCount > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
              <span className="patient-text-body" style={{ color: 'var(--text-primary)' }}>{t('queue.pendingHint', { count: pendingCount })}</span>
              <Link to="/secretary/desk"><button type="button" className={BTN_SECONDARY_SM}>{t('nav.appointmentDesk')}</button></Link>
            </div>
          )}

          <div className={CARD}>
            <h2 className="patient-text-card-title mb-3" style={{ color: 'var(--text-primary)' }}>{t('queue.title')}</h2>
            {isLoading ? <CenteredSpinner /> : rows.length === 0 ? (
              <p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{t('queue.noQueue')}</p>
            ) : (
              <div className="flex flex-col divide-y divide-slate-100">
                {rows.map((a) => {
                  const action = nextAction(a)
                  return (
                    <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div>
                        <span className="patient-text-body font-semibold" style={{ color: 'var(--text-primary)' }}>{a.patient_name}</span>
                        <ReliabilityBadge reliability={a.patient_reliability} className="ms-2" />
                        {a.appointment_type === 'EMERGENCY' && (
                          <span className="ms-2 rounded-full border border-rose-200/60 bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700">{t('queue.emergency')}</span>
                        )}
                        {a.appointment_type === 'WALK_IN' && (
                          <span className="ms-2 rounded-full border border-slate-200/60 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-600">{t('kiosk.walkIn')}</span>
                        )}
                        <div className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{formatTime(a.scheduled_start, language)}</div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_BADGE[a.status] ?? STATUS_BADGE.CANCELLED}`}>
                          {t(`status.${a.status}`)}
                        </span>
                        {a.appointment_type !== 'EMERGENCY' && (
                          <button type="button" onClick={() => transition.mutate({ id: a.id, action: 'markEmergency' })} className={BTN_SECONDARY_SM}>
                            {t('queue.markEmergency')}
                          </button>
                        )}
                        {action && (
                          <button type="button" onClick={() => handleTransition(a, action.action)} className={BTN_PRIMARY}>
                            {action.label}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      {registeringPatient && (
        <RegisterPatientModal
          onClose={() => setRegisteringPatient(false)}
          onCreated={(profileId) => {
            setRegisteringPatient(false)
            setEditingProfile(profileId)
          }}
        />
      )}

      {editingProfile !== null && (
        <PatientProfileEditorModal
          profileId={editingProfile}
          onClose={() => setEditingProfile(null)}
        />
      )}

      {pendingWalkInWarning && selectedDoctor && (
        <OverrideWarningModal
          title={t('queue.addWalkIn')}
          message={t('overrideModal.walkInWarning', { name: selectedDoctor.full_name })}
          loading={addWalkIn.isPending}
          onCancel={() => setPendingWalkInWarning(false)}
          onConfirm={(reason) => addWalkIn.mutate(reason)}
        />
      )}
    </div>
  )
}
