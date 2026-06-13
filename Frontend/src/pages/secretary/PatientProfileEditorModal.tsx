import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/primitives/Button'
import { FormField } from '../../components/primitives/FormField'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { errorMessage } from '../../services/apiClient'
import { staffApi } from '../../services/staff.api'
import type { PatientProfile } from '../../services/types'

interface PatientProfileEditorModalProps {
  profileId: number
  onClose: () => void
  onSaved?: () => void
}

const GENDER_OPTIONS = [
  { value: '', label: '-' },
  { value: 'M', label: 'Male' },
  { value: 'F', label: 'Female' },
  { value: 'O', label: 'Other' },
]

const BLOOD_OPTIONS = ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((value) => ({
  value,
  label: value || '-',
}))

function ProfileForm({
  initial,
  profileId,
  onClose,
  onSaved,
}: {
  initial: PatientProfile
  profileId: number
  onClose: () => void
  onSaved?: () => void
}) {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Partial<PatientProfile>>(initial)

  const update = (key: keyof PatientProfile, value: string | null) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const save = useMutation({
    mutationFn: () =>
      staffApi.updatePatientProfile(profileId, {
        ...draft,
        date_of_birth: draft.date_of_birth || null,
      }),
    onSuccess: () => {
      showToast(t('patients.profileSaved'), 'success')
      qc.invalidateQueries({ queryKey: ['patient-directory'] })
      onSaved?.()
      onClose()
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <div className="form-grid">
        <FormField label={t('patients.dateOfBirth')}>
          {(p) => (
            <input
              {...p}
              type="date"
              value={draft.date_of_birth ?? ''}
              onChange={(e) => update('date_of_birth', e.target.value || null)}
            />
          )}
        </FormField>
        <FormField label={t('patients.gender')}>
          {(p) => (
            <Select
              id={p.id}
              options={GENDER_OPTIONS}
              value={draft.gender ?? ''}
              onChange={(value) => update('gender', String(value))}
            />
          )}
        </FormField>
        <FormField label={t('medical.bloodType')}>
          {(p) => (
            <Select
              id={p.id}
              options={BLOOD_OPTIONS}
              value={draft.blood_type ?? ''}
              onChange={(value) => update('blood_type', String(value))}
            />
          )}
        </FormField>
        <FormField label={t('patients.nationalId')}>
          {(p) => (
            <input
              {...p}
              value={draft.national_id ?? ''}
              onChange={(e) => update('national_id', e.target.value)}
            />
          )}
        </FormField>
      </div>

      <FormField label={t('patients.address')}>
        {(p) => (
          <textarea {...p} rows={2} value={draft.address ?? ''} onChange={(e) => update('address', e.target.value)} />
        )}
      </FormField>

      <div className="form-grid">
        <FormField label={t('patients.emergencyContactName')}>
          {(p) => (
            <input
              {...p}
              value={draft.emergency_contact_name ?? ''}
              onChange={(e) => update('emergency_contact_name', e.target.value)}
            />
          )}
        </FormField>
        <FormField label={t('patients.emergencyContactPhone')}>
          {(p) => (
            <input
              {...p}
              value={draft.emergency_contact_phone ?? ''}
              onChange={(e) => update('emergency_contact_phone', e.target.value)}
            />
          )}
        </FormField>
      </div>

      <FormField label={t('medical.allergies')}>
        {(p) => (
          <textarea
            {...p}
            rows={2}
            value={draft.allergies_summary ?? ''}
            onChange={(e) => update('allergies_summary', e.target.value)}
          />
        )}
      </FormField>
      <FormField label={t('medical.chronicConditions')}>
        {(p) => (
          <textarea
            {...p}
            rows={2}
            value={draft.chronic_conditions ?? ''}
            onChange={(e) => update('chronic_conditions', e.target.value)}
          />
        )}
      </FormField>
      <FormField label={t('medical.previousSurgeries')}>
        {(p) => (
          <textarea
            {...p}
            rows={2}
            value={draft.previous_surgeries ?? ''}
            onChange={(e) => update('previous_surgeries', e.target.value)}
          />
        )}
      </FormField>
      <FormField label={t('medical.currentMedications')}>
        {(p) => (
          <textarea
            {...p}
            rows={2}
            value={draft.current_medications ?? ''}
            onChange={(e) => update('current_medications', e.target.value)}
          />
        )}
      </FormField>

      <div className="modal__actions">
        <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" loading={save.isPending}>{t('common.save')}</Button>
      </div>
    </form>
  )
}

export function PatientProfileEditorModal({ profileId, onClose, onSaved }: PatientProfileEditorModalProps) {
  const { t } = useTranslation()

  const { data, isLoading } = useQuery({
    queryKey: ['staff-patient-profile', profileId],
    queryFn: () => staffApi.getPatientProfile(profileId),
  })

  return (
    <div className="modal__backdrop" role="dialog" aria-modal="true" aria-labelledby="patient-profile-title">
      <div className="modal modal--wide">
        <h2 className="modal__title" id="patient-profile-title">{t('patients.editProfile')}</h2>
        {isLoading || !data ? (
          <CenteredSpinner />
        ) : (
          <ProfileForm
            key={profileId}
            initial={data}
            profileId={profileId}
            onClose={onClose}
            onSaved={onSaved}
          />
        )}
      </div>
    </div>
  )
}
