import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/primitives/Button'
import { FormField } from '../../components/primitives/FormField'
import { useToast } from '../../components/primitives/Toast'
import { errorMessage } from '../../services/apiClient'
import { staffApi } from '../../services/staff.api'
import type { CreatePatientResponse } from '../../services/types'

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
    <div className="modal__backdrop" role="dialog" aria-modal="true" aria-labelledby="register-patient-title">
      <div className="modal">
        <h2 className="modal__title" id="register-patient-title">{t('patients.register')}</h2>

        {created ? (
          <>
            <div className="temp-password-box">
              <p>{t('staff.tempPasswordNote')}</p>
              <div className="temp-password-box__code">{created.temp_password}</div>
              {created.email_placeholder && <p>{t('patients.noEmail')}</p>}
            </div>
            <div className="modal__actions">
              <Button onClick={done}>{t('common.done')}</Button>
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
                  value={form.last_name}
                  onChange={(e) => update('last_name', e.target.value)}
                  required
                />
              )}
            </FormField>
            <FormField label={t('auth.phone')} hint={t('patients.phoneEmailRequired')}>
              {(p) => (
                <input {...p} value={form.phone} onChange={(e) => update('phone', e.target.value)} />
              )}
            </FormField>
            <FormField label={t('auth.email')}>
              {(p) => (
                <input
                  {...p}
                  type="email"
                  value={form.email}
                  onChange={(e) => update('email', e.target.value)}
                />
              )}
            </FormField>
            <FormField label={t('patients.nationalId')}>
              {(p) => (
                <input {...p} value={form.national_id} onChange={(e) => update('national_id', e.target.value)} />
              )}
            </FormField>
            <div className="modal__actions">
              <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
              <Button type="submit" loading={createPatient.isPending}>{t('patients.register')}</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
