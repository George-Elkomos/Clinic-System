import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/primitives/Button'
import { FormField } from '../../components/primitives/FormField'
import { useToast } from '../../components/primitives/Toast'
import { errorMessage } from '../../services/apiClient'
import { staffApi } from '../../services/staff.api'
import type { UserManagementEntry } from '../../services/types'

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
    <div className="modal__backdrop" role="dialog" aria-modal="true" aria-labelledby="edit-user-title">
      <div className="modal">
        <h2 className="modal__title" id="edit-user-title">{t('staff.editUser')}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
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
              <input {...p} type="email" value={form.email} onChange={(e) => update('email', e.target.value)} required />
            )}
          </FormField>
          <FormField label={t('auth.phone')}>
            {(p) => <input {...p} value={form.phone} onChange={(e) => update('phone', e.target.value)} />}
          </FormField>
          <div className="modal__actions">
            <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" loading={save.isPending}>{t('common.save')}</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
