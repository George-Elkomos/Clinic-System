import { useMutation, useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { useConfirm } from '../../components/primitives/ConfirmDialog'
import { SearchInput } from '../../components/primitives/SearchInput'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { errorMessage } from '../../services/apiClient'
import { appointmentsApi } from '../../services/appointments.api'
import { staffApi } from '../../services/staff.api'
import type { PatientSummary } from '../../services/types'
import { PatientProfileEditorModal } from './PatientProfileEditorModal'
import { RegisterPatientModal } from './RegisterPatientModal'

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all sm:text-sm'
const BTN_SECONDARY_SM = 'inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-all'

export function PatientDirectoryPage() {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<PatientSummary | null>(null)
  const [registering, setRegistering] = useState(false)
  const [tempPassword, setTempPassword] = useState('')
  const onSearch = useCallback((value: string) => setSearch(value), [])

  const { data = [], isLoading, refetch } = useQuery({
    queryKey: ['patient-directory', search],
    queryFn: () => appointmentsApi.patients(search || undefined),
  })

  const resetPassword = useMutation({
    mutationFn: staffApi.resetPassword,
    onSuccess: (data) => {
      setTempPassword(data.temp_password)
      showToast(t('staff.passwordReset'), 'success')
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const requestReset = async (patient: PatientSummary) => {
    const ok = await confirm({
      title: t('staff.resetPassword'),
      message: t('staff.resetPasswordConfirm', { name: patient.full_name }),
      confirmLabel: t('staff.resetPassword'),
    })
    if (ok) resetPassword.mutate(patient.user_id)
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[{ label: t('patients.title') }]} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>{t('patients.title')}</h1>
            <p className="patient-text-body-secondary mt-1" style={{ color: 'var(--text-secondary)' }}>{t('patients.directoryIntro')}</p>
          </div>
          <button type="button" onClick={() => setRegistering(true)} className={BTN_PRIMARY}>{t('patients.register')}</button>
        </div>
      </div>

      <div className={CARD}>
        <SearchInput onSearch={onSearch} placeholder={t('patients.searchPlaceholder')} />
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
          <p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{t('patients.none')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-slate-100">
                  <th className="patient-text-overline px-3 py-2 text-left" style={{ color: 'var(--text-muted)' }}>{t('appointments.patient')}</th>
                  <th className="patient-text-overline px-3 py-2 text-left" style={{ color: 'var(--text-muted)' }}>{t('auth.phone')}</th>
                  <th className="patient-text-overline px-3 py-2 text-left" style={{ color: 'var(--text-muted)' }}>{t('auth.email')}</th>
                  <th className="patient-text-overline px-3 py-2 text-left" style={{ color: 'var(--text-muted)' }}>{t('patients.dateOfBirth')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.map((patient) => (
                  <tr key={patient.id} className="border-b border-slate-100">
                    <td className="px-3 py-2.5 font-semibold" style={{ color: 'var(--text-primary)' }}>{patient.full_name}</td>
                    <td className="px-3 py-2.5 patient-text-body" style={{ color: 'var(--text-secondary)' }}>{patient.phone || t('common.none')}</td>
                    <td className="px-3 py-2.5 patient-text-body" style={{ color: 'var(--text-secondary)' }}>{patient.email || t('patients.noEmailShort')}</td>
                    <td className="px-3 py-2.5 patient-text-body-secondary" style={{ color: 'var(--text-muted)' }}>{patient.date_of_birth || t('common.none')}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => setEditing(patient)} className={BTN_SECONDARY_SM}>
                          {t('patients.editProfile')}
                        </button>
                        <button
                          type="button"
                          disabled={resetPassword.isPending && resetPassword.variables === patient.user_id}
                          onClick={() => requestReset(patient)}
                          className={BTN_SECONDARY_SM}
                        >
                          {t('staff.resetPassword')}
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
        <PatientProfileEditorModal
          profileId={editing.id}
          onClose={() => setEditing(null)}
          onSaved={() => refetch()}
        />
      )}
      {registering && (
        <RegisterPatientModal
          onClose={() => setRegistering(false)}
          onCreated={() => refetch()}
        />
      )}
    </div>
  )
}
