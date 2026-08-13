import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AvatarUploader } from '../../components/primitives/AvatarUploader'
import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { FormField } from '../../components/primitives/FormField'
import { CenteredSpinner, Spinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { ChangePasswordForm } from '../../components/settings/ChangePasswordForm'
import { useAuth } from '../../hooks/useAuth'
import { errorMessage } from '../../services/apiClient'
import { authApi } from '../../services/auth.api'
import { PrefsForm } from './NotificationPrefsPage'

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const CARD_TITLE = 'mb-4 text-sm font-bold text-slate-800 sm:text-base'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all disabled:opacity-60 sm:text-sm'
const FIELD_CLASS = 'patient-field'

export function AccountSettingsPage() {
  const { t } = useTranslation()
  const { user, refreshUser } = useAuth()
  const { showToast } = useToast()
  const qc = useQueryClient()

  const { data: staffProfile, isLoading: staffLoading } = useQuery({
    queryKey: ['staff-profile'],
    queryFn: authApi.staffProfile,
  })
  const { data: notifPrefs, isLoading: prefsLoading } = useQuery({
    queryKey: ['notif-prefs'],
    queryFn: authApi.notificationPreference,
  })

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [staffId, setStaffId] = useState('')
  const [assignedRoom, setAssignedRoom] = useState('')
  const [avatarValue, setAvatarValue] = useState<File | null | undefined>(undefined)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (user) {
      setFirstName(user.first_name)
      setLastName(user.last_name)
    }
  }, [user])

  useEffect(() => {
    if (!staffProfile) return
    setStaffId(staffProfile.staff_id)
    setAssignedRoom(staffProfile.assigned_room)
  }, [staffProfile])

  const handleSaveProfile = async () => {
    setSaving(true)
    try {
      await Promise.all([
        authApi.updateMe({
          first_name: firstName,
          last_name: lastName,
          ...(avatarValue !== undefined ? { avatar: avatarValue } : {}),
        }),
        authApi.updateStaffProfile({ staff_id: staffId, assigned_room: assignedRoom }),
      ])
      showToast(t('settings.profileSaved'), 'success')
      await refreshUser()
      qc.invalidateQueries({ queryKey: ['staff-profile'] })
      setAvatarValue(undefined)
    } catch (err) {
      showToast(errorMessage(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!user || staffLoading) return <CenteredSpinner />

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[{ label: t('settings.accountSettingsTitle') }]} />
        <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>
          {t('settings.accountSettingsTitle')}
        </h1>
      </div>

      <div className={CARD}>
        <h2 className={CARD_TITLE}>{t('settings.profileSummary')}</h2>
        <AvatarUploader
          name={user.full_name}
          imageUrl={user.avatar_url}
          value={avatarValue}
          onChange={setAvatarValue}
        />

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label={t('auth.firstName')}>
            {(p) => <input {...p} className={FIELD_CLASS} value={firstName} onChange={(e) => setFirstName(e.target.value)} />}
          </FormField>
          <FormField label={t('auth.lastName')}>
            {(p) => <input {...p} className={FIELD_CLASS} value={lastName} onChange={(e) => setLastName(e.target.value)} />}
          </FormField>
          <FormField label={t('settings.roleTitle')}>
            {(p) => <input {...p} className={FIELD_CLASS} value={t(`roles.${user.role}`)} disabled />}
          </FormField>
          <FormField label={t('settings.staffId')}>
            {(p) => <input {...p} className={FIELD_CLASS} value={staffId} onChange={(e) => setStaffId(e.target.value)} />}
          </FormField>
          <FormField label={t('settings.assignedRoom')}>
            {(p) => <input {...p} className={FIELD_CLASS} value={assignedRoom} onChange={(e) => setAssignedRoom(e.target.value)} />}
          </FormField>
        </div>

        <div className="mt-4">
          <button type="button" disabled={saving} onClick={handleSaveProfile} className={BTN_PRIMARY}>
            {saving && <Spinner size={14} />}
            {t('common.save')}
          </button>
        </div>
      </div>

      <div className={CARD}>
        <h2 className={CARD_TITLE}>{t('settings.security')}</h2>
        <ChangePasswordForm />
      </div>

      {prefsLoading || !notifPrefs ? <CenteredSpinner /> : <PrefsForm initial={notifPrefs} />}
    </div>
  )
}
