import { Lock, Mail } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { AUTH_INPUT_CLASS } from '../../components/layout/authFormStyles'
import { PublicLayout } from '../../components/layout/PublicLayout'
import { FormField } from '../../components/primitives/FormField'
import { useAuth } from '../../hooks/useAuth'
import { resolvePostAuthRedirect } from '../../routes/roleHome'
import { authApi } from '../../services/auth.api'
import { errorMessage } from '../../services/apiClient'

export function RegisterPage() {
  const { t } = useTranslation()
  const { login } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    email: '',
    password: '',
  })

  const update = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await authApi.register({
        ...form,
        password_confirm: form.password,
      })
      const user = await login(form.email, form.password)
      navigate(resolvePostAuthRedirect(params.get('next'), user.role), { replace: true })
    } catch (err) {
      setError(errorMessage(err, t('auth.registerFailed')))
    } finally {
      setLoading(false)
    }
  }

  return (
    <PublicLayout>
      <div className="min-h-[calc(100vh-4rem)] bg-slate-50/50 flex flex-col items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 sm:p-8 space-y-6">
          <div className="min-w-0">
            <h1 className="public-title-auth font-bold text-slate-900 tracking-tight text-center">
              {t('auth.registerTitle')}
            </h1>
            {/* div, not p — globals.css unlayered-resets `p { margin: 0 }`, which
                blocks Tailwind's mt-1 the same way it blocks input padding/color. */}
            <div className="text-sm text-slate-500 text-center mt-1">
              {t('auth.registerIntro')}
            </div>
          </div>

          {/* No space-y-* here — Tailwind v4 implements it via margin-bottom on
              non-last children, which .field's own margin-bottom (public.css)
              already supplies; space-y-* would be a second, inert declaration
              for the same blocked property. */}
          <form onSubmit={submit} noValidate>
            <FormField label={t('auth.firstName')}>
              {(p) => (
                <input
                  {...p}
                  value={form.first_name}
                  onChange={(e) => update('first_name', e.target.value)}
                  autoComplete="given-name"
                  required
                  className={AUTH_INPUT_CLASS}
                />
              )}
            </FormField>

            <FormField label={t('auth.lastName')}>
              {(p) => (
                <input
                  {...p}
                  value={form.last_name}
                  onChange={(e) => update('last_name', e.target.value)}
                  autoComplete="family-name"
                  required
                  className={AUTH_INPUT_CLASS}
                />
              )}
            </FormField>

            <FormField label={t('auth.phone')}>
              {(p) => (
                <input
                  {...p}
                  value={form.phone}
                  onChange={(e) => update('phone', e.target.value)}
                  autoComplete="tel"
                  className={AUTH_INPUT_CLASS}
                />
              )}
            </FormField>

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
                    value={form.email}
                    onChange={(e) => update('email', e.target.value)}
                    autoComplete="email"
                    required
                    className={`${AUTH_INPUT_CLASS} public-input--with-icon`}
                  />
                </div>
              )}
            </FormField>

            <FormField label={t('auth.password')} error={error || undefined}>
              {(p) => (
                <div className="relative w-full min-w-0">
                  <Lock
                    className="pointer-events-none absolute inset-y-0 start-3.5 my-auto h-4 w-4 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    {...p}
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={(e) => update('password', e.target.value)}
                    autoComplete="new-password"
                    required
                    className={`${AUTH_INPUT_CLASS} pe-16 public-input--with-icon public-input--with-toggle`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute end-3 top-1/2 -translate-y-1/2 bg-transparent text-xs font-medium text-slate-500 hover:text-slate-700"
                  >
                    {showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  </button>
                </div>
              )}
            </FormField>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 bg-[#0D9488] hover:bg-[#0B7A70] text-white font-semibold tracking-wide rounded-xl text-sm shadow-md hover:shadow-lg transition-all flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? t('auth.creatingAccount') : t('auth.createAccount')}
            </button>
          </form>

          {/* div, not p — it's the last child of the card's space-y-6, and that
              utility's margin-top is inert on a <p> for the same reason. */}
          <div className="text-sm text-slate-500 text-center min-w-0">
            {t('auth.alreadyHaveAccount')}{' '}
            <Link
              to={`/login${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`}
              className="font-medium hover:underline"
            >
              {t('auth.signIn')}
            </Link>
          </div>
        </div>
      </div>
    </PublicLayout>
  )
}
