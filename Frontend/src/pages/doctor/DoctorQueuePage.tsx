import { useQuery } from '@tanstack/react-query'
import { CalendarCheck, Phone, UserRound, Users } from 'lucide-react'
import { useState, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { InvoiceViewModal } from '../../components/billing/InvoiceViewModal'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { useDoctorQueueSocket } from '../../hooks/useDoctorQueueSocket'
import { useLanguage } from '../../hooks/useLanguage'
import { formatTime } from '../../lib/format'
import { appointmentsApi } from '../../services/appointments.api'
import type { QueueAppointment } from '../../services/types'

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all disabled:opacity-60 sm:text-sm'
const BTN_SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-60 sm:text-sm'

function ageFromDob(dob: string | null): string {
  if (!dob) return ''
  const years = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000))
  return `${years}y`
}

function PanelShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={`${CARD} flex h-full flex-col`}>
      <h2 className="patient-text-card-title mb-3" style={{ color: 'var(--text-primary)' }}>{title}</h2>
      {children}
    </div>
  )
}

// Consistent icon + message placeholder for the three queue panels' empty states.
function QueuePanelEmptyState({ icon: Icon, text }: { icon: ComponentType<{ className?: string }>; text: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-slate-400">
      <Icon className="h-8 w-8" />
      <p className="text-sm font-medium">{text}</p>
    </div>
  )
}

function HistoryBadge() {
  const { t } = useTranslation()
  return (
    <span
      title={t('queue.hasHistory')}
      className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700"
    >
      ★ {t('queue.hasHistory')}
    </span>
  )
}

// Follow-ups get their own color so the doctor spots them at a glance —
// they're the ones that carry a previous-visit summary into the encounter.
const TYPE_BADGE: Record<string, string> = {
  FOLLOW_UP: 'bg-indigo-50 text-indigo-700 border-indigo-200/60',
  EMERGENCY: 'bg-rose-50 text-rose-700 border-rose-200/60',
  WALK_IN: 'bg-amber-50 text-amber-700 border-amber-200/60',
  SCHEDULED: 'bg-slate-50 text-slate-600 border-slate-200/60',
}

function TypeBadge({ type }: { type: string }) {
  const { t } = useTranslation()
  return (
    <span className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TYPE_BADGE[type] ?? TYPE_BADGE.SCHEDULED}`}>
      {t(`appointments.type.${type}`)}
    </span>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div className="mb-2">
      <span className="patient-text-overline" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <div className="patient-text-body" style={{ color: 'var(--text-primary)' }}>{value}</div>
    </div>
  )
}

function AllergyBanner({ allergies }: { allergies: string }) {
  if (!allergies) return null
  return (
    <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
      <strong>⚠ {allergies}</strong>
    </div>
  )
}

function CurrentPanel({ appt }: { appt: QueueAppointment | null }) {
  const { t } = useTranslation()
  const { language } = useLanguage()

  if (!appt) {
    return (
      <PanelShell title={t('queue.current')}>
        <QueuePanelEmptyState icon={UserRound} text={t('queue.noCurrent')} />
      </PanelShell>
    )
  }

  const chips: string[] = [
    appt.patient_gender && appt.patient_gender !== '' ? appt.patient_gender : '',
    ageFromDob(appt.patient_dob),
    appt.patient_blood_type || '',
  ].filter(Boolean)

  return (
    <div className="flex h-full flex-col rounded-2xl border-2 border-[#A4DDD1] bg-white p-5 shadow-md sm:p-6">
      <h2 className="patient-text-card-title mb-3" style={{ color: 'var(--text-primary)' }}>{t('queue.current')}</h2>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="patient-text-h2" style={{ color: 'var(--text-primary)' }}>{appt.patient_name}</h3>
        {chips.map((c) => (
          <span key={c} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">{c}</span>
        ))}
        {appt.has_history && <HistoryBadge />}
        <TypeBadge type={appt.appointment_type} />
      </div>

      {appt.patient_phone && (
        <div className="mb-2 flex items-center gap-1.5 patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>
          <Phone size={13} />{appt.patient_phone}
        </div>
      )}

      {appt.started_at && (
        <div className="mb-2 patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>
          {t('queue.startedAt', { time: formatTime(appt.started_at, language) })}
        </div>
      )}

      {appt.reason && <InfoRow label={t('appointments.reason')} value={appt.reason} />}

      <AllergyBanner allergies={appt.patient_allergies} />

      {appt.patient_chronic_conditions && (
        <InfoRow label={t('queue.chronicConditions')} value={appt.patient_chronic_conditions} />
      )}
      {appt.patient_current_medications && (
        <InfoRow label={t('queue.currentMedications')} value={appt.patient_current_medications} />
      )}

      {/* The only action left here — check-in/no-show are front-desk's job, and
          completion happens inside the encounter via "Submit & Close Encounter". */}
      <Link to={`/doctor/encounters/${appt.id}`} className="mt-auto block pt-3">
        <button type="button" className={`${BTN_PRIMARY} w-full`}>🩻 {t('encounters.open')}</button>
      </Link>
    </div>
  )
}

function NextPanel({ appt }: { appt: QueueAppointment | null }) {
  const { t } = useTranslation()
  const { language } = useLanguage()

  if (!appt) {
    return (
      <PanelShell title={t('queue.next')}>
        <QueuePanelEmptyState icon={Users} text={t('queue.noNext')} />
      </PanelShell>
    )
  }

  return (
    <PanelShell title={t('queue.next')}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h3 className="patient-text-card-title" style={{ color: 'var(--text-primary)' }}>{appt.patient_name}</h3>
        {appt.has_history && <HistoryBadge />}
        <TypeBadge type={appt.appointment_type} />
      </div>
      <div className="patient-text-body-secondary mt-1" style={{ color: 'var(--text-secondary)' }}>{formatTime(appt.scheduled_start, language)}</div>
      {appt.reason && (
        <div className="patient-text-body-secondary mt-1" style={{ color: 'var(--text-secondary)' }}>{appt.reason}</div>
      )}
      {/* Opening the chart is what starts the visit now — no separate "Call Next" click. */}
      <Link to={`/doctor/encounters/${appt.id}`} className="mt-4 block">
        <button type="button" className={`${BTN_PRIMARY} w-full`}>🩻 {t('queue.openNext')}</button>
      </Link>
    </PanelShell>
  )
}

function PreviousPanel({
  appt,
  onViewInvoice,
}: {
  appt: QueueAppointment | null
  onViewInvoice: (invoiceId: number) => void
}) {
  const { t } = useTranslation()
  const { language } = useLanguage()

  if (!appt) {
    return (
      <PanelShell title={t('queue.previous')}>
        <QueuePanelEmptyState icon={CalendarCheck} text={t('queue.noPrevious')} />
      </PanelShell>
    )
  }

  return (
    <PanelShell title={t('queue.previous')}>
      <h3 className="patient-text-card-title" style={{ color: 'var(--text-secondary)' }}>{appt.patient_name}</h3>
      {appt.completed_at && (
        <div className="patient-text-body-secondary mt-1" style={{ color: 'var(--text-secondary)' }}>
          {t('queue.completedAt', { time: formatTime(appt.completed_at, language) })}
        </div>
      )}
      {appt.reason && (
        <div className="patient-text-body-secondary mt-1" style={{ color: 'var(--text-secondary)' }}>{appt.reason}</div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {/* Keeps the invoice reachable even after the post-completion pop-up is dismissed. */}
        {appt.invoice_id != null && (
          <button type="button" onClick={() => onViewInvoice(appt.invoice_id!)} className={BTN_SECONDARY}>
            {t('billing.viewInvoice')}
          </button>
        )}
        {appt.encounter_id != null && (
          <Link to={`/doctor/encounters/${appt.id}`}>
            <button type="button" className={BTN_SECONDARY}>🩻 {t('encounters.view')}</button>
          </Link>
        )}
      </div>
    </PanelShell>
  )
}

export function DoctorQueuePage() {
  const { t } = useTranslation()
  const { language } = useLanguage()

  // Real-time: a WebSocket push (see apps/appointments/consumers.py) invalidates
  // ['doctor-queue'] / ['doctor-queue-in-progress'] whenever this doctor's queue
  // changes, so no polling interval is needed here.
  useDoctorQueueSocket()

  const { data, isLoading } = useQuery({
    queryKey: ['doctor-queue'],
    queryFn: () => appointmentsApi.myQueue(),
  })

  // Safety-net: if the queue endpoint returns no current patient, check directly for any
  // IN_PROGRESS appointment assigned to this doctor (e.g. appointment created outside today).
  const { data: inProgressFallbackData } = useQuery({
    queryKey: ['doctor-queue-in-progress'],
    queryFn: () => appointmentsApi.list({ status: 'IN_PROGRESS' }),
    enabled: data !== undefined && data.current === null,
  })

  const [viewInvoiceId, setViewInvoiceId] = useState<number | null>(null)

  if (isLoading) return <CenteredSpinner />

  const { previous = null, current = null, next = null, waiting_count = 0 } = data ?? {}
  const fallbackRows = (!current ? inProgressFallbackData?.results : null) ?? []

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>{t('queue.liveTitle')}</h1>
        <span
          className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold sm:text-sm ${
            waiting_count > 0 ? 'border-amber-200/60 bg-amber-50 text-amber-700' : 'border-slate-200/60 bg-slate-50 text-slate-500'
          }`}
        >
          {t('queue.waiting', { count: waiting_count })}
        </span>
      </div>

      {fallbackRows.map((a) => (
        <div key={a.id} className="overflow-hidden rounded-2xl border-l-4 border-[#1AB5B3]">
          <div className={CARD}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="patient-text-card-title" style={{ color: 'var(--text-primary)' }}>{a.patient_name}</h2>
                <div className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{formatTime(a.scheduled_start, language)}</div>
              </div>
              <Link to={`/doctor/encounters/${a.id}`}>
                <button type="button" className={BTN_PRIMARY}>🩻 {t('encounters.open')}</button>
              </Link>
            </div>
          </div>
        </div>
      ))}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="order-2 md:order-1"><PreviousPanel appt={previous ?? null} onViewInvoice={setViewInvoiceId} /></div>
        <div className="order-1 md:order-2">
          <CurrentPanel appt={current ?? null} />
        </div>
        <div className="order-3 md:order-3">
          <NextPanel appt={next ?? null} />
        </div>
      </div>

      <p className="patient-text-body-secondary text-center" style={{ color: 'var(--text-muted)' }}>
        {t('queue.autoRefresh')}
      </p>

      {viewInvoiceId != null && (
        <InvoiceViewModal invoiceId={viewInvoiceId} onClose={() => setViewInvoiceId(null)} />
      )}
    </div>
  )
}
