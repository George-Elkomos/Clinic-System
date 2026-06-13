import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Button } from '../../components/primitives/Button'
import { Card } from '../../components/primitives/Card'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { errorMessage } from '../../services/apiClient'
import { authApi } from '../../services/auth.api'
import type { NotificationPreference } from '../../services/types'

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', padding: 'var(--space-2) 0' }}>
      <input type="checkbox" style={{ width: 'auto', minHeight: 'auto', marginTop: 4 }} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-small)' }}>{hint}</div>}
      </span>
    </label>
  )
}

function PrefsForm({ initial }: { initial: NotificationPreference }) {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const qc = useQueryClient()
  const [prefs, setPrefs] = useState<NotificationPreference>(initial)

  const save = useMutation({
    mutationFn: () => authApi.updateNotificationPreference(prefs),
    onSuccess: () => {
      showToast(t('settings.saved'), 'success')
      qc.invalidateQueries({ queryKey: ['notif-prefs'] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const set = (k: keyof NotificationPreference) => (v: boolean) => setPrefs((p) => ({ ...p, [k]: v }))

  return (
    <>
      <Card title={t('settings.channels')}>
        <Toggle label={t('settings.inApp')} checked={prefs.in_app_enabled} onChange={set('in_app_enabled')} />
        <Toggle label={t('settings.email')} checked={prefs.email_enabled} onChange={set('email_enabled')} />
        <Toggle label={t('settings.sms')} checked={prefs.sms_enabled} onChange={set('sms_enabled')} hint={t('settings.smsHint')} />
        <Toggle label={t('settings.whatsapp')} checked={prefs.whatsapp_enabled} onChange={set('whatsapp_enabled')} hint={t('settings.whatsappHint')} />
      </Card>
      <Card title={t('settings.reminders')}>
        <Toggle label={t('settings.reminder24h')} checked={prefs.reminder_24h} onChange={set('reminder_24h')} />
        <Toggle label={t('settings.reminder1h')} checked={prefs.reminder_1h} onChange={set('reminder_1h')} />
      </Card>
      <Button loading={save.isPending} onClick={() => save.mutate()}>{t('settings.save')}</Button>
    </>
  )
}

export function NotificationPrefsPage() {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({ queryKey: ['notif-prefs'], queryFn: authApi.notificationPreference })

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('settings.title') }]} />
      <h1>{t('settings.title')}</h1>
      {isLoading || !data ? <CenteredSpinner /> : <PrefsForm initial={data} />}
    </div>
  )
}
