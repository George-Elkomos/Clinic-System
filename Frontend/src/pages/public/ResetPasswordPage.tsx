import { Lock } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { AuthCardShell } from '../../components/layout/AuthCardShell'
import { AUTH_INPUT_CLASS, AUTH_LINK_CLASS } from '../../components/layout/authFormStyles'
import { FormField } from '../../components/primitives/FormField'
import { errorMessage } from '../../services/apiClient'
import { authApi } from '../../services/auth.api'

export function ResetPasswordPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const uid = params.get('uid') || ''
  const token = params.get('token') || ''

  const [showPassword, setShowPassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [linkInvalid, setLinkInvalid] = useState(false)
  const [done, setDone] = useState(false)

  if (!uid || !token) {
    return (
      <AuthCardShell>
        <h1 className="public-title-auth font-bold text-slate-900 tracking-tight">{t('auth.resetPasswordTitle')}</h1>
        <div role="alert" className="text-xs sm:text-sm text-slate-500 mt-1 mb-6 leading-relaxed">
          {t('auth.resetLinkMissing')}
        </div>
        <Link to="/forgot-password" className={AUTH_LINK_CLASS}>
          {t('auth.requestNewLink')}
        </Link>
      </AuthCardShell>
    )
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLinkInvalid(false)
    if (newPassword !== confirmPassword) {
      setError(t('auth.passwordMismatch'))
      return
    }
    setLoading(true)
    try {
      await authApi.confirmPasswordReset({ uid, token, new_password: newPassword })
      setDone(true)
    } catch (err) {
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code
      if (code === 'invalid_link' || code === 'expired_link') setLinkInvalid(true)
      setError(errorMessage(err, t('auth.registerFailed')))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthCardShell>
      <h1 className="public-title-auth font-bold text-slate-900 tracking-tight">{t('auth.resetPasswordTitle')}</h1>

      {done ? (
        <>
          <div role="status" className="text-xs sm:text-sm text-slate-500 mt-1 mb-6 leading-relaxed">
            {t('auth.resetPasswordSuccess')}
          </div>
          <Link to="/login" className={AUTH_LINK_CLASS}>
            {t('auth.backToLogin')}
          </Link>
        </>
      ) : (
        <>
          <form onSubmit={submit} noValidate className="mt-6">
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
              {loading ? t('auth.resettingPassword') : t('auth.resetPasswordSubmit')}
            </button>
          </form>

          {linkInvalid && (
            <Link to="/forgot-password" className={`${AUTH_LINK_CLASS} mt-4`}>
              {t('auth.requestNewLink')}
            </Link>
          )}
        </>
      )}
    </AuthCardShell>
  )
}
