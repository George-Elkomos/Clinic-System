import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { PublicLayout } from '../../components/layout/PublicLayout'
import { Button } from '../../components/primitives/Button'
import { FormField } from '../../components/primitives/FormField'
import { useAuth } from '../../hooks/useAuth'
import { roleHome } from '../../routes/roleHome'
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
      navigate(params.get('next') || roleHome(user.role), { replace: true })
    } catch (err) {
      setError(errorMessage(err, t('auth.registerFailed')))
    } finally {
      setLoading(false)
    }
  }

  return (
    <PublicLayout>
      <main className="pub-main" style={{ maxWidth: 620 }}>
        <h1>{t('auth.registerTitle')}</h1>
        <p style={{ color: 'var(--text-muted)' }}>{t('auth.registerIntro')}</p>

        <form className="card" onSubmit={submit} noValidate>
          <FormField label={t('auth.firstName')}>
            {(p) => (
              <input
                {...p}
                value={form.first_name}
                onChange={(e) => update('first_name', e.target.value)}
                autoComplete="given-name"
                required
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
              />
            )}
          </FormField>

          <FormField label={t('auth.email')}>
            {(p) => (
              <input
                {...p}
                type="email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                autoComplete="email"
                required
              />
            )}
          </FormField>

          <FormField label={t('auth.password')} error={error || undefined}>
            {(p) => (
              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'stretch' }}>
                <input
                  {...p}
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => update('password', e.target.value)}
                  autoComplete="new-password"
                  required
                  style={{ flex: 1 }}
                />
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                </Button>
              </div>
            )}
          </FormField>

          <Button type="submit" loading={loading} block>
            {loading ? t('auth.creatingAccount') : t('auth.createAccount')}
          </Button>
        </form>

        <p style={{ textAlign: 'center' }}>
          {t('auth.alreadyHaveAccount')}{' '}
          <Link to={`/login${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`}>
            {t('auth.signIn')}
          </Link>
        </p>
      </main>
    </PublicLayout>
  )
}
