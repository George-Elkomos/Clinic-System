import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { FormField } from '../../components/primitives/FormField'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner, Spinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDateTime } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { appointmentsApi } from '../../services/appointments.api'
import type { Appointment, AppointmentStatus } from '../../services/types'

// The desk only ever needs to filter by these five buckets — CONFIRMED and
// CHECKED_IN collapse into one "Confirmed / Arrived" option (comma-separated
// value -> AppointmentFilter's status__in on the backend) since front-desk
// staff don't need to distinguish "confirmed but not yet arrived" from
// "arrived" here. IN_PROGRESS is the doctor's live-queue concern, not the
// desk's, so it's deliberately not offered.
const STATUS_FILTERS: { value: string; labelKey: string }[] = [
  { value: 'PENDING', labelKey: 'status.PENDING' },
  { value: 'CONFIRMED,CHECKED_IN', labelKey: 'appointments.statusConfirmedArrived' },
  { value: 'COMPLETED', labelKey: 'status.COMPLETED' },
  { value: 'CANCELLED', labelKey: 'status.CANCELLED' },
  { value: 'EXPIRED', labelKey: 'status.EXPIRED' },
]

const STATUS_BADGE: Record<AppointmentStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200/60',
  CONFIRMED: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  CHECKED_IN: 'bg-teal-50 text-teal-700 border-teal-200/60',
  IN_PROGRESS: 'bg-sky-50 text-sky-700 border-sky-200/60',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  CANCELLED: 'bg-slate-50 text-slate-500 border-slate-200/60',
  NO_SHOW: 'bg-slate-50 text-slate-500 border-slate-200/60',
  EXPIRED: 'bg-slate-50 text-slate-500 border-slate-200/60',
}

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all disabled:opacity-60'
const BTN_DANGER = 'inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-medium text-rose-600 transition-all hover:bg-rose-100 disabled:opacity-60'
const BTN_SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-60 sm:text-sm'

export function AppointmentDeskPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { showToast } = useToast()
  const qc = useQueryClient()
  const [status, setStatus] = useState<string>('PENDING')
  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null)
  const [cancelReason, setCancelReason] = useState('')

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
    mutationFn: ({ id, reason }: { id: number; reason: string }) => appointmentsApi.cancel(id, reason),
    onSuccess: () => {
      showToast(t('appointments.cancelled'), 'success')
      qc.invalidateQueries({ queryKey: ['appointments'] })
      setCancelTarget(null)
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const onCancel = (a: Appointment) => {
    setCancelReason('')
    setCancelTarget(a)
  }

  const confirmCancel = () => {
    if (!cancelTarget) return
    cancelAppt.mutate({ id: cancelTarget.id, reason: cancelReason.trim() })
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
                ...STATUS_FILTERS.map((s) => ({ value: s.value, label: t(s.labelKey) })),
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

      {cancelTarget && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="desk-cancel-title"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setCancelTarget(null) }}
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="patient-text-card-title mb-3" id="desk-cancel-title" style={{ color: 'var(--text-primary)' }}>
              {t('appointments.cancel')}
            </h2>
            <p className="patient-text-body mb-4" style={{ color: 'var(--text-secondary)' }}>
              {t('appointments.cancelConfirm', {
                name: cancelTarget.patient_name,
                when: formatDateTime(cancelTarget.scheduled_start, language),
              })}
            </p>
            <FormField label={t('appointments.cancelReasonLabel')}>
              {(p) => (
                <textarea
                  {...p}
                  className="patient-field"
                  rows={2}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder={t('appointments.cancelReasonPlaceholder')}
                />
              )}
            </FormField>
            <div className="mt-2 flex flex-wrap justify-end gap-3">
              <button type="button" onClick={() => setCancelTarget(null)} className={BTN_SECONDARY}>
                {t('common.keep')}
              </button>
              <button type="button" disabled={cancelAppt.isPending} onClick={confirmCancel} className={BTN_DANGER}>
                {cancelAppt.isPending && <Spinner size={14} />}{t('appointments.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
