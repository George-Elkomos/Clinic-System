import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/primitives/Button'
import { FormField } from '../../components/primitives/FormField'
import { useToast } from '../../components/primitives/Toast'
import { errorMessage } from '../../services/apiClient'
import { staffApi } from '../../services/staff.api'
import type { CreateSecretaryResponse } from '../../services/types'

interface CreateSecretaryModalProps {
  onClose: () => void
  onCreated?: () => void
}

export function CreateSecretaryModal({ onClose, onCreated }: CreateSecretaryModalProps) {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const [created, setCreated] = useState<CreateSecretaryResponse | null>(null)
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    password: '',
  })

  const update = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const createSecretary = useMutation({
    mutationFn: () => staffApi.createSecretary(form),
    onSuccess: (data) => {
      setCreated(data)
      onCreated?.()
      showToast(t('staff.secretaryCreated'), 'success')
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  return (
    <div className="modal__backdrop" role="dialog" aria-modal="true" aria-labelledby="create-secretary-title">
      <div className="modal">
        <h2 className="modal__title" id="create-secretary-title">{t('staff.createSecretary')}</h2>
        {created ? (
          <>
            {created.temp_password && (
              <div className="temp-password-box">
                <p>{t('staff.tempPasswordNote')}</p>
                <div className="temp-password-box__code">{created.temp_password}</div>
              </div>
            )}
            <div className="modal__actions">
              <Button onClick={onClose}>{t('common.done')}</Button>
            </div>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              createSecretary.mutate()
            }}
          >
            <FormField label={t('auth.firstName')}>
              {(p) => <input {...p} value={form.first_name} onChange={(e) => update('first_name', e.target.value)} required />}
            </FormField>
            <FormField label={t('auth.lastName')}>
              {(p) => <input {...p} value={form.last_name} onChange={(e) => update('last_name', e.target.value)} required />}
            </FormField>
            <FormField label={t('auth.email')}>
              {(p) => (
                <input
                  {...p}
                  type="email"
                  value={form.email}
                  onChange={(e) => update('email', e.target.value)}
                  required
                />
              )}
            </FormField>
            <FormField label={t('auth.phone')}>
              {(p) => <input {...p} value={form.phone} onChange={(e) => update('phone', e.target.value)} />}
            </FormField>
            <FormField label={t('auth.password')} hint={t('staff.passwordOptional')}>
              {(p) => (
                <input
                  {...p}
                  type="password"
                  value={form.password}
                  onChange={(e) => update('password', e.target.value)}
                />
              )}
            </FormField>
            <div className="modal__actions">
              <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
              <Button type="submit" loading={createSecretary.isPending}>{t('staff.createSecretary')}</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
