import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { useConfirm } from '../../components/primitives/ConfirmDialog'
import { FormField } from '../../components/primitives/FormField'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner, Spinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDateTime } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { appointmentsApi } from '../../services/appointments.api'
import type { Appointment, AppointmentStatus } from '../../services/types'

const STATUSES: AppointmentStatus[] = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']

const STATUS_BADGE: Record<AppointmentStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200/60',
  CONFIRMED: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  CHECKED_IN: 'bg-teal-50 text-teal-700 border-teal-200/60',
  IN_PROGRESS: 'bg-sky-50 text-sky-700 border-sky-200/60',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  CANCELLED: 'bg-slate-50 text-slate-500 border-slate-200/60',
  NO_SHOW: 'bg-slate-50 text-slate-500 border-slate-200/60',
}

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#1AB5B3] to-[#38E4DD] px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-95 disabled:opacity-60'
const BTN_DANGER = 'inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-medium text-rose-600 transition-all hover:bg-rose-100 disabled:opacity-60'

export function AppointmentDeskPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const [status, setStatus] = useState<string>('PENDING')

  const { data, isLoading } = useQuery({
    queryKey: ['appointments', 'desk', status],
    queryFn: () => appointmentsApi.list(status ? { status } : undefined),
  })

  const confirmAppt = useMutation({
    mutationFn: (id: number) => appointmentsApi.confirm(id),
    onSuccess: () => {
      showToast(t('appointments.confirmed'), 'success')
      qc.invalidateQueries({ queryKey: ['appointments'] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const cancelAppt = useMutation({
    mutationFn: (id: number) => appointmentsApi.cancel(id),
    onSuccess: () => {
      showToast(t('appointments.cancelled'), 'success')
      qc.invalidateQueries({ queryKey: ['appointments'] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const onCancel = async (a: Appointment) => {
    const ok = await confirm({
      title: t('appointments.cancel'),
      message: t('appointments.cancelConfirm', {
        name: a.patient_name,
        when: formatDateTime(a.scheduled_start, language),
      }),
      confirmLabel: t('appointments.cancel'),
      danger: true,
    })
    if (ok) cancelAppt.mutate(a.id)
  }

  const rows = data?.results ?? []

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[{ label: t('nav.appointmentDesk') }]} />
        <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>{t('nav.appointmentDesk')}</h1>
      </div>

      <div className={CARD}>
        <FormField label={t('appointments.status')}>
          {(p) => (
            <Select
              id={p.id}
              options={[
                { value: '', label: t('appointments.filterAll') },
                ...STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) })),
              ]}
              value={status}
              onChange={(v) => setStatus(Array.isArray(v) ? '' : String(v))}
            />
          )}
        </FormField>
      </div>

      {isLoading ? (
        <CenteredSpinner />
      ) : rows.length === 0 ? (
        <div className={CARD}><p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{t('appointments.noResults')}</p></div>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((a) => (
            <div key={a.id} className={CARD}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="patient-text-card-title truncate" style={{ color: 'var(--text-primary)' }}>{a.patient_name}</h3>
                  <div className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>
                    {a.doctor_name} · {formatDateTime(a.scheduled_start, language)}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_BADGE[a.status] ?? STATUS_BADGE.CANCELLED}`}>
                    {t(`status.${a.status}`)}
                  </span>
                  {a.status === 'PENDING' && (
                    <button
                      type="button"
                      disabled={confirmAppt.isPending && confirmAppt.variables === a.id}
                      onClick={() => confirmAppt.mutate(a.id)}
                      className={BTN_PRIMARY}
                    >
                      {confirmAppt.isPending && confirmAppt.variables === a.id && <Spinner size={14} />}{t('appointments.confirm')}
                    </button>
                  )}
                  {['PENDING', 'CONFIRMED'].includes(a.status) && (
                    <button type="button" onClick={() => onCancel(a)} className={BTN_DANGER}>{t('appointments.cancel')}</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
