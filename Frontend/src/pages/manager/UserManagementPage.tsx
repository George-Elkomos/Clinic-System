import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Button } from '../../components/primitives/Button'
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
    <div>
      <Breadcrumbs trail={[{ label: t('staff.users') }]} />
      <div className="page-heading-row">
        <div>
          <h1>{t('staff.users')}</h1>
          <p style={{ color: 'var(--text-muted)' }}>{t('staff.usersIntro')}</p>
        </div>
        <Button onClick={addNew}>{t('staff.addNew')}</Button>
      </div>

      <div className="tabs" role="tablist" aria-label={t('staff.users')}>
        {TABS.map((tab) => (
          <button
            key={tab.role}
            type="button"
            role="tab"
            className={`tab${role === tab.role ? ' tab--active' : ''}`}
            aria-selected={role === tab.role}
            onClick={() => setRole(tab.role)}
          >
            {t(tab.key)}
          </button>
        ))}
      </div>

      <section className="card">
        <SearchInput onSearch={onSearch} placeholder={t('staff.searchUsers')} />
      </section>

      {tempPassword && (
        <section className="temp-password-box">
          <p>{t('staff.tempPasswordNote')}</p>
          <div className="temp-password-box__code">{tempPassword}</div>
          <Button
            variant="secondary"
            onClick={() => navigator.clipboard?.writeText(tempPassword)}
            style={{ marginTop: 'var(--space-3)' }}
          >
            {t('staff.copyPassword')}
          </Button>
        </section>
      )}

      <section className="card">
        {isLoading ? (
          <CenteredSpinner />
        ) : data.length === 0 ? (
          <p>{t('staff.noUsers')}</p>
        ) : (
          <table className="user-table">
            <thead>
              <tr>
                <th>{t('staff.fullName')}</th>
                <th>{t('auth.email')}</th>
                <th>{t('auth.phone')}</th>
                <th>{t('staff.status')}</th>
                <th className="col-hide-mobile">{t('staff.joined')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((user) => (
                <tr key={user.id} className={user.is_active ? undefined : 'inactive-row'}>
                  <td>{user.full_name}</td>
                  <td>{user.email}</td>
                  <td>{user.phone || t('common.none')}</td>
                  <td>
                    <span className={`badge ${user.is_active ? 'badge--active' : 'badge--inactive'}`}>
                      {user.is_active ? t('staff.active') : t('staff.inactive')}
                    </span>
                  </td>
                  <td className="col-hide-mobile">{formatDate(user.date_joined, language)}</td>
                  <td>
                    <div className="user-table__actions">
                      <Button variant="secondary" onClick={() => setEditing(user)}>{t('common.edit')}</Button>
                      <Button variant="secondary" onClick={() => requestReset(user)}>{t('staff.resetPassword')}</Button>
                      <Button
                        variant={user.is_active ? 'danger' : 'secondary'}
                        onClick={() => requestToggle(user)}
                      >
                        {user.is_active ? t('staff.deactivate') : t('staff.reactivate')}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

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
