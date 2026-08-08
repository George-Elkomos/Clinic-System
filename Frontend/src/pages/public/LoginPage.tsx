import { Lock, Mail } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { AUTH_INPUT_CLASS } from '../../components/layout/authFormStyles'
import { PublicLayout } from '../../components/layout/PublicLayout'
import { FormField } from '../../components/primitives/FormField'
import { useAuth } from '../../hooks/useAuth'
import { errorMessage, isConnectivityError } from '../../services/apiClient'
import { roleHome } from '../../routes/roleHome'

export function LoginPage() {
  const { t } = useTranslation()
  const { login } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const user = await login(email, password)
      const next = params.get('next')
      navigate(next || roleHome(user.role), { replace: true })
    } catch (err) {
      // Distinguish "backend unreachable" from a real credential rejection so we
      // don't tell the user to check a password that was never actually checked.
      setError(isConnectivityError(err)
        ? t('auth.serverUnreachable')
        : errorMessage(err, t('auth.loginFailed')))
    } finally {
      setLoading(false)
    }
  }

  const registerHref = `/register${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`

  return (
    <PublicLayout>
      <div className="min-h-[calc(100vh-4rem)] bg-slate-50/50 flex flex-col items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 sm:p-8 space-y-6">
          <div className="min-w-0">
            <h1 className="public-title-auth font-bold text-slate-900 tracking-tight text-center">
              {t('auth.loginTitle')}
            </h1>
            {/* div, not p — globals.css unlayered-resets `p { margin: 0 }`, which
                blocks Tailwind's mt-1 the same way it blocks input padding/color. */}
            <div className="text-sm text-slate-500 text-center mt-1">
              {t('app.tagline', { defaultValue: 'Professional healthcare management' })}
            </div>
          </div>

          {/* No space-y-* here — Tailwind v4 implements it via margin-bottom on
              non-last children, which .field's own margin-bottom (public.css)
              already supplies; space-y-* would be a second, inert declaration
              for the same blocked property. */}
          <form onSubmit={submit} noValidate>
            <FormField label={t('auth.email')}>
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

            <FormField label={t('auth.password')} error={error || undefined}>
              {(p) => (
                <div className="relative">
                  <Lock
                    className="pointer-events-none absolute inset-y-0 start-3.5 my-auto h-4 w-4 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    {...p}
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className={`${AUTH_INPUT_CLASS} public-input--with-icon`}
                  />
                </div>
              )}
            </FormField>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 bg-[#0D9488] hover:bg-[#0B7A70] text-white font-semibold tracking-wide rounded-xl text-sm shadow-md hover:shadow-lg transition-all flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? t('auth.signingIn') : t('auth.signIn')}
            </button>
          </form>

          <div className="space-y-2 text-center">
            <Link to="/forgot-password" className="block text-sm font-medium hover:underline">
              {t('auth.forgotPassword')}
            </Link>
            <Link to={registerHref} className="block text-sm font-medium hover:underline">
              {t('auth.registerLink')}
            </Link>
          </div>
        </div>
      </div>
    </PublicLayout>
  )
}
