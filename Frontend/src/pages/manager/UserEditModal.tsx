import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FormField } from '../../components/primitives/FormField'
import { Spinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { errorMessage } from '../../services/apiClient'
import { staffApi } from '../../services/staff.api'
import type { UserManagementEntry } from '../../services/types'

const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#1AB5B3] to-[#38E4DD] px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-95 disabled:opacity-60 sm:text-sm'
const BTN_SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-medium text-slate-700 transition-all hover:border-[#0D9488] hover:text-[#0D9488] disabled:opacity-60 sm:text-sm'

interface UserEditModalProps {
  user: UserManagementEntry
  onClose: () => void
  onSaved?: () => void
}

export function UserEditModal({ user, onClose, onSaved }: UserEditModalProps) {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const [form, setForm] = useState({
    first_name: user.first_name,
    last_name: user.last_name,
    phone: user.phone,
    email: user.email,
  })

  const update = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const save = useMutation({
    mutationFn: () => staffApi.updateUser(user.id, form),
    onSuccess: () => {
      showToast(t('staff.userSaved'), 'success')
      onSaved?.()
      onClose()
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-user-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="patient-text-card-title mb-4" id="edit-user-title" style={{ color: 'var(--text-primary)' }}>
          {t('staff.editUser')}
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
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
              <input {...p} className="patient-field" type="email" value={form.email} onChange={(e) => update('email', e.target.value)} required />
            )}
          </FormField>
          <FormField label={t('auth.phone')}>
            {(p) => <input {...p} className="patient-field" value={form.phone} onChange={(e) => update('phone', e.target.value)} />}
          </FormField>
          <div className="mt-4 flex flex-wrap justify-end gap-3">
            <button type="button" onClick={onClose} className={BTN_SECONDARY}>{t('common.cancel')}</button>
            <button type="submit" disabled={save.isPending} className={BTN_PRIMARY}>
              {save.isPending && <Spinner size={14} />}{t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
