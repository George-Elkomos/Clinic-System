import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { FormField } from '../../components/primitives/FormField'
import { CenteredSpinner, Spinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { useAuth } from '../../hooks/useAuth'
import { errorMessage } from '../../services/apiClient'
import { doctorsApi } from '../../services/doctors.api'

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all disabled:opacity-60 sm:text-sm'

export function MyProfilePage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { showToast } = useToast()
  const qc = useQueryClient()
  const myDoctorId = user?.doctor_profile?.id

  const { data: doctor, isLoading } = useQuery({
    queryKey: ['my-doctor-profile', myDoctorId],
    queryFn: () => doctorsApi.get(myDoctorId!),
    enabled: !!myDoctorId,
  })

  const [bio, setBio] = useState('')
  const [room, setRoom] = useState('')
  const [languages, setLanguages] = useState('')
  const [yearsExperience, setYearsExperience] = useState(0)
  const [duration, setDuration] = useState(30)
  const [fee, setFee] = useState('')
  const [accepting, setAccepting] = useState(true)
  const [walkIns, setWalkIns] = useState(true)

  useEffect(() => {
    if (!doctor) return
    setBio(doctor.bio)
    setRoom(doctor.room_number)
    setLanguages(doctor.languages_spoken)
    setYearsExperience(doctor.years_experience)
    setDuration(doctor.avg_appointment_duration)
    setFee(doctor.consultation_fee ?? '')
    setAccepting(doctor.is_accepting_patients)
    setWalkIns(doctor.accepts_walk_ins)
  }, [doctor])

  const save = useMutation({
    mutationFn: () =>
      doctorsApi.update(myDoctorId!, {
        bio,
        room_number: room,
        languages_spoken: languages,
        years_experience: yearsExperience,
        avg_appointment_duration: duration,
        consultation_fee: fee === '' ? null : fee,
        is_accepting_patients: accepting,
        accepts_walk_ins: walkIns,
      }),
    onSuccess: () => {
      showToast(t('doctors.profileSaved'), 'success')
      qc.invalidateQueries({ queryKey: ['my-doctor-profile', myDoctorId] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

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
        <FormField label={t('doctors.bio')}>
          {(p) => (
            <textarea
              {...p}
              className="patient-field"
              rows={3}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
            />
          )}
        </FormField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label={t('doctors.room')}>
            {(p) => (
              <input {...p} className="patient-field" value={room} onChange={(e) => setRoom(e.target.value)} />
            )}
          </FormField>
          <FormField label={t('doctors.languages')}>
            {(p) => (
              <input
                {...p}
                className="patient-field"
                value={languages}
                onChange={(e) => setLanguages(e.target.value)}
              />
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

        <label className="patient-text-body mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <input
            type="checkbox"
            className="patient-checkbox"
            checked={accepting}
            onChange={(e) => setAccepting(e.target.checked)}
          />
          {t('doctors.acceptingPatients')}
        </label>
        <label className="patient-text-body mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <input
            type="checkbox"
            className="patient-checkbox"
            checked={walkIns}
            onChange={(e) => setWalkIns(e.target.checked)}
          />
          {t('doctors.acceptsWalkIns')}
        </label>

        <button type="button" disabled={save.isPending} onClick={() => save.mutate()} className={BTN_PRIMARY}>
          {save.isPending && <Spinner size={14} />}
          {t('common.save')}
        </button>
      </div>
    </div>
  )
}
