import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Button } from '../../components/primitives/Button'
import { Card } from '../../components/primitives/Card'
import { FormField } from '../../components/primitives/FormField'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { StatusBadge } from '../../components/primitives/StatusBadge'
import { useToast } from '../../components/primitives/Toast'
import { useLanguage } from '../../hooks/useLanguage'
import { formatTime } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { appointmentsApi } from '../../services/appointments.api'
import { doctorsApi } from '../../services/doctors.api'
import type { Appointment } from '../../services/types'
import { PatientProfileEditorModal } from './PatientProfileEditorModal'
import { RegisterPatientModal } from './RegisterPatientModal'

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

  const { data: doctors } = useQuery({ queryKey: ['doctors'], queryFn: () => doctorsApi.list() })

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
    mutationFn: () => appointmentsApi.walkIn({ patient: Number(walkInPatient), doctor: Number(doctorId), emergency }),
    onSuccess: () => { showToast(t('queue.added'), 'success'); setWalkInPatient(''); setEmergency(false); invalidate() },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

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

  const rows = (queue?.results ?? [])
    .filter((a) => ['CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'].includes(a.status))
    .sort((a, b) => b.priority - a.priority || a.scheduled_start.localeCompare(b.scheduled_start))

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('queue.title') }]} />
      <h1>{t('queue.title')}</h1>

      <Card>
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
      </Card>

      {doctorId !== '' && (
        <>
          <Card title={t('queue.addWalkIn')}>
            <FormField label={t('queue.searchPatient')}>
              {(p) => <input {...p} value={patientSearch} onChange={(e) => setPatientSearch(e.target.value)} />}
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
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
              <input type="checkbox" style={{ width: 'auto', minHeight: 'auto' }} checked={emergency} onChange={(e) => setEmergency(e.target.checked)} />
              {t('queue.emergency')}
            </label>
            <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <Button loading={addWalkIn.isPending} disabled={!walkInPatient} onClick={() => addWalkIn.mutate()}>{t('queue.addWalkIn')}</Button>
              <Button variant="secondary" onClick={() => setRegisteringPatient(true)}>{t('patients.register')}</Button>
              {walkInPatient !== '' && (
                <Button variant="secondary" onClick={() => setEditingProfile(Number(walkInPatient))}>{t('patients.editProfile')}</Button>
              )}
            </div>
          </Card>

          <Card title={t('queue.title')}>
            {isLoading ? <CenteredSpinner /> : rows.length === 0 ? <p>{t('queue.noQueue')}</p> : (
              rows.map((a) => {
                const action = nextAction(a)
                return (
                  <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-3) 0', borderBottom: '1px solid var(--surface-2)', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                    <div>
                      <strong>{a.patient_name}</strong>
                      {a.appointment_type === 'EMERGENCY' && <span className="badge badge--alert" style={{ marginInlineStart: 8 }}>{t('queue.emergency')}</span>}
                      {a.appointment_type === 'WALK_IN' && <span className="badge" style={{ marginInlineStart: 8 }}>{t('kiosk.walkIn')}</span>}
                      <div style={{ color: 'var(--text-muted)' }}>{formatTime(a.scheduled_start, language)}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                      <StatusBadge status={a.status} />
                      {a.appointment_type !== 'EMERGENCY' && (
                        <Button variant="secondary" onClick={() => transition.mutate({ id: a.id, action: 'markEmergency' })}>{t('queue.markEmergency')}</Button>
                      )}
                      {action && <Button onClick={() => transition.mutate({ id: a.id, action: action.action })}>{action.label}</Button>}
                    </div>
                  </div>
                )
              })
            )}
          </Card>
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
    </div>
  )
}
