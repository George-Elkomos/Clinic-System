import { Mail } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { AuthCardShell } from '../../components/layout/AuthCardShell'
import { AUTH_INPUT_CLASS, AUTH_LINK_CLASS } from '../../components/layout/authFormStyles'
import { FormField } from '../../components/primitives/FormField'
import { errorMessage } from '../../services/apiClient'
import { authApi } from '../../services/auth.api'

export function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await authApi.requestPasswordReset(email)
      setSent(true)
    } catch (err) {
      setError(errorMessage(err, t('auth.registerFailed')))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthCardShell>
      <h1 className="public-title-auth font-bold text-slate-900 tracking-tight">{t('auth.forgotPasswordTitle')}</h1>

      {sent ? (
        <>
          {/* div, not p — globals.css unlayered-resets `p { margin: 0 }`, which
              blocks Tailwind's mt-1/mb-6 the same way it blocks input padding/color. */}
          <div role="status" className="text-xs sm:text-sm text-slate-500 mt-1 mb-6 leading-relaxed">
            {t('auth.resetLinkSent')}
          </div>
          <Link to="/login" className={AUTH_LINK_CLASS}>
            {t('auth.backToLogin')}
          </Link>
        </>
      ) : (
        <>
          {/* div, not p — globals.css unlayered-resets `p { margin: 0 }`, which
              blocks Tailwind's mt-1/mb-6 the same way it blocks input padding/color. */}
          <div className="text-xs sm:text-sm text-slate-500 mt-1 mb-6 leading-relaxed">
            {t('auth.forgotPasswordIntro')}
          </div>

          <form onSubmit={submit} noValidate>
            <FormField label={t('auth.email')} error={error || undefined}>
              {(p) => (
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute inset-y-0 start-3.5 my-auto h-4 w-4 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    {...p}
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className={`${AUTH_INPUT_CLASS} public-input--with-icon`}
                  />
                </div>
              )}
            </FormField>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 bg-[#0D9488] hover:bg-[#0B7A70] text-white font-semibold rounded-xl shadow-md hover:shadow-lg transition-all text-sm flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? t('auth.sendingResetLink') : t('auth.sendResetLink')}
            </button>
          </form>

          <Link to="/login" className={`${AUTH_LINK_CLASS} mt-4`}>
            {t('auth.backToLogin')}
          </Link>
        </>
      )}
    </AuthCardShell>
  )
}
