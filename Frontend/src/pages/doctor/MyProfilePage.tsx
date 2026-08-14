import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { AvatarUploader } from '../../components/primitives/AvatarUploader'
import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { FormField } from '../../components/primitives/FormField'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner, Spinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { ChangePasswordForm } from '../../components/settings/ChangePasswordForm'
import { useAuth } from '../../hooks/useAuth'
import { LANGUAGE_OPTIONS, parseLanguages } from '../../lib/languages'
import { errorMessage } from '../../services/apiClient'
import { authApi } from '../../services/auth.api'
import { doctorsApi } from '../../services/doctors.api'
import type { Doctor } from '../../services/types'

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const CARD_TITLE = 'mb-4 text-sm font-bold text-slate-800 sm:text-base'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all disabled:opacity-60 sm:text-sm'
const BTN_SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-60 sm:text-sm'

export function MyProfilePage() {
  const { t } = useTranslation()
  const { user, refreshUser } = useAuth()
  const { showToast } = useToast()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const myDoctorId = user?.doctor_profile?.id

  const { data: doctor, isLoading } = useQuery({
    queryKey: ['my-doctor-profile', myDoctorId],
    queryFn: () => doctorsApi.get(myDoctorId!),
    enabled: !!myDoctorId,
  })
  const { data: specialtyOptions = [] } = useQuery({
    queryKey: ['specialties'],
    queryFn: doctorsApi.specialties,
  })
  const { data: schedules = [] } = useQuery({
    queryKey: ['my-doctor-schedules', myDoctorId],
    queryFn: () => doctorsApi.schedules(myDoctorId),
    enabled: !!myDoctorId,
  })

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [fullNameAr, setFullNameAr] = useState('')
  const [bio, setBio] = useState('')
  const [bioAr, setBioAr] = useState('')
  const [education, setEducation] = useState('')
  const [room, setRoom] = useState('')
  const [languages, setLanguages] = useState<string[]>([])
  const [specialties, setSpecialties] = useState<number[]>([])
  const [yearsExperience, setYearsExperience] = useState(0)
  const [duration, setDuration] = useState(30)
  const [fee, setFee] = useState('')
  const [accepting, setAccepting] = useState(true)
  const [walkIns, setWalkIns] = useState(true)
  const [avatarValue, setAvatarValue] = useState<File | null | undefined>(undefined)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (user) {
      setFirstName(user.first_name)
      setLastName(user.last_name)
    }
  }, [user])

  useEffect(() => {
    if (!doctor) return
    setFullNameAr(doctor.full_name_ar)
    setBio(doctor.bio)
    setBioAr(doctor.bio_ar)
    setEducation(doctor.education)
    setRoom(doctor.room_number)
    setLanguages(parseLanguages(doctor.languages_spoken))
    setSpecialties(doctor.specialties)
    setYearsExperience(doctor.years_experience)
    setDuration(doctor.avg_appointment_duration)
    setFee(doctor.consultation_fee ?? '')
    setAccepting(doctor.is_accepting_patients)
    setWalkIns(doctor.accepts_walk_ins)
  }, [doctor])

  const handleSave = async () => {
    if (!myDoctorId) return
    setSaving(true)
    try {
      const doctorPayload: Partial<Doctor> = {
        bio,
        bio_ar: bioAr,
        full_name_ar: fullNameAr,
        education,
        room_number: room,
        languages_spoken: languages.join(', '),
        years_experience: yearsExperience,
        avg_appointment_duration: duration,
        consultation_fee: fee === '' ? null : fee,
        is_accepting_patients: accepting,
        accepts_walk_ins: walkIns,
        specialties,
      }

      let doctorUpdate: Promise<Doctor>
      if (avatarValue !== undefined) {
        const form = new FormData()
        Object.entries(doctorPayload).forEach(([k, v]) => {
          if (v === null || v === undefined) return
          if (k === 'specialties') {
            ;(v as number[]).forEach((id) => form.append('specialties', String(id)))
          } else {
            form.append(k, String(v))
          }
        })
        form.append('photo', avatarValue === null ? '' : avatarValue)
        doctorUpdate = doctorsApi.update(myDoctorId, form)
      } else {
        doctorUpdate = doctorsApi.update(myDoctorId, doctorPayload)
      }

      await Promise.all([
        authApi.updateMe({ first_name: firstName, last_name: lastName }),
        doctorUpdate,
      ])
      showToast(t('doctors.profileSaved'), 'success')
      await refreshUser()
      qc.invalidateQueries({ queryKey: ['my-doctor-profile', myDoctorId] })
      setAvatarValue(undefined)
    } catch (err) {
      showToast(errorMessage(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return <CenteredSpinner />
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[{ label: t('nav.myProfile') }]} />
        <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>
          {t('nav.myProfile')}
        </h1>
        <p className="patient-text-body-secondary mt-1" style={{ color: 'var(--text-secondary)' }}>
          {t('doctors.myProfileIntro')}
        </p>
      </div>

      <div className={CARD}>
        <h2 className={CARD_TITLE}>{t('doctors.personalBio')}</h2>
        <AvatarUploader
          name={user?.full_name ?? ''}
          imageUrl={doctor?.photo ?? null}
          value={avatarValue}
          onChange={setAvatarValue}
        />

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label={t('auth.firstName')}>
            {(p) => <input {...p} className="patient-field" value={firstName} onChange={(e) => setFirstName(e.target.value)} />}
          </FormField>
          <FormField label={t('auth.lastName')}>
            {(p) => <input {...p} className="patient-field" value={lastName} onChange={(e) => setLastName(e.target.value)} />}
          </FormField>
          <FormField label={t('doctors.fullNameAr')} hint={t('doctors.fullNameArHint')}>
            {(p) => (
              <input {...p} dir="rtl" className="patient-field" value={fullNameAr} onChange={(e) => setFullNameAr(e.target.value)} />
            )}
          </FormField>
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
        </div>

        <div className="mt-4">
          <FormField label={t('staff.specialties')}>
            {(p) => (
              <Select
                id={p.id}
                options={specialtyOptions.map((s) => ({ value: s.id, label: s.name }))}
                value={specialties}
                onChange={(value) => setSpecialties(Array.isArray(value) ? value.map(Number) : [])}
                searchable
                multi
              />
            )}
          </FormField>
        </div>

        <div className="mt-4">
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

        <div className="mt-4">
          <FormField label={t('doctors.education')}>
            {(p) => <textarea {...p} className="patient-field" rows={3} value={education} onChange={(e) => setEducation(e.target.value)} />}
          </FormField>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label={t('doctors.bio')}>
            {(p) => <textarea {...p} className="patient-field" rows={3} value={bio} onChange={(e) => setBio(e.target.value)} />}
          </FormField>
          <FormField label={t('doctors.bioAr')}>
            {(p) => (
              <textarea {...p} dir="rtl" className="patient-field" rows={3} value={bioAr} onChange={(e) => setBioAr(e.target.value)} />
            )}
          </FormField>
        </div>
      </div>

      <div className={CARD}>
        <h2 className={CARD_TITLE}>{t('doctors.clinicConsultation')}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label={t('doctors.room')}>
            {(p) => <input {...p} className="patient-field" value={room} onChange={(e) => setRoom(e.target.value)} />}
          </FormField>
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
          <div className="sm:col-span-2">
            <FormField label={t('doctors.consultationFee')} hint={t('doctors.feeHint')}>
              {(p) => (
                <input
                  {...p}
                  type="number"
                  min={0}
                  step="0.01"
                  className="patient-field"
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                />
              )}
            </FormField>
          </div>
        </div>

        <label className="patient-text-body mt-4 mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <input
            type="checkbox"
            className="patient-checkbox"
            checked={accepting}
            onChange={(e) => setAccepting(e.target.checked)}
          />
          {t('doctors.acceptingPatients')}
        </label>
        <label className="patient-text-body flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <input
            type="checkbox"
            className="patient-checkbox"
            checked={walkIns}
            onChange={(e) => setWalkIns(e.target.checked)}
          />
          {t('doctors.acceptsWalkIns')}
        </label>
      </div>

      <div className={CARD}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className={`${CARD_TITLE} mb-0`}>{t('doctors.weeklySchedule')}</h2>
          <button type="button" onClick={() => navigate('/doctor/schedule')} className={BTN_SECONDARY}>
            {t('doctors.manageSchedule')}
          </button>
        </div>
        {schedules.length === 0 ? (
          <p className="text-sm text-slate-400">{t('doctors.noScheduleYet')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {schedules.map((s) => (
              <span key={s.id} className="rounded-full bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-700">
                {s.weekday_display}: {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className={CARD}>
        <h2 className={CARD_TITLE}>{t('settings.security')}</h2>
        <ChangePasswordForm />
      </div>

      <div>
        <button type="button" disabled={saving} onClick={handleSave} className={BTN_PRIMARY}>
          {saving && <Spinner size={14} />}
          {t('common.save')}
        </button>
      </div>
    </div>
  )
}
