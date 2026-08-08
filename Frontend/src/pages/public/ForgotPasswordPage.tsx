import { Mail } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Logo } from '../../components/layout/Logo'
import { PublicLanguageToggle } from '../../components/layout/PublicLanguageToggle'
import '../../components/layout/public.css'
import { FormField } from '../../components/primitives/FormField'
import { errorMessage } from '../../services/apiClient'
import { authApi } from '../../services/auth.api'

const INPUT_CLASS =
  'w-full h-12 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 text-slate-800 text-sm font-medium placeholder:text-slate-400 outline-none focus:outline-none focus:bg-white focus:ring-4 focus:ring-[#0D9488]/15 focus:border-[#0D9488] shadow-sm focus:shadow-md transition-all duration-200'

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
    <div className="public-shell min-h-screen flex items-center justify-center bg-slate-50/50 p-4">
      <div className="w-full max-w-md mx-auto my-auto rounded-2xl border border-slate-100 bg-white p-6 shadow-xl shadow-slate-100/50 sm:p-8">
        <div className="flex items-center justify-between mb-6">
          <Link to="/" className="flex items-center shrink-0">
            <Logo className="h-8 w-auto" />
          </Link>
          <PublicLanguageToggle />
        </div>

        <h1 className="public-title-auth font-bold text-slate-900 tracking-tight">{t('auth.forgotPasswordTitle')}</h1>

        {sent ? (
          <>
            {/* div, not p — globals.css unlayered-resets `p { margin: 0 }`, which
                blocks Tailwind's mt-1/mb-6 the same way it blocks input padding/color. */}
            <div role="status" className="text-xs sm:text-sm text-slate-500 mt-1 mb-6 leading-relaxed">
              {t('auth.resetLinkSent')}
            </div>
            <Link
              to="/login"
              className="text-xs sm:text-sm font-semibold text-[#0D9488] hover:underline transition-all block text-center mt-4"
            >
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
                      className={`${INPUT_CLASS} public-input--with-icon`}
                    />
                  </div>
                )}
              </FormField>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-12 bg-[#0D9488] hover:bg-[#0B7A70] text-white font-semibold rounded-xl shadow-md hover:shadow-lg transition-all text-sm mt-4 flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? t('auth.sendingResetLink') : t('auth.sendResetLink')}
              </button>
            </form>

            <Link
              to="/login"
              className="text-xs sm:text-sm font-semibold text-[#0D9488] hover:underline transition-all block text-center mt-4"
            >
              {t('auth.backToLogin')}
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
