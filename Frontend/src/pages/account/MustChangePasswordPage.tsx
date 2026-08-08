import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { Button } from '../../components/primitives/Button'
import { FormField } from '../../components/primitives/FormField'
import { LanguageSwitcher } from '../../components/primitives/LanguageSwitcher'
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
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-5)' }}>
      <div className="card" style={{ maxWidth: 440, width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ color: 'var(--primary)' }}>{t('app.name')}</h1>
          <LanguageSwitcher />
        </div>
        <h2>{t('auth.mustChangePasswordTitle')}</h2>
        <p style={{ color: 'var(--text-muted)' }}>{t('auth.mustChangePasswordIntro')}</p>

        <form onSubmit={submit} noValidate>
          <FormField label={t('auth.currentPassword')}>
            {(p) => (
              <input
                {...p}
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            )}
          </FormField>

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
            {loading ? t('auth.changingPassword') : t('auth.changePasswordSubmit')}
          </Button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 'var(--space-4)' }}>
          <button
            type="button"
            onClick={() => void logout()}
            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--primary)', cursor: 'pointer' }}
          >
            {t('nav.signOut')}
          </button>
        </p>
      </div>
    </div>
  )
}
