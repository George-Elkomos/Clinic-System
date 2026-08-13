import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CustomDatePicker } from '../../components/primitives/CustomDatePicker'
import { FormField } from '../../components/primitives/FormField'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner, Spinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { errorMessage } from '../../services/apiClient'
import { staffApi } from '../../services/staff.api'
import type { PatientProfile } from '../../services/types'

const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all disabled:opacity-60 sm:text-sm'
const BTN_SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-60 sm:text-sm'

interface PatientProfileEditorModalProps {
  profileId: number
  onClose: () => void
  onSaved?: () => void
}

const GENDER_OPTIONS = [
  { value: '', label: '-' },
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
  { value: 'OTHER', label: 'Other' },
  { value: 'UNDISCLOSED', label: 'Prefer not to say' },
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label={t('patients.dateOfBirth')}>
          {(p) => (
            <CustomDatePicker
              {...p}
              variant="field"
              value={draft.date_of_birth ?? ''}
              onChange={(iso) => update('date_of_birth', iso || null)}
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
              className="patient-field"
              value={draft.national_id ?? ''}
              onChange={(e) => update('national_id', e.target.value)}
            />
          )}
        </FormField>
      </div>

      <FormField label={t('patients.address')}>
        {(p) => (
          <textarea {...p} className="patient-field" rows={2} value={draft.address ?? ''} onChange={(e) => update('address', e.target.value)} />
        )}
      </FormField>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label={t('patients.emergencyContactName')}>
          {(p) => (
            <input
              {...p}
              className="patient-field"
              value={draft.emergency_contact_name ?? ''}
              onChange={(e) => update('emergency_contact_name', e.target.value)}
            />
          )}
        </FormField>
        <FormField label={t('patients.emergencyContactPhone')}>
          {(p) => (
            <input
              {...p}
              className="patient-field"
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
            className="patient-field"
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
            className="patient-field"
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
            className="patient-field"
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
            className="patient-field"
            rows={2}
            value={draft.current_medications ?? ''}
            onChange={(e) => update('current_medications', e.target.value)}
          />
        )}
      </FormField>

      <div className="mt-4 flex flex-wrap justify-end gap-3">
        <button type="button" onClick={onClose} className={BTN_SECONDARY}>{t('common.cancel')}</button>
        <button type="submit" disabled={save.isPending} className={BTN_PRIMARY}>
          {save.isPending && <Spinner size={14} />}{t('common.save')}
        </button>
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
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="patient-profile-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="patient-text-card-title mb-4" id="patient-profile-title" style={{ color: 'var(--text-primary)' }}>
          {t('patients.editProfile')}
        </h2>
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
