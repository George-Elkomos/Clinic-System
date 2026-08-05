import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { Button } from '../../components/primitives/Button'
import { FormField } from '../../components/primitives/FormField'
import { LanguageSwitcher } from '../../components/primitives/LanguageSwitcher'
import { authApi } from '../../services/auth.api'
import { errorMessage } from '../../services/apiClient'

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
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-5)' }}>
        <div className="card" style={{ maxWidth: 440, width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h1 style={{ color: 'var(--primary)' }}>{t('app.name')}</h1>
            <LanguageSwitcher />
          </div>
          <h2>{t('auth.resetPasswordTitle')}</h2>
          <p role="alert">{t('auth.resetLinkMissing')}</p>
          <p style={{ textAlign: 'center', marginTop: 'var(--space-4)' }}>
            <Link to="/forgot-password">{t('auth.requestNewLink')}</Link>
          </p>
        </div>
      </div>
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
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-5)' }}>
      <div className="card" style={{ maxWidth: 440, width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ color: 'var(--primary)' }}>{t('app.name')}</h1>
          <LanguageSwitcher />
        </div>
        <h2>{t('auth.resetPasswordTitle')}</h2>

        {done ? (
          <>
            <p role="status">{t('auth.resetPasswordSuccess')}</p>
            <p style={{ textAlign: 'center', marginTop: 'var(--space-4)' }}>
              <Link to="/login">{t('auth.backToLogin')}</Link>
            </p>
          </>
        ) : (
          <>
            <form onSubmit={submit} noValidate>
              <FormField label={t('auth.newPassword')}>
                {(p) => (
                  <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'stretch' }}>
                    <input
                      {...p}
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      style={{ flex: 1 }}
                    />
                    <Button variant="secondary" type="button" onClick={() => setShowPassword((v) => !v)}>
                      {showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                    </Button>
                  </div>
                )}
              </FormField>

              <FormField label={t('auth.confirmNewPassword')} error={error || undefined}>
                {(p) => (
                  <input
                    {...p}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                )}
              </FormField>

              <Button type="submit" loading={loading} block>
                {loading ? t('auth.resettingPassword') : t('auth.resetPasswordSubmit')}
              </Button>
            </form>

            {linkInvalid && (
              <p style={{ textAlign: 'center', marginTop: 'var(--space-4)' }}>
                <Link to="/forgot-password">{t('auth.requestNewLink')}</Link>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
