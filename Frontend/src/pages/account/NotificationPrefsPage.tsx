import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { errorMessage } from '../../services/apiClient'
import { authApi } from '../../services/auth.api'
import type { NotificationPreference } from '../../services/types'

function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  hint?: string
}) {
  return (
    <label className="flex items-start gap-3 py-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 shrink-0 accent-[#0D9488]"
        style={{ width: '1rem', height: '1rem', minHeight: 0, padding: 0, border: '1px solid #cbd5e1', borderRadius: '0.25rem', background: '#fff' }}
      />
      <span className="text-sm font-medium text-slate-700">
        {label}
        {hint && <div className="mt-0.5 text-xs font-normal text-slate-400">{hint}</div>}
      </span>
    </label>
  )
}

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-5 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
      <div className="mb-2 text-base font-bold text-slate-800">{title}</div>
      <div className="divide-y divide-slate-100">{children}</div>
    </div>
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
      <SectionCard title={t('settings.channels')}>
        <Toggle label={t('settings.inApp')} checked={prefs.in_app_enabled} onChange={set('in_app_enabled')} />
        <Toggle label={t('settings.email')} checked={prefs.email_enabled} onChange={set('email_enabled')} />
        <Toggle label={t('settings.sms')} checked={prefs.sms_enabled} onChange={set('sms_enabled')} hint={t('settings.smsHint')} />
        <Toggle label={t('settings.whatsapp')} checked={prefs.whatsapp_enabled} onChange={set('whatsapp_enabled')} hint={t('settings.whatsappHint')} />
      </SectionCard>
      <SectionCard title={t('settings.reminders')}>
        <Toggle label={t('settings.reminder24h')} checked={prefs.reminder_24h} onChange={set('reminder_24h')} />
        <Toggle label={t('settings.reminder1h')} checked={prefs.reminder_1h} onChange={set('reminder_1h')} />
      </SectionCard>
      <button
        type="button"
        disabled={save.isPending}
        onClick={() => save.mutate()}
        className="rounded-xl border-none bg-[#0D9488] px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#0B7A70] disabled:opacity-60"
      >
        {t('settings.save')}
      </button>
    </>
  )
}

// Mounted at /account/notifications for Doctor/Secretary/Manager (Patient uses
// its own PatientNotificationSettingsPage fork at /patient/settings — same
// markup, kept separate rather than merged since the two routes may still
// diverge later).
export function NotificationPrefsPage() {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({ queryKey: ['notif-prefs'], queryFn: authApi.notificationPreference })

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('settings.title') }]} />
      <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>
        {t('settings.title')}
      </h1>
      <div className="mt-1 mb-6">
        <p className="text-sm text-slate-500">{t('notifications.title')}</p>
      </div>

      {isLoading || !data ? <CenteredSpinner /> : <PrefsForm initial={data} />}
    </div>
  )
}
