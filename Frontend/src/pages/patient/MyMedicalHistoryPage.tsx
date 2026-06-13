import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Button } from '../../components/primitives/Button'
import { Card } from '../../components/primitives/Card'
import { FormField } from '../../components/primitives/FormField'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { authApi } from '../../services/auth.api'
import { medicalApi } from '../../services/medical.api'
import type { PatientProfile } from '../../services/types'

// Initialized from the loaded profile (mounted only once data is present), so no
// state-syncing effect is needed.
function BackgroundForm({ initial }: { initial: PatientProfile }) {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const qc = useQueryClient()
  const [form, setForm] = useState({
    blood_type: initial.blood_type ?? '',
    allergies_summary: initial.allergies_summary ?? '',
    chronic_conditions: initial.chronic_conditions ?? '',
    previous_surgeries: initial.previous_surgeries ?? '',
    current_medications: initial.current_medications ?? '',
  })

  const save = useMutation({
    mutationFn: () => authApi.updatePatientProfile(form as Partial<PatientProfile>),
    onSuccess: () => {
      showToast(t('medical.backgroundSaved'), 'success')
      qc.invalidateQueries({ queryKey: ['patient-profile'] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <Card title={t('medical.background')}>
      <p>{t('medical.backgroundIntro')}</p>
      <FormField label={t('medical.bloodType')}>
        {(p) => <input {...p} value={form.blood_type} onChange={set('blood_type')} />}
      </FormField>
      <FormField label={t('medical.allergies')}>
        {(p) => <textarea {...p} rows={2} value={form.allergies_summary} onChange={set('allergies_summary')} />}
      </FormField>
      <FormField label={t('medical.chronicConditions')}>
        {(p) => <textarea {...p} rows={2} value={form.chronic_conditions} onChange={set('chronic_conditions')} />}
      </FormField>
      <FormField label={t('medical.previousSurgeries')}>
        {(p) => <textarea {...p} rows={2} value={form.previous_surgeries} onChange={set('previous_surgeries')} />}
      </FormField>
      <FormField label={t('medical.currentMedications')}>
        {(p) => <textarea {...p} rows={2} value={form.current_medications} onChange={set('current_medications')} />}
      </FormField>
      <Button loading={save.isPending} onClick={() => save.mutate()}>{t('medical.saveBackground')}</Button>
    </Card>
  )
}

export function MyMedicalHistoryPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()

  const { data: profile, isLoading } = useQuery({
    queryKey: ['patient-profile'],
    queryFn: authApi.patientProfile,
  })
  const { data: records = [] } = useQuery({ queryKey: ['records', 'mine'], queryFn: () => medicalApi.records() })
  const { data: notes = [] } = useQuery({ queryKey: ['notes', 'mine'], queryFn: () => medicalApi.notes() })

  if (isLoading || !profile) return <CenteredSpinner />

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('nav.medicalHistory') }]} />
      <h1>{t('nav.medicalHistory')}</h1>

      <BackgroundForm initial={profile} />

      <Card title={t('medical.records')}>
        {records.length === 0 ? (
          <p>{t('medical.noRecords')}</p>
        ) : (
          records.map((r) => (
            <div key={r.id} style={{ padding: 'var(--space-3) 0', borderBottom: '1px solid var(--surface-2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>{t('medical.version', { n: r.version })}{r.is_current ? ` · ${t('medical.current')}` : ''}</strong>
                <span style={{ color: 'var(--text-muted)' }}>{formatDate(r.created_at, language)} · {r.doctor_name}</span>
              </div>
              {r.diagnosis && <div>{t('medical.diagnosis')}: {r.diagnosis}</div>}
              {r.treatment_plan && <div>{t('medical.treatmentPlan')}: {r.treatment_plan}</div>}
            </div>
          ))
        )}
      </Card>

      <Card title={t('medical.notes')}>
        {notes.length === 0 ? (
          <p>{t('medical.noNotes')}</p>
        ) : (
          notes.map((n) => (
            <div key={n.id} style={{ padding: 'var(--space-3) 0', borderBottom: '1px solid var(--surface-2)' }}>
              <div style={{ color: 'var(--text-muted)' }}>{n.specialty_category_name} · {n.doctor_name} · {formatDate(n.created_at, language)}</div>
              <div>{n.body}</div>
            </div>
          ))
        )}
      </Card>
    </div>
  )
}
