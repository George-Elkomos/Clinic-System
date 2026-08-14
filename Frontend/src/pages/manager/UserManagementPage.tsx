import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { useConfirm } from '../../components/primitives/ConfirmDialog'
import { SearchInput } from '../../components/primitives/SearchInput'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { staffApi } from '../../services/staff.api'
import type { Role, UserManagementEntry } from '../../services/types'
import { RegisterPatientModal } from '../secretary/RegisterPatientModal'
import { CreateSecretaryModal } from './CreateSecretaryModal'
import { UserEditModal } from './UserEditModal'

const TABS: Array<{ role: Role; key: string }> = [
  { role: 'DOCTOR', key: 'staff.doctors' },
  { role: 'SECRETARY', key: 'staff.secretaries' },
  { role: 'PATIENT', key: 'staff.patients' },
]

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all sm:text-sm'
const BTN_SECONDARY_SM = 'inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-all'
const BTN_DANGER_SM = 'inline-flex items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-600 transition-all hover:bg-rose-100'

export function UserManagementPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [role, setRole] = useState<Role>('DOCTOR')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<UserManagementEntry | null>(null)
  const [creatingSecretary, setCreatingSecretary] = useState(false)
  const [creatingPatient, setCreatingPatient] = useState(false)
  const [tempPassword, setTempPassword] = useState('')
  const onSearch = useCallback((value: string) => setSearch(value), [])

  const queryKey = ['staff-users', role, search]
  const { data = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => staffApi.listUsers(role, search || undefined),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['staff-users'] })

  const toggleActive = useMutation({
    mutationFn: ({ userId, active }: { userId: number; active: boolean }) =>
      active ? staffApi.reactivateUser(userId) : staffApi.deactivateUser(userId),
    onSuccess: () => {
      showToast(t('staff.userSaved'), 'success')
      invalidate()
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const resetPassword = useMutation({
    mutationFn: staffApi.resetPassword,
    onSuccess: (data) => {
      setTempPassword(data.temp_password)
      showToast(t('staff.passwordReset'), 'success')
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const addNew = () => {
    if (role === 'DOCTOR') navigate('/manager/doctors/new')
    if (role === 'SECRETARY') setCreatingSecretary(true)
    if (role === 'PATIENT') setCreatingPatient(true)
  }

  const requestReset = async (user: UserManagementEntry) => {
    const ok = await confirm({
      title: t('staff.resetPassword'),
      message: t('staff.resetPasswordConfirm', { name: user.full_name }),
      confirmLabel: t('staff.resetPassword'),
    })
    if (ok) resetPassword.mutate(user.id)
  }

  const requestToggle = async (user: UserManagementEntry) => {
    const nextActive = !user.is_active
    const ok = await confirm({
      title: nextActive ? t('staff.reactivate') : t('staff.deactivate'),
      message: nextActive
        ? t('staff.reactivateConfirm', { name: user.full_name })
        : t('staff.deactivateConfirm', { name: user.full_name }),
      confirmLabel: nextActive ? t('staff.reactivate') : t('staff.deactivate'),
      danger: !nextActive,
    })
    if (ok) toggleActive.mutate({ userId: user.id, active: nextActive })
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[{ label: t('staff.users') }]} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>{t('staff.users')}</h1>
            <p className="patient-text-body-secondary mt-1" style={{ color: 'var(--text-secondary)' }}>{t('staff.usersIntro')}</p>
          </div>
          <button type="button" onClick={addNew} className={BTN_PRIMARY}>{t('staff.addNew')}</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('staff.users')}>
        {TABS.map((tab) => (
          <button
            key={tab.role}
            type="button"
            role="tab"
            aria-selected={role === tab.role}
            onClick={() => setRole(tab.role)}
            className={
              role === tab.role
                ? 'rounded-xl border border-[#0B7A70] bg-[#0D9488] px-4 py-2 text-xs font-semibold text-white shadow-sm sm:text-sm'
                : 'rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 transition-all hover:bg-slate-50 sm:text-sm'
            }
          >
            {t(tab.key)}
          </button>
        ))}
      </div>

      <div className={CARD}>
        <SearchInput onSearch={onSearch} placeholder={t('staff.searchUsers')} autoComplete="off" />
      </div>

      {tempPassword && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="patient-text-body" style={{ color: 'var(--text-primary)' }}>{t('staff.tempPasswordNote')}</p>
          <div className="mt-2 rounded-lg bg-white px-3 py-2 text-center font-mono text-lg font-bold" style={{ color: 'var(--brand-teal-start)' }}>
            {tempPassword}
          </div>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(tempPassword)}
            className={`${BTN_SECONDARY_SM} mt-3`}
          >
            {t('staff.copyPassword')}
          </button>
        </div>
      )}

      <div className={CARD}>
        {isLoading ? (
          <CenteredSpinner />
        ) : data.length === 0 ? (
          <p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{t('staff.noUsers')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-slate-100">
                  <th className="patient-text-overline px-3 py-2 text-left" style={{ color: 'var(--text-muted)' }}>{t('staff.fullName')}</th>
                  <th className="patient-text-overline px-3 py-2 text-left" style={{ color: 'var(--text-muted)' }}>{t('auth.email')}</th>
                  <th className="patient-text-overline px-3 py-2 text-left" style={{ color: 'var(--text-muted)' }}>{t('auth.phone')}</th>
                  <th className="patient-text-overline px-3 py-2 text-left" style={{ color: 'var(--text-muted)' }}>{t('staff.status')}</th>
                  <th className="patient-text-overline hidden px-3 py-2 text-left sm:table-cell" style={{ color: 'var(--text-muted)' }}>{t('staff.joined')}</th>
                  <th className="patient-text-overline px-3 py-2 text-left" style={{ color: 'var(--text-muted)' }}>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {data.map((user) => (
                  <tr key={user.id} className={`border-b border-slate-100 ${user.is_active ? '' : 'opacity-60'}`}>
                    <td className="px-3 py-2.5 font-semibold" style={{ color: 'var(--text-primary)' }}>{user.full_name}</td>
                    <td className="px-3 py-2.5 patient-text-body" style={{ color: 'var(--text-secondary)' }}>{user.email}</td>
                    <td className="px-3 py-2.5 patient-text-body" style={{ color: 'var(--text-secondary)' }}>{user.phone || t('common.none')}</td>
                    <td className="px-3 py-2.5">
                      <span className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${
                        user.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-200/60' : 'bg-slate-50 text-slate-500 border-slate-200/60'
                      }`}>
                        {user.is_active ? t('staff.active') : t('staff.inactive')}
                      </span>
                    </td>
                    <td className="hidden px-3 py-2.5 patient-text-body-secondary sm:table-cell" style={{ color: 'var(--text-muted)' }}>{formatDate(user.date_joined, language)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => setEditing(user)} className={BTN_SECONDARY_SM}>{t('common.edit')}</button>
                        <button type="button" onClick={() => requestReset(user)} className={BTN_SECONDARY_SM}>{t('staff.resetPassword')}</button>
                        <button
                          type="button"
                          onClick={() => requestToggle(user)}
                          className={user.is_active ? BTN_DANGER_SM : BTN_SECONDARY_SM}
                        >
                          {user.is_active ? t('staff.deactivate') : t('staff.reactivate')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <UserEditModal
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={invalidate}
        />
      )}
      {creatingSecretary && (
        <CreateSecretaryModal
          onClose={() => setCreatingSecretary(false)}
          onCreated={invalidate}
        />
      )}
      {creatingPatient && (
        <RegisterPatientModal
          onClose={() => setCreatingPatient(false)}
          onCreated={invalidate}
        />
      )}
    </div>
  )
}
