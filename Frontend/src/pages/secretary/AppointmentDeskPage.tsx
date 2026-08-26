import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { FormField } from '../../components/primitives/FormField'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner, Spinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { useAuth } from '../../hooks/useAuth'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDateTime } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { appointmentsApi } from '../../services/appointments.api'
import type { Appointment, AppointmentStatus, Paginated } from '../../services/types'

// CONFIRMED and CHECKED_IN get their own tabs (not merged) so a secretary can
// isolate "still waiting to arrive" (needs Check-In) from "already arrived"
// -- now that Check-In lives on this page, that distinction is exactly what
// staff need to act on. IN_PROGRESS is the doctor's live-queue concern, not
// the desk's, so it's deliberately not offered.
const STATUS_FILTERS: { value: string; labelKey: string }[] = [
  { value: 'PENDING', labelKey: 'status.PENDING' },
  { value: 'CONFIRMED', labelKey: 'status.CONFIRMED' },
  { value: 'CHECKED_IN', labelKey: 'status.CHECKED_IN' },
  { value: 'COMPLETED', labelKey: 'status.COMPLETED' },
  { value: 'CANCELLED', labelKey: 'status.CANCELLED' },
  { value: 'NO_SHOW', labelKey: 'status.NO_SHOW' },
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
  const { user } = useAuth()
  const isManager = user?.role === 'MANAGER'
  const qc = useQueryClient()
  const [status, setStatus] = useState<string>('PENDING')
  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null)
  const [cancelReason, setCancelReason] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['appointments', 'desk', status],
    queryFn: () => appointmentsApi.list(status ? { status } : undefined),
  })

  // Patches the row in place with the server's fresh copy so the status
  // badge and action button swap instantly -- the row stays visible even
  // after it stops matching the active status filter (e.g. a row confirmed
  // while viewing the PENDING tab keeps showing "Confirmed" + Check-In
  // right there) rather than disappearing the moment a refetch happens.
  // refetchType: 'none' marks every cached filter tab (including this one)
  // stale for the *next* time it's mounted/refetched, without triggering an
  // immediate refetch of the tab currently on screen -- an immediate
  // 'active' refetch would race this same patch and win (queries default to
  // staleTime: 30_000 here, so nothing else would refresh it in time),
  // wiping the instant update right back out.
  const patchAppointment = (updated: Appointment) => {
    qc.setQueryData<Paginated<Appointment>>(['appointments', 'desk', status], (old) =>
      old
        ? { ...old, results: old.results.map((a) => (a.id === updated.id ? updated : a)) }
        : old,
    )
    qc.invalidateQueries({ queryKey: ['appointments'], refetchType: 'none' })
  }

  const confirmAppt = useMutation({
    mutationFn: (id: number) => appointmentsApi.confirm(id),
    onSuccess: (updated) => {
      showToast(t('appointments.confirmed'), 'success')
      patchAppointment(updated)
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const checkInAppt = useMutation({
    mutationFn: (id: number) => appointmentsApi.checkIn(id),
    onSuccess: (updated) => {
      showToast(t('appointments.checkedIn'), 'success')
      patchAppointment(updated)
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
                  {a.status === 'CONFIRMED' && (
                    <button
                      type="button"
                      disabled={checkInAppt.isPending && checkInAppt.variables === a.id}
                      onClick={() => checkInAppt.mutate(a.id)}
                      className={BTN_PRIMARY}
                    >
                      {checkInAppt.isPending && checkInAppt.variables === a.id && <Spinner size={14} />}{t('appointments.checkIn')}
                    </button>
                  )}
                  {(['PENDING', 'CONFIRMED'].includes(a.status) || (a.status === 'NO_SHOW' && isManager)) && (
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
