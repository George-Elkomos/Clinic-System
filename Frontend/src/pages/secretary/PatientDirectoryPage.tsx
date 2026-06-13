import { useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Button } from '../../components/primitives/Button'
import { SearchInput } from '../../components/primitives/SearchInput'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { appointmentsApi } from '../../services/appointments.api'
import type { PatientSummary } from '../../services/types'
import { PatientProfileEditorModal } from './PatientProfileEditorModal'
import { RegisterPatientModal } from './RegisterPatientModal'

export function PatientDirectoryPage() {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<PatientSummary | null>(null)
  const [registering, setRegistering] = useState(false)
  const onSearch = useCallback((value: string) => setSearch(value), [])

  const { data = [], isLoading, refetch } = useQuery({
    queryKey: ['patient-directory', search],
    queryFn: () => appointmentsApi.patients(search || undefined),
  })

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('patients.title') }]} />
      <div className="page-heading-row">
        <div>
          <h1>{t('patients.title')}</h1>
          <p style={{ color: 'var(--text-muted)' }}>{t('patients.directoryIntro')}</p>
        </div>
        <Button onClick={() => setRegistering(true)}>{t('patients.register')}</Button>
      </div>

      <section className="card">
        <SearchInput onSearch={onSearch} placeholder={t('patients.searchPlaceholder')} />
      </section>

      <section className="card">
        {isLoading ? (
          <CenteredSpinner />
        ) : data.length === 0 ? (
          <p>{t('patients.none')}</p>
        ) : (
          <table className="user-table">
            <thead>
              <tr>
                <th>{t('appointments.patient')}</th>
                <th>{t('auth.phone')}</th>
                <th>{t('auth.email')}</th>
                <th>{t('patients.dateOfBirth')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((patient) => (
                <tr key={patient.id}>
                  <td>{patient.full_name}</td>
                  <td>{patient.phone || t('common.none')}</td>
                  <td>{patient.email || t('patients.noEmailShort')}</td>
                  <td>{patient.date_of_birth || t('common.none')}</td>
                  <td>
                    <Button variant="secondary" onClick={() => setEditing(patient)}>
                      {t('patients.editProfile')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

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
