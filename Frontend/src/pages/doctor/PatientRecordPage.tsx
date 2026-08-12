import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, ClipboardList, FileText } from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { MedicationItemRow } from '../../components/medical/MedicationItemRow'
import { ProcedureDetailModal } from '../../components/medical/ProcedureDetailModal'
import { RadiologyOrderDetailModal } from '../../components/medical/RadiologyOrderDetailModal'
import { useAuth } from '../../hooks/useAuth'
import { useInteractionCheck } from '../../hooks/useInteractionCheck'

import { AIScribePanel } from '../../components/ai/AIScribePanel'
import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { useConfirm } from '../../components/primitives/ConfirmDialog'
import { FormField } from '../../components/primitives/FormField'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner, Spinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { VitalSignsForm } from '../../components/vitals/VitalSignsForm'
import { VitalSignsHistory } from '../../components/vitals/VitalSignsHistory'
import { VitalSignsTrendChart } from '../../components/vitals/VitalSignsTrendChart'
import { PatientTimeline } from '../../components/timeline/PatientTimeline'
import { useLanguage } from '../../hooks/useLanguage'
import { openBlob, saveBlob } from '../../lib/download'
import { formatDate } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { authApi } from '../../services/auth.api'
import { medicalApi } from '../../services/medical.api'
import { vitalsApi } from '../../services/vitals.api'
import { encountersApi } from '../../services/encounters.api'
import { proceduresApi } from '../../services/procedures.api'
import { radiologyApi } from '../../services/radiology.api'
import type { Diagnosis, Prescription, PrescriptionItem, ProcedureStatus, RadiologyOrderStatus } from '../../services/types'

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#1AB5B3] to-[#38E4DD] px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-95 disabled:opacity-60 sm:text-sm'
const BTN_SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-medium text-slate-700 transition-all hover:border-[#0D9488] hover:text-[#0D9488] disabled:opacity-60 sm:text-sm'
const BTN_DANGER = 'inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-5 py-2.5 text-xs font-medium text-rose-600 transition-all hover:bg-rose-100 disabled:opacity-60 sm:text-sm'
const BTN_SECONDARY_SM = 'inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-all hover:border-[#0D9488] hover:text-[#0D9488] disabled:opacity-60'
const SECTION_DIVIDER = 'patient-text-card-title mb-3 mt-5 border-t border-slate-100 pt-4 first:mt-0 first:border-t-0 first:pt-0'

const PROCEDURE_STATUS_BADGE: Record<ProcedureStatus, string> = {
  SCHEDULED: 'bg-amber-50 text-amber-700 border-amber-200/60',
  IN_PROGRESS: 'bg-sky-50 text-sky-700 border-sky-200/60',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  CANCELLED: 'bg-slate-50 text-slate-500 border-slate-200/60',
}
const RADIOLOGY_STATUS_BADGE: Record<RadiologyOrderStatus, string> = {
  ORDERED: 'bg-amber-50 text-amber-700 border-amber-200/60',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  REPORTED: 'bg-sky-50 text-sky-700 border-sky-200/60',
  CANCELLED: 'bg-slate-50 text-slate-500 border-slate-200/60',
}

function StatusPill({ text, className }: { text: string; className: string }) {
  return <span className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>{text}</span>
}

// ---- Vital Signs -----------------------------------------------------------
function VitalsSection({ patientId }: { patientId: number }) {
  const { t } = useTranslation()
  const [showForm, setShowForm] = useState(true)

  const { data: trend = [] } = useQuery({
    queryKey: ['vitals', patientId, 'trend'],
    queryFn: () => vitalsApi.trend(patientId),
    staleTime: 30_000,
    retry: 1,
  })

  return (
    <div>
      <h2 className="patient-text-h2 mb-4" style={{ color: 'var(--text-primary)' }}>{t('vitals.title')}</h2>
      {trend.length >= 2 && <VitalSignsTrendChart data={trend} />}

      <div className="mb-5 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
        {showForm ? (
          <>
            <h3 className="patient-text-card-title mb-3" style={{ color: 'var(--text-primary)' }}>{t('vitals.record')}</h3>
            <VitalSignsForm patientId={patientId} onSuccess={() => setShowForm(false)} />
          </>
        ) : (
          <div className="text-right">
            <button type="button" onClick={() => setShowForm(true)} className={BTN_SECONDARY}>{t('vitals.record')}</button>
          </div>
        )}
      </div>

      <h3 className="patient-text-card-title mb-3" style={{ color: 'var(--text-primary)' }}>{t('vitals.history')}</h3>
      <VitalSignsHistory patientId={patientId} />
    </div>
  )
}

// ---- Records ---------------------------------------------------------------
function RecordsSection({ patientId }: { patientId: number }) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { showToast } = useToast()
  const qc = useQueryClient()
  const [form, setForm] = useState({ chief_complaint: '', diagnosis: '', treatment_plan: '' })

  const { data: records = [] } = useQuery({
    queryKey: ['records', patientId],
    queryFn: () => medicalApi.records(patientId),
  })

  const add = useMutation({
    mutationFn: () => medicalApi.createRecord({ patient: patientId, ...form }),
    onSuccess: () => {
      showToast(t('medical.recordSaved'), 'success')
      setForm({ chief_complaint: '', diagnosis: '', treatment_plan: '' })
      qc.invalidateQueries({ queryKey: ['records', patientId] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  return (
    <div className={CARD}>
      <h2 className="patient-text-card-title" style={{ color: 'var(--text-primary)' }}>{t('medical.records')}</h2>
      {records.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <FileText className="mb-2 h-10 w-10 text-slate-300" />
          <p className="text-xs font-medium text-slate-400">{t('medical.noRecords')}</p>
        </div>
      ) : (
        <div className="relative mt-4">
          {/* Continuous rail behind the version dots — a single absolutely
              positioned line, not per-row flex-stretch, so it stays
              unbroken across the gaps between cards. */}
          <div className="absolute bottom-5 left-[5px] top-5 w-px bg-slate-200" aria-hidden="true" />
          <div className="flex flex-col gap-3">
            {records.map((r) => (
              <div key={r.id} className="relative flex gap-4">
                <span
                  className={`relative z-10 mt-4 h-2.5 w-2.5 shrink-0 rounded-full ${r.is_current ? 'bg-[#3BC9CB]' : 'bg-slate-300'}`}
                  aria-hidden="true"
                />
                <div
                  className={`flex-1 space-y-2 rounded-xl border p-4 shadow-sm ${
                    r.is_current
                      ? 'border-slate-100 border-l-4 border-l-[#3BC9CB] bg-sky-50/30'
                      : 'border-slate-100 bg-white'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-700">
                        {t('medical.version', { n: r.version })}
                      </span>
                      {r.is_current && (
                        <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                          {t('medical.current')}
                        </span>
                      )}
                    </div>
                    <span className="text-xs font-medium text-slate-400">{formatDate(r.created_at, language)}</span>
                  </div>
                  {r.diagnosis && (
                    <div className="flex items-start gap-1.5">
                      <Activity size={13} className="mt-0.5 shrink-0 text-slate-400" />
                      <div>
                        <div className="text-xs font-semibold text-slate-700">{t('medical.diagnosis')}</div>
                        <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{r.diagnosis}</p>
                      </div>
                    </div>
                  )}
                  {r.treatment_plan && (
                    <div className="flex items-start gap-1.5">
                      <ClipboardList size={13} className="mt-0.5 shrink-0 text-slate-400" />
                      <div>
                        <div className="text-xs font-semibold text-slate-700">{t('medical.treatmentPlan')}</div>
                        <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{r.treatment_plan}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <h3 className={SECTION_DIVIDER}>{t('medical.addRecord')}</h3>
      <FormField label={t('medical.chiefComplaint')}>
        {(p) => <input {...p} className="patient-field" value={form.chief_complaint} onChange={(e) => setForm((f) => ({ ...f, chief_complaint: e.target.value }))} />}
      </FormField>
      <FormField label={t('medical.diagnosis')}>
        {(p) => <textarea {...p} className="patient-field" rows={2} value={form.diagnosis} onChange={(e) => setForm((f) => ({ ...f, diagnosis: e.target.value }))} />}
      </FormField>
      <FormField label={t('medical.treatmentPlan')}>
        {(p) => <textarea {...p} className="patient-field" rows={2} value={form.treatment_plan} onChange={(e) => setForm((f) => ({ ...f, treatment_plan: e.target.value }))} />}
      </FormField>
      <button type="button" disabled={add.isPending} onClick={() => add.mutate()} className={`${BTN_PRIMARY} mt-2`}>
        {add.isPending && <Spinner size={14} />}{t('medical.addRecord')}
      </button>
    </div>
  )
}

// ---- Clinical notes --------------------------------------------------------
function NotesSection({ patientId, categories }: { patientId: number; categories: { id: number; name: string }[] }) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { showToast } = useToast()
  const qc = useQueryClient()
  const [category, setCategory] = useState<number | ''>(categories[0]?.id ?? '')
  const [body, setBody] = useState('')

  const { data: notes = [] } = useQuery({
    queryKey: ['notes', patientId],
    queryFn: () => medicalApi.notes(patientId),
  })

  const add = useMutation({
    mutationFn: () => medicalApi.createNote({ patient: patientId, specialty_category: Number(category), body }),
    onSuccess: () => {
      showToast(t('medical.noteSaved'), 'success')
      setBody('')
      qc.invalidateQueries({ queryKey: ['notes', patientId] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  return (
    <div className={CARD}>
      <h2 className="patient-text-card-title" style={{ color: 'var(--text-primary)' }}>{t('medical.notes')}</h2>
      {notes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <FileText className="mb-2 h-10 w-10 text-slate-300" />
          <p className="text-xs font-medium text-slate-400">{t('medical.noNotes')}</p>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {notes.map((n) => (
            <div key={n.id} className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="text-xs font-medium text-slate-400">{n.specialty_category_name} · {n.doctor_name} · {formatDate(n.created_at, language)}</div>
              <div className="mt-1 text-xs leading-relaxed text-slate-600">{n.body}</div>
            </div>
          ))}
        </div>
      )}
      <h3 className={SECTION_DIVIDER}>{t('medical.addNote')}</h3>
      <FormField label={t('medical.specialtyCategory')} hint={t('medical.noteSpecialtyHint')}>
        {(p) => (
          <Select
            id={p.id}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
            value={category}
            onChange={(v) => setCategory(Array.isArray(v) || v === '' ? '' : Number(v))}
          />
        )}
      </FormField>
      <FormField label={t('medical.noteBody')}>
        {(p) => <textarea {...p} className="patient-field" rows={3} value={body} onChange={(e) => setBody(e.target.value)} />}
      </FormField>
      <button type="button" disabled={add.isPending || !category || !body} onClick={() => add.mutate()} className={`${BTN_PRIMARY} mt-2`}>
        {add.isPending && <Spinner size={14} />}{t('medical.addNote')}
      </button>
    </div>
  )
}

// ---- Prescriptions ---------------------------------------------------------
// ARCH-4: carry a stable client-only key so React correctly reconciles rows
// when items are added/removed from the middle of the list.
type RxItem = PrescriptionItem & { _key: string }
const newRxItem = (): RxItem => ({
  medication: null, drug_name: '', dosage_strength: '', dosage_form: null, dosage_pattern: null,
  dosage: '', frequency: '', duration: '', instructions: '',
  _key: crypto.randomUUID(),
})

function PrescriptionsSection({ patientId }: { patientId: number }) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { showToast } = useToast()
  const qc = useQueryClient()
  const { user } = useAuth()
  const confirm = useConfirm()
  const { checkBeforeSubmit, checking, modal } = useInteractionCheck()
  const newRxRef = useRef<HTMLHeadingElement>(null)
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<RxItem[]>([newRxItem()])
  const [voidingId, setVoidingId] = useState<number | null>(null)
  const [voidReason, setVoidReason] = useState('')

  const hasContent = (i: RxItem) => !!i.medication || !!i.drug_name.trim()

  const { data: prescriptions = [] } = useQuery({
    queryKey: ['prescriptions', patientId],
    queryFn: () => medicalApi.prescriptions(patientId),
  })

  const issue = useMutation({
    mutationFn: () => medicalApi.createPrescription({
      patient: patientId,
      notes,
      // Strip the client-only _key before sending to the API.
      items: items.filter(hasContent).map(({ _key: _, ...rest }) => rest),
    }),
    onSuccess: () => {
      showToast(t('medical.prescriptionIssued'), 'success')
      setNotes(''); setItems([newRxItem()])
      qc.invalidateQueries({ queryKey: ['prescriptions', patientId] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const cancelRx = useMutation({
    mutationFn: (id: number) => medicalApi.cancelPrescription(id, voidReason),
    onSuccess: () => {
      showToast(t('medical.voidedBadge'), 'success')
      setVoidingId(null)
      setVoidReason('')
      qc.invalidateQueries({ queryKey: ['prescriptions', patientId] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const reissueMut = useMutation({
    mutationFn: (id: number) => medicalApi.reissuePrescription(id),
    onSuccess: (old) => {
      setNotes(old.notes)
      setItems(old.items.map((item) => ({ ...item, _key: crypto.randomUUID() })))
      qc.invalidateQueries({ queryKey: ['prescriptions', patientId] })
      showToast(t('medical.reissued'), 'success')
      setTimeout(() => newRxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150)
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const handleReissue = async (p: Prescription) => {
    const ok = await confirm({
      title: t('medical.reissueConfirmTitle'),
      message: t('medical.reissueConfirmMessage'),
      confirmLabel: t('medical.reissueConfirmBtn'),
      danger: true,
    })
    if (!ok) return
    reissueMut.mutate(p.id)
  }

  const openPdf = async (id: number) => {
    try { openBlob(await medicalApi.prescriptionPdf(id)) } catch (err) { showToast(errorMessage(err), 'error') }
  }

  const patchItem = (idx: number, patch: Partial<PrescriptionItem>) =>
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)))

  const handleIssue = () =>
    checkBeforeSubmit(patientId, items.filter(hasContent), () => issue.mutate())

  return (
    <div className={CARD}>
      <h2 className="patient-text-card-title" style={{ color: 'var(--text-primary)' }}>{t('medical.prescriptions')}</h2>
      {prescriptions.length === 0 ? <p className="patient-text-body-secondary mt-2" style={{ color: 'var(--text-secondary)' }}>{t('medical.noPrescriptions')}</p> : (
        <div className="mt-4 flex flex-col gap-4">
          {prescriptions.map((p) => {
            const isCancelled = p.status === 'CANCELLED'
            const isVoiding = voidingId === p.id
            const canVoid = p.status === 'ACTIVE' && (
              user?.role === 'MANAGER' ||
              (user?.doctor_profile?.id != null && p.doctor === user.doctor_profile.id)
            )

            return (
              <div key={p.id} className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm sm:p-5">
                {isCancelled && (
                  <div className="mb-3 flex items-start gap-3 rounded-xl border border-rose-200/80 bg-rose-50/80 p-3.5">
                    <span aria-hidden="true" className="mt-0.5 shrink-0 text-rose-500">⚠</span>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <span className="inline-block rounded-md bg-rose-100 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-rose-700">
                        {t('medical.voidedBadge')}
                      </span>
                      <div className="text-xs font-medium text-rose-700">
                        {p.cancelled_at && t('medical.voidedOn', { date: formatDate(p.cancelled_at, language) })}
                        {p.cancelled_by_name && ` ${t('medical.voidedBy', { name: p.cancelled_by_name })}`}
                        {p.cancellation_reason && ` — ${t('medical.voidReason', { reason: p.cancellation_reason })}`}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <strong className="patient-text-body font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {t('medical.issuedOn', { date: formatDate(p.issued_date, language) })}
                  </strong>
                  <div className="flex shrink-0 items-center gap-2">
                    {!isCancelled && (
                      <button type="button" onClick={() => openPdf(p.id)} className={BTN_SECONDARY_SM}>{t('medical.openPdf')}</button>
                    )}
                    {canVoid && !isVoiding && (
                      <>
                        <button
                          type="button"
                          title={t('medical.reissuePrescription')}
                          onClick={() => handleReissue(p)}
                          disabled={reissueMut.isPending}
                          className="rounded-lg border border-slate-200 bg-white p-2 text-sm hover:border-[#0D9488]"
                        >✏️</button>
                        <button
                          type="button"
                          title={t('medical.voidPrescription')}
                          onClick={() => { setVoidingId(p.id); setVoidReason('') }}
                          className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-sm hover:bg-rose-100"
                        >🚫</button>
                      </>
                    )}
                    {isVoiding && (
                      <button
                        type="button"
                        title={t('common.cancel')}
                        onClick={() => { setVoidingId(null); setVoidReason('') }}
                        className="rounded-lg border border-slate-200 bg-white p-2 text-sm"
                      >✕</button>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-col">
                  {p.items.map((it, i) => (
                    <div key={i} className="mb-2 rounded-xl border border-slate-100 bg-slate-50/70 p-3.5 last:mb-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-sm font-bold ${isCancelled ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                          {it.drug_name}
                        </span>
                        {it.dosage && (
                          <span className="rounded-md bg-[#0D9488]/10 px-2.5 py-1 text-xs font-semibold text-[#0D9488]">{it.dosage}</span>
                        )}
                      </div>
                      {(it.frequency || it.duration) && (
                        <div className="mt-1.5 text-xs font-medium text-slate-600">
                          {[it.frequency, it.duration].filter(Boolean).join(' — ')}
                        </div>
                      )}
                      {it.instructions && (
                        <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-100/60 bg-amber-50/50 p-2.5">
                          <span aria-hidden="true" className="mt-0.5 shrink-0 text-amber-500 text-xs">ℹ</span>
                          <span className="text-xs italic text-slate-500">{it.instructions}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {isVoiding && (
                  <div className="mt-3 flex flex-col gap-2">
                    <textarea
                      className="patient-field"
                      rows={2}
                      placeholder={t('medical.voidReasonPlaceholder')}
                      value={voidReason}
                      onChange={(e) => setVoidReason(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={cancelRx.isPending || voidReason.trim().length < 5}
                        onClick={() => cancelRx.mutate(p.id)}
                        className={BTN_DANGER}
                      >
                        {cancelRx.isPending && <Spinner size={14} />}{t('medical.voidConfirmBtn')}
                      </button>
                      <button type="button" onClick={() => { setVoidingId(null); setVoidReason('') }} className={BTN_SECONDARY}>
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                )}

                {p.notes && <div className="mt-3 text-xs text-slate-500">{p.notes}</div>}
              </div>
            )
          })}
        </div>
      )}

      <h3 ref={newRxRef} className={SECTION_DIVIDER}>{t('medical.newPrescription')}</h3>
      {items.map((it, idx) => (
        <MedicationItemRow
          key={it._key}
          item={it}
          onChange={(patch) => patchItem(idx, patch)}
          onRemove={() => setItems((arr) => arr.filter((i) => i._key !== it._key))}
          canRemove={items.length > 1}
        />
      ))}
      <button type="button" onClick={() => setItems((arr) => [...arr, newRxItem()])} className={`${BTN_SECONDARY} mt-2`}>{t('medical.addItem')}</button>
      <FormField label={t('medical.instructions')}>
        {(p) => <textarea {...p} className="patient-field" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </FormField>
      <button type="button" disabled={issue.isPending || checking || !items.some(hasContent)} onClick={handleIssue} className={`${BTN_PRIMARY} mt-2`}>
        {(issue.isPending || checking) && <Spinner size={14} />}{t('medical.issuePrescription')}
      </button>
      {modal}
    </div>
  )
}

// ---- Clinical procedures ----------------------------------------------------
function ProceduresSection({ patientId }: { patientId: number }) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const qc = useQueryClient()
  const [openProcedureId, setOpenProcedureId] = useState<number | null>(null)

  const { data: procedures = [] } = useQuery({
    queryKey: ['procedures', patientId],
    queryFn: () => proceduresApi.list({ patient: patientId }).then((r) => r.results),
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['procedures', patientId] })

  return (
    <div className={CARD}>
      <h2 className="patient-text-card-title" style={{ color: 'var(--text-primary)' }}>{t('procedures.title')}</h2>
      {procedures.length === 0 ? (
        <p className="patient-text-body-secondary mt-2" style={{ color: 'var(--text-secondary)' }}>{t('procedures.none')}</p>
      ) : (
        <ul className="mt-2 flex flex-col divide-y divide-slate-100">
          {procedures.map((proc) => (
            <li key={proc.id}>
              <button
                type="button"
                onClick={() => setOpenProcedureId(proc.id)}
                className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-slate-50/60"
              >
                <div className="min-w-0">
                  <div className="patient-text-body truncate font-medium" style={{ color: 'var(--text-primary)' }}>
                    {language === 'ar' && proc.procedure_name_ar ? proc.procedure_name_ar : proc.procedure_name}
                  </div>
                  <div className="patient-text-body-secondary" style={{ color: 'var(--text-muted)' }}>
                    {proc.doctor_name} · {formatDate(proc.created_at, language)}
                  </div>
                </div>
                <StatusPill text={t(`procedures.status.${proc.status}`)} className={PROCEDURE_STATUS_BADGE[proc.status] ?? PROCEDURE_STATUS_BADGE.CANCELLED} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {openProcedureId != null && (
        <ProcedureDetailModal
          procedureId={openProcedureId}
          onClose={() => setOpenProcedureId(null)}
          onChanged={refresh}
        />
      )}
    </div>
  )
}

// ---- Radiology Orders -------------------------------------------------------
function RadiologySection({ patientId }: { patientId: number }) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const qc = useQueryClient()
  const [openOrderId, setOpenOrderId] = useState<number | null>(null)

  const { data: orders = [] } = useQuery({
    queryKey: ['radiology-orders', patientId],
    queryFn: () => radiologyApi.list({ patient: patientId }).then((r) => r.results),
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['radiology-orders', patientId] })

  return (
    <div className={CARD}>
      <h2 className="patient-text-card-title" style={{ color: 'var(--text-primary)' }}>{t('radiology.title')}</h2>
      {orders.length === 0 ? (
        <p className="patient-text-body-secondary mt-2" style={{ color: 'var(--text-secondary)' }}>{t('radiology.none')}</p>
      ) : (
        <ul className="mt-2 flex flex-col divide-y divide-slate-100">
          {orders.map((order) => (
            <li key={order.id}>
              <button
                type="button"
                onClick={() => setOpenOrderId(order.id)}
                className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-slate-50/60"
              >
                <div className="min-w-0">
                  <div className="patient-text-body truncate font-medium" style={{ color: 'var(--text-primary)' }}>
                    {language === 'ar' && order.study_name_ar ? order.study_name_ar : order.study_name}
                  </div>
                  <div className="patient-text-body-secondary" style={{ color: 'var(--text-muted)' }}>
                    {order.doctor_name} · {formatDate(order.created_at, language)}
                  </div>
                </div>
                <StatusPill text={t(`radiology.status.${order.status}`)} className={RADIOLOGY_STATUS_BADGE[order.status] ?? RADIOLOGY_STATUS_BADGE.CANCELLED} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {openOrderId != null && (
        <RadiologyOrderDetailModal
          orderId={openOrderId}
          onClose={() => setOpenOrderId(null)}
          onChanged={refresh}
        />
      )}
    </div>
  )
}

// ---- Scans / Labs ----------------------------------------------------------
function ScansLabsSection({ patientId }: { patientId: number }) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [category, setCategory] = useState('XRAY')

  const { data: scans = [] } = useQuery({ queryKey: ['scans', patientId], queryFn: () => medicalApi.scans(patientId) })
  const { data: labs = [] } = useQuery({ queryKey: ['labs', patientId], queryFn: () => medicalApi.labs(patientId) })

  const upload = useMutation({
    mutationFn: () => {
      const form = new FormData()
      form.append('patient', String(patientId))
      form.append('category', category)
      if (file) form.append('file', file)
      return medicalApi.uploadScan(form)
    },
    onSuccess: () => {
      showToast(t('medical.uploaded'), 'success'); setFile(null)
      qc.invalidateQueries({ queryKey: ['scans', patientId] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const deleteScan = useMutation({
    mutationFn: (id: number) => medicalApi.deleteScan(id),
    onSuccess: () => {
      showToast(t('medical.scanDeleted'), 'success')
      qc.invalidateQueries({ queryKey: ['scans', patientId] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const download = async (id: number, name: string) => {
    try { saveBlob(await medicalApi.downloadScan(id), name || `scan-${id}`) } catch (err) { showToast(errorMessage(err), 'error') }
  }

  const handleDelete = async (id: number, name: string) => {
    const ok = await confirm({
      title: t('medical.deleteScanTitle'),
      message: t('medical.deleteScanMessage', { name }),
      confirmLabel: t('medical.deleteScanConfirm'),
      danger: true,
    })
    if (ok) deleteScan.mutate(id)
  }

  return (
    <div className={CARD}>
      <h2 className="patient-text-card-title" style={{ color: 'var(--text-primary)' }}>{`${t('medical.scans')} / ${t('medical.labs')}`}</h2>

      <h3 className={SECTION_DIVIDER}>{t('medical.uploadedScans')}</h3>
      {scans.length === 0 ? (
        <p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{t('medical.noScans')}</p>
      ) : (
        <div>
          {scans.map((s) => (
            <div key={s.id} className="mb-3 flex flex-col gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3.5 last:mb-0 sm:flex-row sm:items-center sm:justify-between sm:p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-[#0D9488]/10 px-2.5 py-1 text-xs font-semibold text-[#0D9488]">{s.category}</span>
                  <span className="truncate text-sm font-bold text-slate-800">{s.original_filename}</span>
                </div>
                {s.description && <div className="mt-1.5 text-xs text-slate-500">{s.description}</div>}
                <div className="mt-1.5 text-xs text-slate-400">{formatDate(s.created_at, language)}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button type="button" onClick={() => download(s.id, s.original_filename)} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#0D9488]/30 bg-[#0D9488]/5 px-3.5 text-xs font-semibold text-[#0D9488] transition-colors hover:bg-[#0D9488]/10">
                  {t('medical.download')}
                </button>
                <button type="button" onClick={() => handleDelete(s.id, s.original_filename)} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50/50 px-3.5 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-100">
                  🗑 {t('medical.delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h3 className={SECTION_DIVIDER}>{t('medical.labDocuments')}</h3>
      {labs.length === 0 ? (
        <p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{t('medical.noLabs')}</p>
      ) : (
        <div>
          {labs.map((l) => (
            <div key={l.id} className="mb-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3.5 last:mb-0 sm:p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-slate-800">{l.test_name}</span>
                {l.is_abnormal && (
                  <span className="rounded-md bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">{t('lab.isAbnormal')}</span>
                )}
              </div>
              <div className="mt-1.5 text-xs font-medium text-slate-600">
                {[l.result_value, l.unit].filter(Boolean).join(' ')}
                {l.result_date ? ` · ${formatDate(l.result_date, language)}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      <h3 className={SECTION_DIVIDER}>{t('medical.uploadScan')}</h3>
      <FormField label={t('medical.category')}>
        {(p) => (
          <Select
            id={p.id}
            options={['XRAY', 'MRI', 'CT', 'ULTRASOUND', 'DICOM', 'OTHER'].map((c) => ({ value: c, label: c }))}
            value={category}
            onChange={(v) => setCategory(Array.isArray(v) ? 'XRAY' : String(v))}
          />
        )}
      </FormField>
      <FormField label={t('medical.file')} hint={t('medical.fileHint')}>
        {(p) => (
          <input {...p} type="file" accept=".jpg,.jpeg,.png,.pdf,.dcm,.dicom" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        )}
      </FormField>
      <button type="button" disabled={upload.isPending || !file} onClick={() => upload.mutate()} className={`${BTN_PRIMARY} mt-2`}>
        {upload.isPending && <Spinner size={14} />}{t('medical.uploadScan')}
      </button>
    </div>
  )
}

// ---- Chronic diagnoses -----------------------------------------------------
// Derived from submitted encounters whose coded diagnosis is flagged chronic.
function ChronicDiagnosesSection({ patientId }: { patientId: number }) {
  const { t } = useTranslation()
  const { language } = useLanguage()

  const { data: encountersPage } = useQuery({
    queryKey: ['encounters', patientId, 'chronic'],
    queryFn: () => encountersApi.list({ patient: patientId, status: 'SUBMITTED' }),
  })
  const encounters = encountersPage?.results ?? []

  const chronic = useMemo(() => {
    const map = new Map<number, { d: Diagnosis; count: number }>()
    for (const e of encounters) {
      const d = e.diagnosis_detail
      if (d?.is_chronic) map.set(d.id, { d, count: (map.get(d.id)?.count ?? 0) + 1 })
    }
    return Array.from(map.values())
  }, [encounters])

  return (
    <div className={CARD}>
      <h2 className="patient-text-card-title" style={{ color: 'var(--text-primary)' }}>{t('medical.chronicDiagnoses')}</h2>
      {chronic.length === 0 ? (
        <p className="patient-text-body-secondary mt-2" style={{ color: 'var(--text-secondary)' }}>{t('medical.noChronicDiagnoses')}</p>
      ) : (
        <ul className="mt-2 list-disc space-y-1.5 ps-5 patient-text-body" style={{ color: 'var(--text-primary)' }}>
          {chronic.map(({ d, count }) => (
            <li key={d.id} dir="auto">
              <strong>{language === 'ar' && d.name_ar ? d.name_ar : d.name}</strong>
              {d.icd10_code && <span className="patient-text-body-secondary" style={{ color: 'var(--text-muted)' }}> ({d.icd10_code})</span>}
              {' — '}
              {t('medical.encounterCount', { count })}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---- Record tabs ------------------------------------------------------------
// Each patient's record is split into tabs (instead of one long stacked
// column) so opening a patient doesn't dump 8+ full cards on the page at
// once. Sections stay mounted and are only hidden via CSS, so in-progress
// input (a draft note, an AI Scribe recording, unsaved rx items) survives
// switching tabs.
const RECORD_TABS = [
  { key: 'scribe', labelKey: 'ai.tab' },
  { key: 'vitals', labelKey: 'vitals.title' },
  { key: 'records', labelKey: 'medical.records' },
  { key: 'chronic', labelKey: 'medical.chronicDiagnoses' },
  { key: 'notes', labelKey: 'medical.notes' },
  { key: 'prescriptions', labelKey: 'medical.prescriptions' },
  { key: 'procedures', labelKey: 'procedures.title' },
  { key: 'radiology', labelKey: 'radiology.title' },
  { key: 'scans', labelKey: 'medical.scans' },
  { key: 'timeline', labelKey: 'timeline.title' },
] as const
type RecordTabKey = typeof RECORD_TABS[number]['key']

function TabPanel({ active, children }: { active: boolean; children: ReactNode }) {
  return <div style={{ display: active ? 'block' : 'none' }}>{children}</div>
}

// ---- Page ------------------------------------------------------------------
export function PatientRecordPage() {
  const { t } = useTranslation()
  const [patientId, setPatientId] = useState<number | ''>('')
  const [tab, setTab] = useState<RecordTabKey>('scribe')

  const { data: patients, isLoading } = useQuery({ queryKey: ['my-patients'], queryFn: medicalApi.myPatients })
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: authApi.me })

  const categories = useMemo(() => {
    const map = new Map<number, string>()
    me?.doctor_profile?.specialties_detail.forEach((s) => map.set(s.category, s.category_name))
    return Array.from(map, ([id, name]) => ({ id, name }))
  }, [me])

  if (isLoading) return <CenteredSpinner />

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[{ label: t('nav.patients') }]} />
        <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>{t('nav.patients')}</h1>
      </div>

      {(patients ?? []).length === 0 ? (
        <div className={CARD}><p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{t('medical.noPatients')}</p></div>
      ) : (
        <div className={CARD}>
          <FormField label={t('medical.selectPatient')}>
            {(p) => (
              <Select
                id={p.id}
                options={(patients ?? []).map((pt) => ({ value: pt.id, label: pt.full_name || pt.email || String(pt.id) }))}
                value={patientId}
                onChange={(v) => {
                  setPatientId(Array.isArray(v) || v === '' ? '' : Number(v))
                  setTab('scribe')
                }}
                placeholder="—"
                searchable
              />
            )}
          </FormField>
        </div>
      )}

      {patientId !== '' && (
        <>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label={t('nav.patients')}>
            {RECORD_TABS.map((tb) => (
              <button
                key={tb.key}
                type="button"
                role="tab"
                aria-selected={tab === tb.key}
                onClick={() => setTab(tb.key)}
                className={
                  tab === tb.key
                    ? 'shrink-0 whitespace-nowrap rounded-xl border border-[#0D9488] bg-[#0D9488] px-4 py-2 text-xs font-semibold text-white shadow-sm'
                    : 'shrink-0 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 transition-all hover:bg-slate-50'
                }
              >
                {tb.key === 'scans' ? `${t('medical.scans')} / ${t('medical.labs')}` : t(tb.labelKey)}
              </button>
            ))}
          </div>

          <TabPanel active={tab === 'scribe'}><AIScribePanel patientId={patientId} /></TabPanel>
          <TabPanel active={tab === 'vitals'}><VitalsSection patientId={patientId} /></TabPanel>
          <TabPanel active={tab === 'records'}><RecordsSection patientId={patientId} /></TabPanel>
          <TabPanel active={tab === 'chronic'}><ChronicDiagnosesSection patientId={patientId} /></TabPanel>
          <TabPanel active={tab === 'notes'}><NotesSection patientId={patientId} categories={categories} /></TabPanel>
          <TabPanel active={tab === 'prescriptions'}><PrescriptionsSection patientId={patientId} /></TabPanel>
          <TabPanel active={tab === 'procedures'}><ProceduresSection patientId={patientId} /></TabPanel>
          <TabPanel active={tab === 'radiology'}><RadiologySection patientId={patientId} /></TabPanel>
          <TabPanel active={tab === 'scans'}><ScansLabsSection patientId={patientId} /></TabPanel>
          <TabPanel active={tab === 'timeline'}>
            <div className={CARD}>
              <h2 className="patient-text-card-title mb-3" style={{ color: 'var(--text-primary)' }}>{t('timeline.title')}</h2>
              <PatientTimeline patientId={patientId} />
            </div>
          </TabPanel>
        </>
      )}
    </div>
  )
}
