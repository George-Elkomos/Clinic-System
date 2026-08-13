import { Eye, EyeOff } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { errorMessage } from '../../services/apiClient'
import { authApi } from '../../services/auth.api'
import { FormField } from '../primitives/FormField'
import { Spinner } from '../primitives/Spinner'
import { useToast } from '../primitives/Toast'

const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all disabled:opacity-60 sm:text-sm'

// Voluntary change-password form for Doctor's profile page and the Manager/
// Secretary account settings page — same authApi.changePassword() call and
// i18n keys already proven in the forced MustChangePasswordPage flow.
export function ChangePasswordForm() {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      showToast(t('auth.passwordMismatch'), 'error')
      return
    }
    setLoading(true)
    try {
      await authApi.changePassword({ current_password: currentPassword, new_password: newPassword })
      showToast(t('auth.changePasswordSuccess'), 'success')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      showToast(errorMessage(err), 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="max-w-md">
        <FormField label={t('auth.currentPasswordLabel')}>
          {(p) => (
            <input
              {...p}
              className="patient-field"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          )}
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label={t('auth.newPassword')}>
          {(p) => (
            <input
              {...p}
              className="patient-field"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
            />
          )}
        </FormField>
        <FormField label={t('auth.confirmNewPassword')}>
          {(p) => (
            <input
              {...p}
              className="patient-field"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          )}
        </FormField>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setShowPassword((v) => !v)}
          className="inline-flex items-center gap-1.5 border-0 bg-transparent p-0 text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
          {showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
        </button>
        <button
          type="submit"
          disabled={loading || !currentPassword || !newPassword}
          className={BTN_PRIMARY}
        >
          {loading && <Spinner size={14} />}
          {t('auth.changePasswordSubmit')}
        </button>
      </div>
    </form>
  )
}
