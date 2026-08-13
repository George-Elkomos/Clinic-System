import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FormField } from './primitives/FormField'
import { Select } from './primitives/Select'
import { Spinner } from './primitives/Spinner'

const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 border border-amber-700 px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-amber-700 transition-all disabled:opacity-60 sm:text-sm'
const BTN_SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-60 sm:text-sm'

const REASON_PRESETS = ['EMERGENCY', 'EXISTING_PATIENT', 'DOCTOR_APPROVED', 'OTHER'] as const
type ReasonPreset = (typeof REASON_PRESETS)[number]

// Stable English tags for the audit trail, independent of the UI language
// the secretary happens to be using — only the dropdown's display label
// (via t()) is translated.
const REASON_CANONICAL: Record<ReasonPreset, string> = {
  EMERGENCY: 'Emergency',
  EXISTING_PATIENT: 'Existing Patient',
  DOCTOR_APPROVED: 'Doctor Approved',
  OTHER: '',
}

const REASON_LABEL_KEY: Record<ReasonPreset, string> = {
  EMERGENCY: 'overrideModal.reasonEmergency',
  EXISTING_PATIENT: 'overrideModal.reasonExistingPatient',
  DOCTOR_APPROVED: 'overrideModal.reasonDoctorApproved',
  OTHER: 'overrideModal.reasonOther',
}

interface OverrideWarningModalProps {
  title: string
  message: string
  onCancel: () => void
  onConfirm: (reason: string) => void
  loading?: boolean
}

export function OverrideWarningModal({ title, message, onCancel, onConfirm, loading = false }: OverrideWarningModalProps) {
  const { t } = useTranslation()
  const [preset, setPreset] = useState<ReasonPreset>('EMERGENCY')
  const [customReason, setCustomReason] = useState('')

  const presetOptions = REASON_PRESETS.map((value) => ({
    value,
    label: t(REASON_LABEL_KEY[value]),
  }))

  const confirm = () => {
    const reason = preset === 'OTHER' ? customReason.trim() : REASON_CANONICAL[preset]
    onConfirm(reason)
  }

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="override-warning-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="patient-text-card-title mb-4" id="override-warning-title" style={{ color: 'var(--text-primary)' }}>
          {title}
        </h2>

        <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
          <p className="text-sm font-medium text-amber-800">{message}</p>
        </div>

        <FormField label={t('overrideModal.reasonLabel')}>
          {(p) => (
            <Select
              id={p.id}
              options={presetOptions}
              value={preset}
              onChange={(v) => setPreset((Array.isArray(v) ? v[0] : v) as ReasonPreset)}
            />
          )}
        </FormField>

        {preset === 'OTHER' && (
          <FormField label={t('overrideModal.reasonCustomLabel')}>
            {(p) => (
              <input
                {...p}
                className="patient-field"
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
              />
            )}
          </FormField>
        )}

        <div className="mt-2 flex flex-wrap justify-end gap-3">
          <button type="button" onClick={onCancel} className={BTN_SECONDARY}>
            {t('common.cancel')}
          </button>
          <button type="button" disabled={loading} onClick={confirm} className={BTN_PRIMARY}>
            {loading && <Spinner size={14} />}
            {t('overrideModal.confirmOverride')}
          </button>
        </div>
      </div>
    </div>
  )
}
