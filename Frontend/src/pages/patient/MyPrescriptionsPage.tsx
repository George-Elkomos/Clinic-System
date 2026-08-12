import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Calendar, Info, Pill, Printer } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { useLanguage } from '../../hooks/useLanguage'
import { openBlob } from '../../lib/download'
import { formatDate } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { medicalApi } from '../../services/medical.api'
import type { Prescription } from '../../services/types'

// Strips a leading "Dr." so e.g. "Dr. Sarah Johnson" reads as "SJ", not "DS" —
// same convention as MyAppointmentsPage's doctorInitials.
function doctorInitials(name: string) {
  const parts = name.replace(/^Dr\.?\s+/i, '').trim().split(/\s+/).filter(Boolean)
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('')
}

function EmptyState() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-100 bg-white px-6 py-16 text-center shadow-sm">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0D9488]/10 text-[#0D9488]">
        <Pill className="h-7 w-7" aria-hidden="true" />
      </div>
      <div className="text-base font-bold text-slate-800">{t('medical.noPrescriptionsTitle')}</div>
      <p className="mt-1.5 max-w-sm text-sm text-slate-500">{t('medical.noPrescriptionsSub')}</p>
    </div>
  )
}

function PrescriptionCard({
  p,
  onOpenPdf,
  pdfLoading,
}: {
  p: Prescription
  onOpenPdf: (id: number) => void
  pdfLoading: boolean
}) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const isVoided = p.status === 'CANCELLED'

  return (
    <div className="mb-5 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition-all hover:shadow-md sm:p-6">
      {isVoided && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-rose-200/80 bg-rose-50/80 p-3.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" aria-hidden="true" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <span className="inline-block rounded-md bg-rose-100 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-rose-700">
              {t('medical.voidedBadge')}
            </span>
            <div className="text-xs font-medium text-rose-700">
              {p.cancelled_at && t('medical.voidedOn', { date: formatDate(p.cancelled_at.slice(0, 10), language) })}
              {p.cancelled_by_name && ` ${t('medical.voidedBy', { name: p.cancelled_by_name })}`}
              {p.cancellation_reason && ` — ${t('medical.voidReason', { reason: p.cancellation_reason })}`}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#0D9488]/10 text-sm font-bold text-[#0D9488]">
            {doctorInitials(p.doctor_name)}
          </span>
          <div className="min-w-0 truncate text-base font-bold text-slate-800">{p.doctor_name}</div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-slate-500 sm:text-sm">
            <Calendar size={14} className="shrink-0 text-slate-400" aria-hidden="true" />
            {formatDate(p.issued_date, language)}
          </div>
          {!isVoided && (
            <button
              type="button"
              onClick={() => onOpenPdf(p.id)}
              disabled={pdfLoading}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-[#0D9488] border border-[#0B7A70] px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-[#0B7A70] disabled:opacity-60 sm:text-sm"
            >
              <Printer size={14} aria-hidden="true" />
              {t('medical.openPdf')}
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-col">
        {p.items.map((it, i) => (
          <div key={i} className="mb-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3.5 last:mb-0 sm:p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`text-sm font-bold sm:text-base ${isVoided ? 'text-slate-400 line-through' : 'text-slate-800'}`}
              >
                {it.drug_name}
              </span>
              {it.dosage && (
                <span className="rounded-md bg-[#0D9488]/10 px-2.5 py-1 text-xs font-semibold text-[#0D9488]">
                  {it.dosage}
                </span>
              )}
            </div>
            {(it.frequency || it.duration) && (
              <div className="mt-1.5 text-xs font-medium text-slate-600 sm:text-sm">
                {[it.frequency, it.duration].filter(Boolean).join(' — ')}
              </div>
            )}
            {it.instructions && (
              <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-100/60 bg-amber-50/50 p-2.5">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />
                <span className="text-xs italic text-slate-500">{it.instructions}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {p.notes && <div className="mt-3 text-xs text-slate-500 sm:text-sm">{p.notes}</div>}
    </div>
  )
}

export function MyPrescriptionsPage() {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const [openingId, setOpeningId] = useState<number | null>(null)

  const { data: prescriptions = [], isLoading } = useQuery({
    queryKey: ['prescriptions', 'mine'],
    queryFn: () => medicalApi.prescriptions(),
  })

  const openPdf = async (id: number) => {
    setOpeningId(id)
    try {
      openBlob(await medicalApi.prescriptionPdf(id))
    } catch (err) {
      showToast(errorMessage(err), 'error')
    } finally {
      setOpeningId(null)
    }
  }

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('nav.prescriptions') }]} />
      {/* PatientShell already renders this same title (hidden lg:block) in its
          own sticky header — shown only below lg so the two never duplicate. */}
      <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>
        {t('nav.prescriptions')}
      </h1>
      <div className="mt-1 mb-6">
        <p className="text-sm text-slate-500">{t('medical.prescriptionsSubtitle')}</p>
      </div>

      {isLoading ? (
        <CenteredSpinner />
      ) : prescriptions.length === 0 ? (
        <EmptyState />
      ) : (
        prescriptions.map((p) => (
          <PrescriptionCard key={p.id} p={p} onOpenPdf={openPdf} pdfLoading={openingId === p.id} />
        ))
      )}
    </div>
  )
}
