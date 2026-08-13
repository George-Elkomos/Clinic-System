import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AvatarUploader } from '../../components/primitives/AvatarUploader'
import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { CustomDatePicker } from '../../components/primitives/CustomDatePicker'
import { FormField } from '../../components/primitives/FormField'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner, Spinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { useAuth } from '../../hooks/useAuth'
import { errorMessage } from '../../services/apiClient'
import { authApi } from '../../services/auth.api'
import type { PatientProfile } from '../../services/types'

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const CARD_TITLE = 'mb-4 text-sm font-bold text-slate-800 sm:text-base'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all disabled:opacity-60 sm:text-sm'
const FIELD_CLASS = 'patient-field'
const TEXTAREA_CLASS = `${FIELD_CLASS} resize-none`

const GENDER_OPTIONS = [
  { value: '', label: '-' },
  { value: 'MALE', label: 'patients.genderMale' },
  { value: 'FEMALE', label: 'patients.genderFemale' },
  { value: 'OTHER', label: 'patients.genderOther' },
  { value: 'UNDISCLOSED', label: 'patients.genderUndisclosed' },
]

const BLOOD_OPTIONS = ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((value) => ({
  value,
  label: value || '-',
}))

export function MyProfilePage() {
  const { t } = useTranslation()
  const { user, refreshUser } = useAuth()
  const { showToast } = useToast()
  const qc = useQueryClient()

  const { data: profile, isLoading } = useQuery({
    queryKey: ['patient-profile'],
    queryFn: authApi.patientProfile,
  })

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [avatarValue, setAvatarValue] = useState<File | null | undefined>(undefined)
  const [form, setForm] = useState<Partial<PatientProfile>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (user) {
      setFirstName(user.first_name)
      setLastName(user.last_name)
      setPhone(user.phone)
    }
  }, [user])

  useEffect(() => {
    if (!profile) return
    setForm({
      date_of_birth: profile.date_of_birth ?? '',
      gender: profile.gender ?? '',
      blood_type: profile.blood_type ?? '',
      allergies_summary: profile.allergies_summary ?? '',
      chronic_conditions: profile.chronic_conditions ?? '',
      previous_surgeries: profile.previous_surgeries ?? '',
      current_medications: profile.current_medications ?? '',
      emergency_contact_name: profile.emergency_contact_name ?? '',
      emergency_contact_phone: profile.emergency_contact_phone ?? '',
      insurance_provider: profile.insurance_provider ?? '',
      insurance_policy_number: profile.insurance_policy_number ?? '',
    })
  }, [profile])

  const set = (k: keyof PatientProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const handleSave = async () => {
    setSaving(true)
    try {
      await Promise.all([
        authApi.updateMe({
          first_name: firstName,
          last_name: lastName,
          phone,
          ...(avatarValue !== undefined ? { avatar: avatarValue } : {}),
        }),
        authApi.updatePatientProfile({
          ...form,
          date_of_birth: form.date_of_birth || null,
        }),
      ])
      showToast(t('patients.profileSaved'), 'success')
      await refreshUser()
      qc.invalidateQueries({ queryKey: ['patient-profile'] })
      setAvatarValue(undefined)
    } catch (err) {
      showToast(errorMessage(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading || !user) return <CenteredSpinner />

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[{ label: t('nav.myProfile') }]} />
        <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>
          {t('nav.myProfile')}
        </h1>
      </div>

      <div className={CARD}>
        <h2 className={CARD_TITLE}>{t('patients.personalDetails')}</h2>
        <AvatarUploader
          name={user.full_name}
          imageUrl={user.avatar_url}
          value={avatarValue}
          onChange={setAvatarValue}
        />

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label={t('auth.firstName')}>
            {(p) => <input {...p} className={FIELD_CLASS} value={firstName} onChange={(e) => setFirstName(e.target.value)} />}
          </FormField>
          <FormField label={t('auth.lastName')}>
            {(p) => <input {...p} className={FIELD_CLASS} value={lastName} onChange={(e) => setLastName(e.target.value)} />}
          </FormField>
          <FormField label={t('auth.email')}>
            {(p) => <input {...p} className={FIELD_CLASS} value={user.email} disabled />}
          </FormField>
          <FormField label={t('auth.phone')}>
            {(p) => <input {...p} className={FIELD_CLASS} value={phone} onChange={(e) => setPhone(e.target.value)} />}
          </FormField>
          <FormField label={t('patients.dateOfBirth')}>
            {(p) => (
              <CustomDatePicker
                {...p}
                variant="field"
                value={form.date_of_birth ?? ''}
                onChange={(iso) => setForm((f) => ({ ...f, date_of_birth: iso }))}
              />
            )}
          </FormField>
          <FormField label={t('patients.gender')}>
            {(p) => (
              <Select
                id={p.id}
                options={GENDER_OPTIONS.map((o) => ({ value: o.value, label: o.value ? t(o.label) : o.label }))}
                value={form.gender ?? ''}
                onChange={(value) => setForm((f) => ({ ...f, gender: String(value) }))}
              />
            )}
          </FormField>
        </div>
      </div>

      <div className={CARD}>
        <h2 className={CARD_TITLE}>{t('patients.medicalEmergency')}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label={t('medical.bloodType')}>
            {(p) => (
              <Select
                id={p.id}
                options={BLOOD_OPTIONS}
                value={form.blood_type ?? ''}
                onChange={(value) => setForm((f) => ({ ...f, blood_type: String(value) }))}
              />
            )}
          </FormField>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label={t('medical.allergies')}>
            {(p) => <textarea {...p} className={TEXTAREA_CLASS} rows={2} value={form.allergies_summary ?? ''} onChange={set('allergies_summary')} />}
          </FormField>
          <FormField label={t('medical.chronicConditions')}>
            {(p) => <textarea {...p} className={TEXTAREA_CLASS} rows={2} value={form.chronic_conditions ?? ''} onChange={set('chronic_conditions')} />}
          </FormField>
          <FormField label={t('medical.currentMedications')}>
            {(p) => <textarea {...p} className={TEXTAREA_CLASS} rows={2} value={form.current_medications ?? ''} onChange={set('current_medications')} />}
          </FormField>
          <FormField label={t('medical.previousSurgeries')}>
            {(p) => <textarea {...p} className={TEXTAREA_CLASS} rows={2} value={form.previous_surgeries ?? ''} onChange={set('previous_surgeries')} />}
          </FormField>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label={t('patients.emergencyContactName')}>
            {(p) => <input {...p} className={FIELD_CLASS} value={form.emergency_contact_name ?? ''} onChange={set('emergency_contact_name')} />}
          </FormField>
          <FormField label={t('patients.emergencyContactPhone')}>
            {(p) => <input {...p} className={FIELD_CLASS} value={form.emergency_contact_phone ?? ''} onChange={set('emergency_contact_phone')} />}
          </FormField>
          <FormField label={t('patients.insuranceProvider')}>
            {(p) => <input {...p} className={FIELD_CLASS} value={form.insurance_provider ?? ''} onChange={set('insurance_provider')} />}
          </FormField>
          <FormField label={t('patients.insurancePolicyNumber')}>
            {(p) => <input {...p} className={FIELD_CLASS} value={form.insurance_policy_number ?? ''} onChange={set('insurance_policy_number')} />}
          </FormField>
        </div>
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
