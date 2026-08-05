import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Button } from '../../components/primitives/Button'
import { FormField } from '../../components/primitives/FormField'
import { LanguageSwitcher } from '../../components/primitives/LanguageSwitcher'
import { authApi } from '../../services/auth.api'
import { errorMessage } from '../../services/apiClient'

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
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-5)' }}>
      <div className="card" style={{ maxWidth: 440, width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ color: 'var(--primary)' }}>{t('app.name')}</h1>
          <LanguageSwitcher />
        </div>
        <h2>{t('auth.forgotPasswordTitle')}</h2>

        {sent ? (
          <>
            <p role="status">{t('auth.resetLinkSent')}</p>
            <p style={{ textAlign: 'center', marginTop: 'var(--space-4)' }}>
              <Link to="/login">{t('auth.backToLogin')}</Link>
            </p>
          </>
        ) : (
          <>
            <p style={{ color: 'var(--text-muted)' }}>{t('auth.forgotPasswordIntro')}</p>
            <form onSubmit={submit} noValidate>
              <FormField label={t('auth.email')} error={error || undefined}>
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
              <Button type="submit" loading={loading} block>
                {loading ? t('auth.sendingResetLink') : t('auth.sendResetLink')}
              </Button>
            </form>
            <p style={{ textAlign: 'center', marginTop: 'var(--space-4)' }}>
              <Link to="/login">{t('auth.backToLogin')}</Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
