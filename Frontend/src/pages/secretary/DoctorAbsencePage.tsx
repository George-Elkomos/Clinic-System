import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Button } from '../../components/primitives/Button'
import { Card } from '../../components/primitives/Card'
import { useConfirm } from '../../components/primitives/ConfirmDialog'
import { FormField } from '../../components/primitives/FormField'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { doctorsApi } from '../../services/doctors.api'

const TYPES = ['VACATION', 'SICK', 'CONFERENCE', 'BLOCKED_DATE', 'OTHER']

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export function DoctorAbsencePage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()

  const [doctorId, setDoctorId] = useState<number | ''>('')
  const [startDate, setStartDate] = useState(todayISO())
  const [endDate, setEndDate] = useState(todayISO())
  const [absenceType, setAbsenceType] = useState('VACATION')
  const [reason, setReason] = useState('')

  const { data: doctors } = useQuery({ queryKey: ['doctors'], queryFn: () => doctorsApi.list() })
  const { data: absences = [], isLoading } = useQuery({
    queryKey: ['absences'],
    queryFn: () => doctorsApi.absences(),
  })

  const create = useMutation({
    mutationFn: () =>
      doctorsApi.createAbsence({
        doctor: Number(doctorId), start_date: startDate, end_date: endDate,
        absence_type: absenceType, reason,
      }),
    onSuccess: () => {
      showToast(t('absence.created'), 'success')
      setReason('')
      qc.invalidateQueries({ queryKey: ['absences'] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const submit = async () => {
    if (await confirm({ title: t('absence.create'), message: t('absence.createConfirm'), danger: true })) {
      create.mutate()
    }
  }

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('absence.title') }]} />
      <h1>{t('absence.title')}</h1>
      <p>{t('absence.intro')}</p>

      <Card title={t('absence.create')}>
        <FormField label={t('absence.doctor')}>
          {(p) => (
            <Select
              id={p.id}
              options={(doctors?.results ?? []).map((d) => ({ value: d.id, label: d.full_name }))}
              value={doctorId}
              onChange={(v) => setDoctorId(Array.isArray(v) || v === '' ? '' : Number(v))}
              placeholder="—"
              searchable
            />
          )}
        </FormField>
        <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 150 }}>
            <FormField label={t('absence.startDate')}>
              {(p) => <input {...p} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />}
            </FormField>
          </div>
          <div style={{ flex: 1, minWidth: 150 }}>
            <FormField label={t('absence.endDate')}>
              {(p) => <input {...p} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />}
            </FormField>
          </div>
          <div style={{ flex: 1, minWidth: 150 }}>
            <FormField label={t('absence.type')}>
              {(p) => (
                <Select
                  id={p.id}
                  options={TYPES.map((ty) => ({ value: ty, label: t(`absence.types.${ty}`) }))}
                  value={absenceType}
                  onChange={(v) => setAbsenceType(Array.isArray(v) ? 'VACATION' : String(v))}
                />
              )}
            </FormField>
          </div>
        </div>
        <FormField label={t('absence.reason')}>
          {(p) => <input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </FormField>
        <Button loading={create.isPending} disabled={!doctorId} onClick={submit}>{t('absence.create')}</Button>
      </Card>

      <Card title={t('absence.title')}>
        {isLoading ? <CenteredSpinner /> : absences.length === 0 ? <p>{t('absence.none')}</p> : (
          absences.map((a) => (
            <div key={a.id} style={{ padding: 'var(--space-3) 0', borderBottom: '1px solid var(--surface-2)' }}>
              <strong>{t(`absence.types.${a.absence_type}`)}</strong> · {formatDate(a.start_date, language)} – {formatDate(a.end_date, language)}
              {a.reason && <div style={{ color: 'var(--text-muted)' }}>{a.reason}</div>}
            </div>
          ))
        )}
      </Card>
    </div>
  )
}
