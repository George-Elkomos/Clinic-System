import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { FormField } from '../../components/primitives/FormField'
import { Select, type SelectOption } from '../../components/primitives/Select'
import { CenteredSpinner, Spinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { useAuth } from '../../hooks/useAuth'
import { LANGUAGE_OPTIONS, parseLanguages } from '../../lib/languages'
import { errorMessage } from '../../services/apiClient'
import { doctorsApi } from '../../services/doctors.api'
import type { Doctor } from '../../services/types'

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all disabled:opacity-60 sm:text-sm'
const BTN_SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-60 sm:text-sm'

// Read-only — the doctor's own photo is theirs to manage from /doctor/profile.
function DoctorAvatar({ name, imageUrl }: { name: string; imageUrl: string | null }) {
  const initials = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?'
  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-teal-100 font-semibold text-teal-700"
      style={{ width: 64, height: 64, fontSize: 64 / 3 }}
    >
      {imageUrl ? <img src={imageUrl} alt={name} className="h-full w-full object-cover" /> : <span>{initials}</span>}
    </div>
  )
}

function DoctorEditor({ doctor, specialtyOptions }: { doctor: Doctor; specialtyOptions: SelectOption[] }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { showToast } = useToast()
  const qc = useQueryClient()
  const isManager = user?.role === 'MANAGER'
  const [room, setRoom] = useState(doctor.room_number)
  const [accepting, setAccepting] = useState(doctor.is_accepting_patients)
  const [walkIns, setWalkIns] = useState(doctor.accepts_walk_ins)
  const [bio, setBio] = useState(doctor.bio)
  const [yearsExperience, setYearsExperience] = useState(doctor.years_experience)
  const [languages, setLanguages] = useState<string[]>(parseLanguages(doctor.languages_spoken))
  const [duration, setDuration] = useState(doctor.avg_appointment_duration)
  const [fee, setFee] = useState(doctor.consultation_fee ?? '')
  const [specialties, setSpecialties] = useState<number[]>(doctor.specialties)

  const save = useMutation({
    mutationFn: () => {
      const payload: Partial<Doctor> = {
        is_accepting_patients: accepting,
        accepts_walk_ins: walkIns,
        bio,
        years_experience: yearsExperience,
        languages_spoken: languages.join(', '),
        avg_appointment_duration: duration,
        specialties,
      }
      // Fee/room are Manager-exclusive — never sent by a secretary, even unchanged.
      if (isManager) {
        payload.room_number = room
        payload.consultation_fee = fee === '' ? null : fee
      }
      return doctorsApi.update(doctor.id, payload)
    },
    onSuccess: () => {
      showToast(t('common.save'), 'success')
      qc.invalidateQueries({ queryKey: ['secretary-doctors'] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  return (
    <div className={CARD}>
      <h2 className="patient-text-card-title mb-4" style={{ color: 'var(--text-primary)' }}>
        {doctor.full_name} · {doctor.specialties_detail.map((s) => s.name).join(', ')}
      </h2>

      <div className="mb-4">
        <DoctorAvatar name={doctor.full_name} imageUrl={doctor.photo} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <FormField label={t('doctors.room')} hint={isManager ? undefined : t('doctors.managerOnlyField')}>
          {(p) => (
            <input
              {...p}
              className="patient-field"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              disabled={!isManager}
            />
          )}
        </FormField>
        <div className="sm:col-span-2">
          <FormField label={t('doctors.bio')}>
            {(p) => <input {...p} className="patient-field" value={bio} onChange={(e) => setBio(e.target.value)} />}
          </FormField>
        </div>
        <FormField label={t('doctors.experience')}>
          {(p) => (
            <input
              {...p}
              type="number"
              min={0}
              className="patient-field"
              value={yearsExperience}
              onChange={(e) => setYearsExperience(Number(e.target.value))}
            />
          )}
        </FormField>
        <div className="sm:col-span-2">
          <FormField label={t('doctors.languages')}>
            {(p) => (
              <Select
                id={p.id}
                options={LANGUAGE_OPTIONS}
                value={languages}
                onChange={(value) => setLanguages(Array.isArray(value) ? value.map(String) : [])}
                searchable
                multi
              />
            )}
          </FormField>
        </div>
        <FormField label={t('doctors.consultationDuration')} hint={t('doctors.minutesHint')}>
          {(p) => (
            <input
              {...p}
              type="number"
              min={5}
              step={5}
              className="patient-field"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
          )}
        </FormField>
        <FormField label={t('doctors.consultationFee')} hint={isManager ? t('doctors.feeHint') : t('doctors.managerOnlyField')}>
          {(p) => (
            <input
              {...p}
              type="number"
              min={0}
              step="0.01"
              className="patient-field"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              disabled={!isManager}
            />
          )}
        </FormField>
        <div className="sm:col-span-3">
          <FormField label={t('staff.specialties')}>
            {(p) => (
              <Select
                id={p.id}
                options={specialtyOptions}
                value={specialties}
                onChange={(value) => setSpecialties(Array.isArray(value) ? value.map(Number) : [])}
                searchable
                multi
              />
            )}
          </FormField>
        </div>
      </div>
      <label className="patient-text-body mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
        <input
          type="checkbox"
          className="patient-checkbox"
          checked={accepting}
          onChange={(e) => setAccepting(e.target.checked)}
        />
        {t('doctors.acceptingPatients')}
      </label>
      <label className="patient-text-body mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
        <input
          type="checkbox"
          className="patient-checkbox"
          checked={walkIns}
          onChange={(e) => setWalkIns(e.target.checked)}
        />
        {t('doctors.acceptsWalkIns')}
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={save.isPending} onClick={() => save.mutate()} className={BTN_PRIMARY}>
          {save.isPending && <Spinner size={14} />}{t('common.save')}
        </button>
        <Link to={`/kiosk/${doctor.id}`} target="_blank" rel="noopener noreferrer">
          <button type="button" className={BTN_SECONDARY}>📺 {t('doctors.openKiosk')}</button>
        </Link>
      </div>
    </div>
  )
}

export function DoctorsPage() {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({
    queryKey: ['secretary-doctors'],
    queryFn: () => doctorsApi.list(),
  })
  const { data: specialties = [] } = useQuery({
    queryKey: ['specialties'],
    queryFn: doctorsApi.specialties,
  })
  const specialtyOptions: SelectOption[] = specialties.map((s) => ({ value: s.id, label: s.name }))

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[{ label: t('nav.doctors') }]} />
        <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>{t('nav.doctors')}</h1>
      </div>
      {isLoading ? (
        <CenteredSpinner />
      ) : (
        <div className="flex flex-col gap-4">
          {(data?.results ?? []).map((d) => <DoctorEditor key={d.id} doctor={d} specialtyOptions={specialtyOptions} />)}
        </div>
      )}
    </div>
  )
}
