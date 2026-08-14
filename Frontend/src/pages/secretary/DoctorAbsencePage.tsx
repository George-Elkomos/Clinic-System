import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { useConfirm } from '../../components/primitives/ConfirmDialog'
import { CustomDatePicker } from '../../components/primitives/CustomDatePicker'
import { FormField } from '../../components/primitives/FormField'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner, Spinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { useAuth } from '../../hooks/useAuth'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { doctorsApi } from '../../services/doctors.api'

const TYPES = ['VACATION', 'SICK', 'CONFERENCE', 'BLOCKED_DATE', 'OTHER']

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all disabled:opacity-60 sm:text-sm'

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export function DoctorAbsencePage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { language } = useLanguage()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const isManager = user?.role === 'MANAGER'

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
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[{ label: t('absence.title') }]} />
        <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>{t('absence.title')}</h1>
        <p className="patient-text-body-secondary mt-1" style={{ color: 'var(--text-secondary)' }}>{t('absence.intro')}</p>
      </div>

      {isManager && (
      <div className={CARD}>
        <h2 className="patient-text-card-title mb-4" style={{ color: 'var(--text-primary)' }}>{t('absence.create')}</h2>
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField label={t('absence.startDate')}>
            {(p) => <CustomDatePicker {...p} variant="field" allowClear={false} value={startDate} onChange={setStartDate} />}
          </FormField>
          <FormField label={t('absence.endDate')}>
            {(p) => <CustomDatePicker {...p} variant="field" allowClear={false} value={endDate} onChange={setEndDate} />}
          </FormField>
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
        <FormField label={t('absence.reason')}>
          {(p) => <input {...p} className="patient-field" value={reason} onChange={(e) => setReason(e.target.value)} />}
        </FormField>
        <button type="button" disabled={create.isPending || !doctorId} onClick={submit} className={BTN_PRIMARY}>
          {create.isPending && <Spinner size={14} />}{t('absence.create')}
        </button>
      </div>
      )}

      <div className={CARD}>
        <h2 className="patient-text-card-title mb-3" style={{ color: 'var(--text-primary)' }}>{t('absence.title')}</h2>
        {isLoading ? <CenteredSpinner /> : absences.length === 0 ? (
          <p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{t('absence.none')}</p>
        ) : (
          <div className="flex flex-col divide-y divide-slate-100">
            {absences.map((a) => (
              <div key={a.id} className="py-3">
                <span className="patient-text-body font-semibold" style={{ color: 'var(--text-primary)' }}>{t(`absence.types.${a.absence_type}`)}</span>
                <span className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}> · {formatDate(a.start_date, language)} – {formatDate(a.end_date, language)}</span>
                {a.reason && <div className="patient-text-body-secondary mt-0.5" style={{ color: 'var(--text-muted)' }}>{a.reason}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
