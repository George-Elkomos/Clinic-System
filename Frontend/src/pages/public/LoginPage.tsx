import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { Button } from '../../components/primitives/Button'
import { FormField } from '../../components/primitives/FormField'
import { LanguageSwitcher } from '../../components/primitives/LanguageSwitcher'
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

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-5)' }}>
      <div className="card" style={{ maxWidth: 440, width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ color: 'var(--primary)' }}>{t('app.name')}</h1>
          <LanguageSwitcher />
        </div>
        <h2>{t('auth.loginTitle')}</h2>
        <form onSubmit={submit} noValidate>
          <FormField label={t('auth.email')}>
            {(p) => (
              <input
                {...p}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            )}
          </FormField>
          <FormField label={t('auth.password')} error={error || undefined}>
            {(p) => (
              <input
                {...p}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            )}
          </FormField>
          <Button type="submit" loading={loading} block>
            {loading ? t('auth.signingIn') : t('auth.signIn')}
          </Button>
        </form>
        <p style={{ textAlign: 'center', marginTop: 'var(--space-4)' }}>
          <Link to={`/register${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`}>
            {t('auth.registerLink')}
          </Link>
        </p>
      </div>
    </div>
  )
}
