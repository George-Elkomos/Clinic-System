import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FormField } from '../../components/primitives/FormField'
import { Spinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { errorMessage } from '../../services/apiClient'
import { staffApi } from '../../services/staff.api'
import type { CreateSecretaryResponse } from '../../services/types'

const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all disabled:opacity-60 sm:text-sm'
const BTN_SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-60 sm:text-sm'

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
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-secretary-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="patient-text-card-title mb-4" id="create-secretary-title" style={{ color: 'var(--text-primary)' }}>
          {t('staff.createSecretary')}
        </h2>
        {created ? (
          <>
            {created.temp_password && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="patient-text-body" style={{ color: 'var(--text-primary)' }}>{t('staff.tempPasswordNote')}</p>
                <div className="mt-2 rounded-lg bg-white px-3 py-2 text-center font-mono text-lg font-bold" style={{ color: 'var(--brand-teal-start)' }}>
                  {created.temp_password}
                </div>
              </div>
            )}
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={onClose} className={BTN_PRIMARY}>{t('common.done')}</button>
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
              {(p) => <input {...p} className="patient-field" value={form.first_name} onChange={(e) => update('first_name', e.target.value)} required />}
            </FormField>
            <FormField label={t('auth.lastName')}>
              {(p) => <input {...p} className="patient-field" value={form.last_name} onChange={(e) => update('last_name', e.target.value)} required />}
            </FormField>
            <FormField label={t('auth.email')}>
              {(p) => (
                <input
                  {...p}
                  className="patient-field"
                  type="email"
                  value={form.email}
                  onChange={(e) => update('email', e.target.value)}
                  required
                />
              )}
            </FormField>
            <FormField label={t('auth.phone')}>
              {(p) => <input {...p} className="patient-field" value={form.phone} onChange={(e) => update('phone', e.target.value)} />}
            </FormField>
            <FormField label={t('auth.password')} hint={t('staff.passwordOptional')}>
              {(p) => (
                <input
                  {...p}
                  className="patient-field"
                  type="password"
                  value={form.password}
                  onChange={(e) => update('password', e.target.value)}
                />
              )}
            </FormField>
            <div className="mt-4 flex flex-wrap justify-end gap-3">
              <button type="button" onClick={onClose} className={BTN_SECONDARY}>{t('common.cancel')}</button>
              <button type="submit" disabled={createSecretary.isPending} className={BTN_PRIMARY}>
                {createSecretary.isPending && <Spinner size={14} />}{t('staff.createSecretary')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
