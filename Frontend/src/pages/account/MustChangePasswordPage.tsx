import { Lock } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { AuthCardShell } from '../../components/layout/AuthCardShell'
import { AUTH_INPUT_CLASS, AUTH_LINK_CLASS } from '../../components/layout/authFormStyles'
import { FormField } from '../../components/primitives/FormField'
import { useAuth } from '../../hooks/useAuth'
import { errorMessage } from '../../services/apiClient'
import { authApi } from '../../services/auth.api'
import { roleHome } from '../../routes/roleHome'

export function MustChangePasswordPage() {
  const { t } = useTranslation()
  const { user, refreshUser, logout } = useAuth()
  const navigate = useNavigate()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (newPassword !== confirmPassword) {
      setError(t('auth.passwordMismatch'))
      return
    }
    setLoading(true)
    try {
      await authApi.changePassword({ current_password: currentPassword, new_password: newPassword })
      await refreshUser()
      navigate(user ? roleHome(user.role) : '/', { replace: true })
    } catch (err) {
      setError(errorMessage(err, t('auth.registerFailed')))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthCardShell>
      <h1 className="public-title-auth font-bold text-slate-900 tracking-tight">
        {t('auth.mustChangePasswordTitle')}
      </h1>
      {/* div, not p — globals.css unlayered-resets `p { margin: 0 }`, which
          blocks Tailwind's mt-1/mb-6 the same way it blocks input padding/color. */}
      <div className="text-xs sm:text-sm text-slate-500 mt-1 mb-6 leading-relaxed">
        {t('auth.mustChangePasswordIntro')}
      </div>

      <form onSubmit={submit} noValidate>
        <FormField label={t('auth.currentPassword')}>
          {(p) => (
            <div className="relative">
              <Lock
                className="pointer-events-none absolute inset-y-0 start-3.5 my-auto h-4 w-4 text-slate-400"
                aria-hidden="true"
              />
              <input
                {...p}
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className={`${AUTH_INPUT_CLASS} public-input--with-icon`}
              />
            </div>
          )}
        </FormField>

        <FormField label={t('auth.newPassword')}>
          {(p) => (
            <div className="relative">
              <Lock
                className="pointer-events-none absolute inset-y-0 start-3.5 my-auto h-4 w-4 text-slate-400"
                aria-hidden="true"
              />
              <input
                {...p}
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                className={`${AUTH_INPUT_CLASS} public-input--with-icon public-input--with-toggle`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute end-3 top-1/2 -translate-y-1/2 bg-transparent text-xs font-medium text-slate-500 hover:text-slate-700"
              >
                {showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
              </button>
            </div>
          )}
        </FormField>

        <FormField label={t('auth.confirmNewPassword')} error={error || undefined}>
          {(p) => (
            <div className="relative">
              <Lock
                className="pointer-events-none absolute inset-y-0 start-3.5 my-auto h-4 w-4 text-slate-400"
                aria-hidden="true"
              />
              <input
                {...p}
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className={`${AUTH_INPUT_CLASS} public-input--with-icon`}
              />
            </div>
          )}
        </FormField>

        <button
          type="submit"
          disabled={loading}
          className="w-full h-12 bg-[#0D9488] hover:bg-[#0B7A70] text-white font-semibold text-sm rounded-xl shadow-md hover:shadow-lg transition-all flex items-center justify-center cursor-pointer mt-6 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? t('auth.changingPassword') : t('auth.changePasswordSubmit')}
        </button>
      </form>

      <button
        type="button"
        onClick={() => void logout()}
        className={`${AUTH_LINK_CLASS} public-btn--responsive-text mt-6 w-full bg-transparent p-0`}
      >
        {t('nav.signOut')}
      </button>
    </AuthCardShell>
  )
}
