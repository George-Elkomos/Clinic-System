import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FormField } from '../../components/primitives/FormField'
import { Spinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { errorMessage } from '../../services/apiClient'
import { staffApi } from '../../services/staff.api'
import type { CreatePatientResponse } from '../../services/types'

const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#1AB5B3] to-[#38E4DD] px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-95 disabled:opacity-60 sm:text-sm'
const BTN_SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-medium text-slate-700 transition-all hover:border-[#0D9488] hover:text-[#0D9488] disabled:opacity-60 sm:text-sm'

interface RegisterPatientModalProps {
  onClose: () => void
  onCreated?: (patientProfileId: number, fullName: string) => void
}

export function RegisterPatientModal({ onClose, onCreated }: RegisterPatientModalProps) {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const [created, setCreated] = useState<CreatePatientResponse | null>(null)
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    email: '',
    national_id: '',
  })

  const update = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const createPatient = useMutation({
    mutationFn: () => staffApi.createPatient(form),
    onSuccess: (data) => {
      setCreated(data)
      showToast(t('patients.created'), 'success')
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const done = () => {
    if (created) onCreated?.(created.patient_profile_id, created.user.full_name)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="register-patient-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="patient-text-card-title mb-4" id="register-patient-title" style={{ color: 'var(--text-primary)' }}>
          {t('patients.register')}
        </h2>

        {created ? (
          <>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="patient-text-body" style={{ color: 'var(--text-primary)' }}>{t('staff.tempPasswordNote')}</p>
              <div className="mt-2 rounded-lg bg-white px-3 py-2 text-center font-mono text-lg font-bold" style={{ color: 'var(--brand-teal-start)' }}>
                {created.temp_password}
              </div>
              {created.email_placeholder && (
                <p className="patient-text-body-secondary mt-2" style={{ color: 'var(--text-secondary)' }}>{t('patients.noEmail')}</p>
              )}
            </div>
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={done} className={BTN_PRIMARY}>{t('common.done')}</button>
            </div>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              createPatient.mutate()
            }}
          >
            <FormField label={t('auth.firstName')}>
              {(p) => (
                <input
                  {...p}
                  className="patient-field"
                  value={form.first_name}
                  onChange={(e) => update('first_name', e.target.value)}
                  required
                />
              )}
            </FormField>
            <FormField label={t('auth.lastName')}>
              {(p) => (
                <input
                  {...p}
                  className="patient-field"
                  value={form.last_name}
                  onChange={(e) => update('last_name', e.target.value)}
                  required
                />
              )}
            </FormField>
            <FormField label={t('auth.phone')} hint={t('patients.phoneEmailRequired')}>
              {(p) => (
                <input {...p} className="patient-field" value={form.phone} onChange={(e) => update('phone', e.target.value)} />
              )}
            </FormField>
            <FormField label={t('auth.email')}>
              {(p) => (
                <input
                  {...p}
                  className="patient-field"
                  type="email"
                  value={form.email}
                  onChange={(e) => update('email', e.target.value)}
                />
              )}
            </FormField>
            <FormField label={t('patients.nationalId')}>
              {(p) => (
                <input {...p} className="patient-field" value={form.national_id} onChange={(e) => update('national_id', e.target.value)} />
              )}
            </FormField>
            <div className="mt-4 flex flex-wrap justify-end gap-3">
              <button type="button" onClick={onClose} className={BTN_SECONDARY}>{t('common.cancel')}</button>
              <button type="submit" disabled={createPatient.isPending} className={BTN_PRIMARY}>
                {createPatient.isPending && <Spinner size={14} />}{t('patients.register')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
