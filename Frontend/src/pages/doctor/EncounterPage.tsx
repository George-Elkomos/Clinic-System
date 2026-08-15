import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { FormField } from '../../components/primitives/FormField'
import { Modal } from '../../components/primitives/Modal'
import { Select } from '../../components/primitives/Select'
import { AsyncCombobox, type ComboOption } from '../../components/primitives/AsyncCombobox'
import { CenteredSpinner, Spinner } from '../../components/primitives/Spinner'
import { useConfirm } from '../../components/primitives/ConfirmDialog'
import { useToast } from '../../components/primitives/Toast'
import { VitalSignsForm } from '../../components/vitals/VitalSignsForm'
import { MedicationItemRow } from '../../components/medical/MedicationItemRow'
import { CreateReferralModal } from '../../components/referrals/CreateReferralModal'
import { useAuth } from '../../hooks/useAuth'
import { useInteractionCheck } from '../../hooks/useInteractionCheck'
import { useLanguage } from '../../hooks/useLanguage'
import { errorMessage } from '../../services/apiClient'
import { complaintsApi, diagnosesApi, encountersApi } from '../../services/encounters.api'
import { labOrdersApi } from '../../services/labOrders.api'
import { medicalApi } from '../../services/medical.api'
import { proceduresApi } from '../../services/procedures.api'
import { radiologyApi } from '../../services/radiology.api'
import { ProcedureDetailModal } from '../../components/medical/ProcedureDetailModal'
import { RadiologyOrderDetailModal } from '../../components/medical/RadiologyOrderDetailModal'
import { localizedName } from '../../lib/format'
import type { Complaint, Encounter, EncounterStatus, Prescription, PrescriptionItem, UpdateEncounterPayload } from '../../services/types'

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all disabled:opacity-60 sm:text-sm'
const BTN_SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-60 sm:text-sm'
const BTN_DANGER = 'inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-5 py-2.5 text-xs font-medium text-rose-600 transition-all hover:bg-rose-100 disabled:opacity-60 sm:text-sm'
const BTN_SECONDARY_SM = 'inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-60'
const SECTION_DIVIDER = 'patient-text-card-title mb-3 mt-5 border-t border-slate-100 pt-4 first:mt-0 first:border-t-0 first:pt-0'

const ENCOUNTER_STATUS_BADGE: Record<EncounterStatus, string> = {
  DRAFT: 'bg-amber-50 text-amber-700 border-amber-200/60',
  SUBMITTED: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  AMENDED: 'bg-sky-50 text-sky-700 border-sky-200/60',
}

function StatusPill({ text, className }: { text: string; className: string }) {
  return <span className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>{text}</span>
}

// Show the ICD-10 code inline so doctors can confirm the coded diagnosis.
const diagnosisLabel = (d: { name: string; icd10_code?: string | null }) =>
  d.icd10_code ? `${d.name} (${d.icd10_code})` : d.name

const diagnosisFetcher = (q: string): Promise<ComboOption[]> =>
  diagnosesApi.search(q).then((rows) => rows.map((d) => ({ value: d.id, label: diagnosisLabel(d) })))

type FormState = {
  chief_complaint: string
  chief_complaint_ar: string
  symptoms: string[]
  examination_findings: string
  examination_findings_ar: string
  diagnosis_notes: string
  treatment_plan: string
  treatment_plan_ar: string
}

const formFromEncounter = (e: Encounter): FormState => ({
  chief_complaint: e.chief_complaint ?? '',
  chief_complaint_ar: e.chief_complaint_ar ?? '',
  symptoms: Array.isArray(e.symptoms) ? e.symptoms : [],
  examination_findings: e.examination_findings ?? '',
  examination_findings_ar: e.examination_findings_ar ?? '',
  diagnosis_notes: e.diagnosis_notes ?? '',
  treatment_plan: e.treatment_plan ?? '',
  treatment_plan_ar: e.treatment_plan_ar ?? '',
})

// ---- Inline prescription modal --------------------------------------------
const newEncounterRxItem = (): PrescriptionItem => ({
  medication: null, drug_name: '', dosage_strength: '', dosage_form: null, dosage_pattern: null,
  dosage: '', frequency: '', duration: '', instructions: '',
})

function PrescriptionModal({ encounter, onClose, onSaved }: { encounter: Encounter; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const { checkBeforeSubmit, checking, modal } = useInteractionCheck()
  const [items, setItems] = useState<PrescriptionItem[]>([newEncounterRxItem()])
  const [notes, setNotes] = useState('')

  const patchItem = (idx: number, patch: Partial<PrescriptionItem>) =>
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)))

  const hasContent = (i: PrescriptionItem) => !!i.medication || !!i.drug_name.trim()

  const save = useMutation({
    mutationFn: () =>
      medicalApi.createPrescription({
        patient: encounter.patient,
        encounter: encounter.id,
        notes,
        items: items.filter(hasContent),
      }),
    onSuccess: () => { showToast(t('encounters.saved'), 'success'); onSaved(); onClose() },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const handleSave = () =>
    checkBeforeSubmit(encounter.patient, items.filter(hasContent), () => save.mutate())

  return (
    <Modal title={t('encounters.rxModalTitle')} onClose={onClose} wide>
      {items.map((it, idx) => (
        <MedicationItemRow
          key={idx}
          item={it}
          onChange={(patch) => patchItem(idx, patch)}
          onRemove={() => setItems((arr) => arr.filter((_, i) => i !== idx))}
          canRemove={items.length > 1}
        />
      ))}
      <button type="button" onClick={() => setItems((arr) => [...arr, newEncounterRxItem()])} className={`${BTN_SECONDARY} mt-2`}>{t('medical.addItem')}</button>
      <FormField label={t('medical.instructions')}>
        {(p) => <textarea {...p} className="patient-field" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </FormField>
      <div className="mt-4 flex justify-end gap-3">
        <button type="button" onClick={onClose} className={BTN_SECONDARY}>{t('encounters.cancel')}</button>
        <button type="button" disabled={save.isPending || checking || !items.some(hasContent)} onClick={handleSave} className={BTN_PRIMARY}>
          {(save.isPending || checking) && <Spinner size={14} />}{t('encounters.save')}
        </button>
      </div>
      {modal}
    </Modal>
  )
}

// ---- Inline lab order modal -----------------------------------------------
function LabOrderModal({ encounter, onClose, onSaved }: { encounter: Encounter; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const [tests, setTests] = useState([{ test_name: '', test_code: '', notes: '' }])
  const [priority, setPriority] = useState<'ROUTINE' | 'URGENT' | 'STAT'>('ROUTINE')

  const setTest = (idx: number, key: 'test_name' | 'test_code', value: string) =>
    setTests((arr) => arr.map((it, i) => (i === idx ? { ...it, [key]: value } : it)))

  const save = useMutation({
    mutationFn: async () => {
      const order = await labOrdersApi.create({
        patient: encounter.patient,
        encounter: encounter.id,
        priority,
        items: tests.filter((tst) => tst.test_name),
      })
      return labOrdersApi.submit(order.id)
    },
    onSuccess: () => { showToast(t('encounters.saved'), 'success'); onSaved(); onClose() },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  return (
    <Modal title={t('encounters.labModalTitle')} onClose={onClose} wide>
      <FormField label={t('lab.priority')}>
        {(p) => (
          <Select
            id={p.id}
            options={['ROUTINE', 'URGENT', 'STAT'].map((v) => ({ value: v, label: t(`status.${v}`) }))}
            value={priority}
            onChange={(v) => setPriority(Array.isArray(v) ? 'ROUTINE' : (String(v) as 'ROUTINE' | 'URGENT' | 'STAT'))}
          />
        )}
      </FormField>
      {tests.map((tst, idx) => (
        <div key={idx} className="flex flex-col gap-3 rounded-xl border border-slate-100 bg-slate-50/40 p-4 sm:flex-row sm:items-end">
          <div className="flex-1"><FormField label={t('lab.testName')}>{(p) => <input {...p} className="patient-field" value={tst.test_name} onChange={(e) => setTest(idx, 'test_name', e.target.value)} />}</FormField></div>
          <div className="flex-1"><FormField label={t('lab.testCode')}>{(p) => <input {...p} className="patient-field" value={tst.test_code} onChange={(e) => setTest(idx, 'test_code', e.target.value)} />}</FormField></div>
          {tests.length > 1 && <button type="button" onClick={() => setTests((arr) => arr.filter((_, i) => i !== idx))} className={BTN_SECONDARY}>{t('medical.removeItem')}</button>}
        </div>
      ))}
      <button type="button" onClick={() => setTests((arr) => [...arr, { test_name: '', test_code: '', notes: '' }])} className={`${BTN_SECONDARY} mt-2`}>{t('encounters.addTest')}</button>
      <div className="mt-4 flex justify-end gap-3">
        <button type="button" onClick={onClose} className={BTN_SECONDARY}>{t('encounters.cancel')}</button>
        <button type="button" disabled={save.isPending || !tests.some((tst) => tst.test_name)} onClick={() => save.mutate()} className={BTN_PRIMARY}>
          {save.isPending && <Spinner size={14} />}{t('encounters.save')}
        </button>
      </div>
    </Modal>
  )
}

// ---- Inline "add procedure" modal ------------------------------------------
const CUSTOM_TEMPLATE_CHOICE = 'custom'

function ProcedureModal({ encounter, onClose, onSaved }: { encounter: Encounter; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { showToast } = useToast()
  const [choice, setChoice] = useState<string | number>('')
  const [customName, setCustomName] = useState('')
  const [customNameAr, setCustomNameAr] = useState('')
  const [preNotes, setPreNotes] = useState('')

  const { data: templates = [] } = useQuery({
    queryKey: ['procedure-templates', 'active'],
    queryFn: () => proceduresApi.listTemplates({ is_active: true }).then((r) => r.results),
    staleTime: 300_000,
  })

  const templateOptions = [
    ...templates.map((tpl) => ({ value: tpl.id, label: localizedName(tpl, language) })),
    { value: CUSTOM_TEMPLATE_CHOICE, label: t('procedures.customOption') },
  ]

  const isCustom = choice === CUSTOM_TEMPLATE_CHOICE
  const canSave = isCustom ? customName.trim().length > 0 : typeof choice === 'number'

  const save = useMutation({
    mutationFn: () =>
      proceduresApi.create({
        patient: encounter.patient,
        encounter: encounter.id,
        template: typeof choice === 'number' ? choice : null,
        procedure_name: isCustom ? customName : undefined,
        procedure_name_ar: isCustom ? customNameAr : undefined,
        pre_procedure_notes: preNotes || undefined,
      }),
    onSuccess: () => { showToast(t('procedures.saved'), 'success'); onSaved(); onClose() },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  return (
    <Modal title={t('procedures.modalTitle')} onClose={onClose} wide>
      <FormField label={t('procedures.template')}>
        {(p) => (
          <Select
            id={p.id}
            options={templateOptions}
            value={choice}
            onChange={(v) => setChoice(Array.isArray(v) ? '' : v)}
          />
        )}
      </FormField>

      {isCustom && (
        <>
          <FormField label={t('procedures.customName')}>
            {(p) => <input {...p} className="patient-field" value={customName} onChange={(e) => setCustomName(e.target.value)} />}
          </FormField>
          <FormField label={t('procedures.customNameAr')}>
            {(p) => <input {...p} className="patient-field" dir="rtl" value={customNameAr} onChange={(e) => setCustomNameAr(e.target.value)} />}
          </FormField>
        </>
      )}

      <FormField label={t('procedures.preProcedureNotes')} hint={t('procedures.preProcedureNotesHint')}>
        {(p) => <textarea {...p} className="patient-field" rows={2} value={preNotes} onChange={(e) => setPreNotes(e.target.value)} />}
      </FormField>

      <div className="mt-4 flex justify-end gap-3">
        <button type="button" onClick={onClose} className={BTN_SECONDARY}>{t('encounters.cancel')}</button>
        <button type="button" disabled={save.isPending || !canSave} onClick={() => save.mutate()} className={BTN_PRIMARY}>
          {save.isPending && <Spinner size={14} />}{t('encounters.save')}
        </button>
      </div>
    </Modal>
  )
}

// ---- Inline "order radiology study" modal ----------------------------------
function RadiologyOrderModal({ encounter, onClose, onSaved }: { encounter: Encounter; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { showToast } = useToast()
  const [choice, setChoice] = useState<string | number>('')
  const [customName, setCustomName] = useState('')
  const [customNameAr, setCustomNameAr] = useState('')
  const [clinicalReason, setClinicalReason] = useState('')
  const [priority, setPriority] = useState<'ROUTINE' | 'URGENT'>('ROUTINE')

  const { data: templates = [] } = useQuery({
    queryKey: ['radiology-templates', 'active'],
    queryFn: () => radiologyApi.listTemplates({ is_active: true }).then((r) => r.results),
    staleTime: 300_000,
  })

  const templateOptions = [
    ...templates.map((tpl) => ({ value: tpl.id, label: localizedName(tpl, language) })),
    { value: CUSTOM_TEMPLATE_CHOICE, label: t('radiology.customOption') },
  ]

  const isCustom = choice === CUSTOM_TEMPLATE_CHOICE
  const canSave = isCustom ? customName.trim().length > 0 : typeof choice === 'number'

  const save = useMutation({
    mutationFn: () =>
      radiologyApi.create({
        patient: encounter.patient,
        encounter: encounter.id,
        template: typeof choice === 'number' ? choice : null,
        study_name: isCustom ? customName : undefined,
        study_name_ar: isCustom ? customNameAr : undefined,
        clinical_reason: clinicalReason || undefined,
        priority,
      }),
    onSuccess: () => { showToast(t('radiology.saved'), 'success'); onSaved(); onClose() },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  return (
    <Modal title={t('radiology.modalTitle')} onClose={onClose} wide>
      <FormField label={t('radiology.template')}>
        {(p) => (
          <Select
            id={p.id}
            options={templateOptions}
            value={choice}
            onChange={(v) => setChoice(Array.isArray(v) ? '' : v)}
          />
        )}
      </FormField>

      {isCustom && (
        <>
          <FormField label={t('radiology.customName')}>
            {(p) => <input {...p} className="patient-field" value={customName} onChange={(e) => setCustomName(e.target.value)} />}
          </FormField>
          <FormField label={t('radiology.customNameAr')}>
            {(p) => <input {...p} className="patient-field" dir="rtl" value={customNameAr} onChange={(e) => setCustomNameAr(e.target.value)} />}
          </FormField>
        </>
      )}

      <FormField label={t('radiology.priority')}>
        {(p) => (
          <Select
            id={p.id}
            options={['ROUTINE', 'URGENT'].map((v) => ({ value: v, label: t(`status.${v}`) }))}
            value={priority}
            onChange={(v) => setPriority(Array.isArray(v) ? 'ROUTINE' : (String(v) as 'ROUTINE' | 'URGENT'))}
          />
        )}
      </FormField>

      <FormField label={t('radiology.clinicalReason')} hint={t('radiology.clinicalReasonHint')}>
        {(p) => <textarea {...p} className="patient-field" rows={2} value={clinicalReason} onChange={(e) => setClinicalReason(e.target.value)} />}
      </FormField>

      <div className="mt-4 flex justify-end gap-3">
        <button type="button" onClick={onClose} className={BTN_SECONDARY}>{t('encounters.cancel')}</button>
        <button type="button" disabled={save.isPending || !canSave} onClick={() => save.mutate()} className={BTN_PRIMARY}>
          {save.isPending && <Spinner size={14} />}{t('encounters.save')}
        </button>
      </div>
    </Modal>
  )
}

// ---- Prescription sidebar item with inline void form ---------------------
function PrescriptionSidebarItem({
  prescription: p,
  canVoid,
  onVoided,
}: {
  prescription: Prescription
  canVoid: boolean
  onVoided: () => void
}) {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')

  const cancel = useMutation({
    mutationFn: () => medicalApi.cancelPrescription(p.id, reason),
    onSuccess: () => {
      showToast(t('medical.voidedBadge'), 'success')
      setVoiding(false)
      setReason('')
      onVoided()
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const drugs = (p.items ?? []).map((i) => i.drug_name).join(', ') || `#${p.id}`

  return (
    <li className={`py-2 ${p.status === 'CANCELLED' ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`patient-text-body truncate ${p.status === 'CANCELLED' ? 'line-through' : ''}`} style={{ color: 'var(--text-primary)' }}>{drugs}</span>
        {p.status === 'CANCELLED' ? (
          <StatusPill text={t('medical.voidedBadge')} className="bg-slate-50 text-slate-500 border-slate-200/60" />
        ) : canVoid ? (
          <button
            type="button"
            onClick={() => setVoiding((v) => !v)}
            title={t('medical.voidPrescription')}
            className="shrink-0 rounded-lg border border-rose-200 bg-rose-50 p-1.5 text-xs hover:bg-rose-100"
          >
            🚫
          </button>
        ) : null}
      </div>

      {p.status === 'CANCELLED' && p.cancellation_reason && (
        <p className="patient-text-body-secondary mt-1" style={{ color: 'var(--text-muted)' }}>
          {t('medical.voidReason', { reason: p.cancellation_reason })}
        </p>
      )}

      {voiding && (
        <div className="mt-2 flex flex-col gap-2">
          <textarea
            className="patient-field"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('medical.voidReasonPlaceholder')}
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => { setVoiding(false); setReason('') }} className={BTN_SECONDARY_SM}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              disabled={cancel.isPending || reason.trim().length < 5}
              onClick={() => cancel.mutate()}
              className={BTN_DANGER}
            >
              {cancel.isPending && <Spinner size={14} />}{t('medical.voidConfirmBtn')}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

export function EncounterPage() {
  const { t } = useTranslation()
  const { appointmentId } = useParams<{ appointmentId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const { language } = useLanguage()

  const [encounterId, setEncounterId] = useState<number | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [complaint, setComplaint] = useState<ComboOption | null>(null)
  const [diagnosis, setDiagnosis] = useState<ComboOption | null>(null)
  const [showRx, setShowRx] = useState(false)
  const [showLab, setShowLab] = useState(false)
  const [showProcedure, setShowProcedure] = useState(false)
  const [showReferral, setShowReferral] = useState(false)
  const [showRadiologyOrder, setShowRadiologyOrder] = useState(false)
  const [openProcedureId, setOpenProcedureId] = useState<number | null>(null)
  const [openRadiologyOrderId, setOpenRadiologyOrderId] = useState<number | null>(null)
  const [replacingVitals, setReplacingVitals] = useState(false)
  const [editingVitals, setEditingVitals] = useState(false)
  const hydrated = useRef(false)
  const hasEdited = useRef(false)

  // Symptom options come from the active complaints list.
  const { data: symptomOptions = [] } = useQuery({
    queryKey: ['complaints', 'all'],
    queryFn: () => complaintsApi.search(''),
    staleTime: 300_000,
  })

  // Every row the doctor has searched up, keyed by id — the search endpoint is
  // paginated, so a full "list everything" query can't be trusted to contain
  // whichever complaint was just picked. This lets a picked complaint drive
  // both the EN and AR fields from the same canonical master row, regardless
  // of the UI's display language.
  const complaintCache = useRef(new Map<number, Complaint>())

  // Label matches the UI language when a translation exists, so an Arabic search
  // shows Arabic results instead of always falling back to the English name.
  const complaintFetcher = useCallback(
    (q: string): Promise<ComboOption[]> =>
      complaintsApi.search(q).then((rows) => {
        rows.forEach((c) => complaintCache.current.set(c.id, c))
        return rows.map((c) => ({ value: c.id, label: localizedName(c, language) }))
      }),
    [language],
  )

  // Create-or-fetch the draft encounter for this appointment.
  const draft = useMutation({
    mutationFn: () => encountersApi.draftForAppointment(Number(appointmentId)),
    onSuccess: (enc) => {
      setEncounterId(enc.id)
      qc.setQueryData(['encounter', enc.id], enc)
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  useEffect(() => {
    if (appointmentId && !draft.isPending && encounterId === null) draft.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentId])

  const { data: encounter } = useQuery({
    queryKey: ['encounter', encounterId],
    queryFn: () => encountersApi.get(encounterId as number),
    enabled: encounterId != null,
    staleTime: 5_000,
  })

  // Hydrate local form/comboboxes once when the encounter first loads.
  useEffect(() => {
    if (encounter && !hydrated.current) {
      hydrated.current = true
      setForm(formFromEncounter(encounter))
      if (encounter.chief_complaint) setComplaint({ value: -1, label: encounter.chief_complaint })
      if (encounter.diagnosis_detail) setDiagnosis({ value: encounter.diagnosis_detail.id, label: diagnosisLabel(encounter.diagnosis_detail) })
    }
  }, [encounter])

  const isDraft = encounter?.status === 'DRAFT'
  const isOwner = !!encounter && !!user?.doctor_profile?.id && encounter.doctor === user.doctor_profile.id

  // Debounced autosave of the structured fields while the encounter is a draft.
  const save = useMutation({
    mutationFn: (payload: UpdateEncounterPayload) => encountersApi.update(encounterId as number, payload),
    onSuccess: (updated) => qc.setQueryData(['encounter', encounterId], updated),
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const buildPayload = (f: FormState): UpdateEncounterPayload => {
    // complaint.label may be localized for display — always save the canonical
    // EN/AR pair from the master row so stored data stays consistent regardless
    // of which language the doctor's UI happens to be in.
    const selectedComplaint = complaint ? complaintCache.current.get(complaint.value) : undefined
    return {
      chief_complaint: selectedComplaint?.name ?? complaint?.label ?? f.chief_complaint,
      chief_complaint_ar: selectedComplaint?.name_ar ?? f.chief_complaint_ar,
      symptoms: f.symptoms,
      examination_findings: f.examination_findings,
      examination_findings_ar: f.examination_findings_ar,
      diagnosis: diagnosis?.value && diagnosis.value > 0 ? diagnosis.value : null,
      diagnosis_notes: f.diagnosis_notes,
      treatment_plan: f.treatment_plan,
      treatment_plan_ar: f.treatment_plan_ar,
    }
  }

  useEffect(() => {
    if (!form || !encounterId || !isDraft || !hydrated.current || !hasEdited.current) return
    const handle = window.setTimeout(() => save.mutate(buildPayload(form)), 600)
    return () => window.clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, complaint, diagnosis])

  const submit = useMutation({
    mutationFn: () => encountersApi.submit(encounterId as number),
    onSuccess: (updated) => {
      showToast(t('encounters.submitted'), 'success')
      qc.setQueryData(['encounter', encounterId], updated)
      qc.invalidateQueries({ queryKey: ['appointments'] })
      navigate('/doctor/queue')
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const amend = useMutation({
    mutationFn: () => encountersApi.amend(encounterId as number),
    onSuccess: (twin) => {
      showToast(t('encounters.amended'), 'success')
      hydrated.current = false
      setReplacingVitals(false)
      setEditingVitals(false)
      setEncounterId(twin.id)
      qc.setQueryData(['encounter', twin.id], twin)
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const refreshEncounter = () => qc.invalidateQueries({ queryKey: ['encounter', encounterId] })

  if (!encounter || !form) return <CenteredSpinner />

  // Mirrors the backend's _has_clinical_content check (services.py) — a
  // submitted encounter must record more than pure bookkeeping.
  const missingClinicalContent =
    !complaint &&
    !diagnosis &&
    !form.diagnosis_notes.trim() &&
    !form.treatment_plan.trim() &&
    !form.examination_findings.trim()

  const handleSubmit = async () => {
    if (missingClinicalContent) {
      showToast(t('encounters.missingContentToast'), 'error')
      return
    }
    const ok = await confirm({
      title: t('encounters.submitConfirmTitle'),
      message: t('encounters.submitConfirmMessage'),
    })
    if (ok) {
      // Flush any pending field edits before submitting.
      await save.mutateAsync(buildPayload(form))
      submit.mutate()
    }
  }

  const set = (key: keyof FormState, value: string | string[]) => {
    hasEdited.current = true
    setForm((f) => (f ? { ...f, [key]: value } : f))
  }

  const setComplaintAndMark = (opt: ComboOption | null) => {
    hasEdited.current = true
    setComplaint(opt)
    // Keep the AR field in lockstep with the picked master row (or clear it).
    const row = opt ? complaintCache.current.get(opt.value) : undefined
    setForm((f) => (f ? { ...f, chief_complaint_ar: opt ? (row?.name_ar ?? f.chief_complaint_ar) : '' } : f))
  }

  const setDiagnosisAndMark = (opt: ComboOption | null) => {
    hasEdited.current = true
    setDiagnosis(opt)
  }

  const readOnly = !isDraft || !isOwner

  // Doctors/secretaries can only edit a vitals reading within 24h of when it
  // was recorded (managers: no limit) -- mirrors VitalSignsHistory's rule so
  // the "Edit" affordance here and on /doctor/patients stay consistent.
  const VITALS_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000
  const canEditVitals =
    !!encounter.vitals_detail &&
    (user?.role === 'MANAGER' ||
      Date.now() - new Date(encounter.vitals_detail.created_at).getTime() <= VITALS_EDIT_WINDOW_MS)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[{ label: t('encounters.title') }]} />
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="patient-text-page-title" style={{ color: 'var(--text-primary)' }}>{t('encounters.title')} — {encounter.patient_name}</h1>
          <StatusPill text={t(`encounters.status.${encounter.status}`)} className={ENCOUNTER_STATUS_BADGE[encounter.status] ?? ENCOUNTER_STATUS_BADGE.DRAFT} />
        </div>
      </div>

      {readOnly && (
        <div className={CARD}>
          <p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{t('encounters.lockedHint')}</p>
          {isOwner && encounter.status !== 'DRAFT' && (
            <button type="button" disabled={amend.isPending} onClick={() => amend.mutate()} className={`${BTN_PRIMARY} mt-3`}>
              {amend.isPending && <Spinner size={14} />}{t('encounters.amend')}
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="flex flex-col gap-4 lg:col-span-8">
          <div className={CARD}>
            <h2 className="patient-text-card-title mb-3" style={{ color: 'var(--text-primary)' }}>{t('encounters.blockComplaint')}</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField label={t('encounters.chiefComplaint')}>
                {(p) => (
                  <AsyncCombobox
                    id={p.id}
                    value={complaint}
                    onChange={setComplaintAndMark}
                    fetcher={complaintFetcher}
                    placeholder={t('encounters.complaintPlaceholder')}
                    disabled={readOnly}
                  />
                )}
              </FormField>
              <FormField label={t('encounters.chiefComplaintAr')} hint={t('encounters.complaintArHint')}>
                {(p) => <input {...p} className="patient-field" dir="rtl" readOnly value={form.chief_complaint_ar} disabled={readOnly} />}
              </FormField>
            </div>
          </div>

          <div className={CARD}>
            <h2 className="patient-text-card-title mb-3" style={{ color: 'var(--text-primary)' }}>{t('encounters.blockSymptomsVitals')}</h2>
            <FormField label={t('encounters.symptoms')} hint={t('encounters.symptomsHint')}>
              {(p) => (
                <Select
                  id={p.id}
                  multi
                  searchable
                  options={symptomOptions.map((c) => ({ value: c.name, label: c.name }))}
                  value={form.symptoms}
                  onChange={(v) => set('symptoms', Array.isArray(v) ? v.map(String) : [])}
                  disabled={readOnly}
                />
              )}
            </FormField>

            <h3 className={SECTION_DIVIDER}>{t('encounters.captureVitals')}</h3>
            {encounter.vitals_detail && !replacingVitals && !editingVitals ? (
              <>
                <p className="patient-text-body" style={{ color: 'var(--text-primary)' }}>
                  ✓ {t('encounters.vitalsLinked')} — BP {encounter.vitals_detail.bp_systolic}/{encounter.vitals_detail.bp_diastolic}, HR {encounter.vitals_detail.heart_rate}
                </p>
                {!readOnly && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {canEditVitals && (
                      <button type="button" onClick={() => setEditingVitals(true)} className={BTN_SECONDARY}>
                        {t('common.edit')}
                      </button>
                    )}
                    <button type="button" onClick={() => setReplacingVitals(true)} className={BTN_SECONDARY}>
                      {t('encounters.recordNewVitals')}
                    </button>
                  </div>
                )}
              </>
            ) : !readOnly ? (
              <VitalSignsForm
                patientId={encounter.patient}
                appointmentId={encounter.appointment}
                initial={editingVitals ? (encounter.vitals_detail ?? undefined) : undefined}
                onCancel={
                  encounter.vitals_detail
                    ? () => { setReplacingVitals(false); setEditingVitals(false) }
                    : undefined
                }
                onSuccess={(created) => {
                  if (created && !editingVitals) save.mutate({ vitals: created.id })
                  setReplacingVitals(false)
                  setEditingVitals(false)
                  refreshEncounter()
                }}
              />
            ) : (
              <p className="patient-text-body-secondary" style={{ color: 'var(--text-muted)' }}>—</p>
            )}
          </div>

          <div className={CARD}>
            <h2 className="patient-text-card-title mb-3" style={{ color: 'var(--text-primary)' }}>{t('encounters.blockExamination')}</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField label={t('encounters.examinationFindings')}>
                {(p) => <textarea {...p} className="patient-field" rows={3} value={form.examination_findings} onChange={(e) => set('examination_findings', e.target.value)} disabled={readOnly} />}
              </FormField>
              <FormField label={t('encounters.examinationFindingsAr')}>
                {(p) => <textarea {...p} className="patient-field" dir="rtl" rows={3} value={form.examination_findings_ar} onChange={(e) => set('examination_findings_ar', e.target.value)} disabled={readOnly} />}
              </FormField>
            </div>
          </div>

          <div className={CARD}>
            <h2 className="patient-text-card-title mb-3" style={{ color: 'var(--text-primary)' }}>{t('encounters.blockDiagnosis')}</h2>
            <FormField label={t('encounters.diagnosis')}>
              {(p) => (
                <AsyncCombobox
                  id={p.id}
                  value={diagnosis}
                  onChange={setDiagnosisAndMark}
                  fetcher={diagnosisFetcher}
                  placeholder={t('encounters.diagnosisPlaceholder')}
                  disabled={readOnly}
                />
              )}
            </FormField>
            <FormField label={t('encounters.diagnosisNotes')}>
              {(p) => <textarea {...p} className="patient-field" rows={2} value={form.diagnosis_notes} onChange={(e) => set('diagnosis_notes', e.target.value)} disabled={readOnly} />}
            </FormField>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField label={t('encounters.treatmentPlan')}>
                {(p) => <textarea {...p} className="patient-field" rows={3} value={form.treatment_plan} onChange={(e) => set('treatment_plan', e.target.value)} disabled={readOnly} />}
              </FormField>
              <FormField label={t('encounters.treatmentPlanAr')}>
                {(p) => <textarea {...p} className="patient-field" dir="rtl" rows={3} value={form.treatment_plan_ar} onChange={(e) => set('treatment_plan_ar', e.target.value)} disabled={readOnly} />}
              </FormField>
            </div>
          </div>

          {!readOnly && (
            <div className="flex flex-col gap-3">
              {missingClinicalContent && (
                <div
                  role="alert"
                  className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 sm:text-sm"
                >
                  {t('encounters.missingContentWarning')}
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                <span className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{t('encounters.savedDraftHint')}</span>
                <button
                  type="button"
                  disabled={submit.isPending || missingClinicalContent}
                  title={missingClinicalContent ? t('encounters.missingContentWarning') : undefined}
                  onClick={handleSubmit}
                  className={BTN_PRIMARY}
                >
                  {submit.isPending && <Spinner size={14} />}{t('encounters.submit')}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* top-24 (not top-6) clears PortalShell's h-20 sticky header + a gap — a
            literal top-6 would tuck the sticky sidebar under the header, hidden
            behind its higher z-index while scrolling. self-start is required, not
            optional: without it, the grid's default align-items:stretch grows this
            item's own box to match the taller main column, leaving sticky zero
            slack to hold within (offset range = cellHeight - itemHeight = 0) — it
            then behaves exactly like `static`. self-start keeps the box at its own
            content height so there's real room for it to stick. Verified by
            measuring getBoundingClientRect().top before/after a real scroll, not
            just by eyeballing a screenshot — the visual symptom of the stretched
            version (scrolling away 1:1 with the page) is easy to misread as
            "sticky isn't applying at all". */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:col-span-4 lg:self-start">
          <div className={CARD}>
            <h2 className="patient-text-card-title mb-3" style={{ color: 'var(--text-primary)' }}>{t('encounters.sidebarTitle')}</h2>
            <div className="flex flex-col gap-2">
              <button type="button" disabled={readOnly} onClick={() => setShowRx(true)} className={`${BTN_SECONDARY} w-full`}>{t('encounters.addPrescription')}</button>
              <button type="button" disabled={readOnly} onClick={() => setShowLab(true)} className={`${BTN_SECONDARY} w-full`}>{t('encounters.orderLab')}</button>
              <button type="button" disabled={readOnly} onClick={() => setShowProcedure(true)} className={`${BTN_SECONDARY} w-full`}>{t('encounters.addProcedure')}</button>
              <button type="button" disabled={readOnly} onClick={() => setShowRadiologyOrder(true)} className={`${BTN_SECONDARY} w-full`}>{t('encounters.addRadiologyOrder')}</button>
              <button type="button" disabled={!isOwner} onClick={() => setShowReferral(true)} className={`${BTN_SECONDARY} w-full`}>{t('referrals.referPatient')}</button>
            </div>

            <h3 className={SECTION_DIVIDER}>{t('encounters.linkedPrescriptions')}</h3>
            {(encounter.prescriptions ?? []).length === 0 ? (
              <p className="patient-text-body-secondary" style={{ color: 'var(--text-muted)' }}>{t('encounters.noneLinked')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-slate-100">
                {(encounter.prescriptions ?? []).map((p) => (
                  <PrescriptionSidebarItem
                    key={p.id}
                    prescription={p}
                    canVoid={isDraft && isOwner}
                    onVoided={refreshEncounter}
                  />
                ))}
              </ul>
            )}

            <h3 className={SECTION_DIVIDER}>{t('encounters.linkedLabs')}</h3>
            {(encounter.lab_orders ?? []).length === 0 ? (
              <p className="patient-text-body-secondary" style={{ color: 'var(--text-muted)' }}>{t('encounters.noneLinked')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-slate-100">
                {(encounter.lab_orders ?? []).map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="patient-text-body truncate" style={{ color: 'var(--text-primary)' }}>{o.order_number}</span>
                    <StatusPill text={t(`status.${o.status}`)} className="bg-sky-50 text-sky-700 border-sky-200/60" />
                  </li>
                ))}
              </ul>
            )}

            <h3 className={SECTION_DIVIDER}>{t('encounters.linkedProcedures')}</h3>
            {(encounter.procedures ?? []).length === 0 ? (
              <p className="patient-text-body-secondary" style={{ color: 'var(--text-muted)' }}>{t('encounters.noneLinked')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-slate-100">
                {(encounter.procedures ?? []).map((proc) => (
                  <li key={proc.id}>
                    <button type="button" onClick={() => setOpenProcedureId(proc.id)} className="flex w-full items-center justify-between gap-2 py-2 text-left hover:bg-slate-50/60">
                      <span className="patient-text-body truncate" style={{ color: 'var(--text-primary)' }}>{proc.procedure_name}</span>
                      <StatusPill text={t(`procedures.status.${proc.status}`)} className="bg-sky-50 text-sky-700 border-sky-200/60" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <h3 className={SECTION_DIVIDER}>{t('encounters.linkedRadiologyOrders')}</h3>
            {(encounter.radiology_orders ?? []).length === 0 ? (
              <p className="patient-text-body-secondary" style={{ color: 'var(--text-muted)' }}>{t('encounters.noneLinked')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-slate-100">
                {(encounter.radiology_orders ?? []).map((order) => (
                  <li key={order.id}>
                    <button type="button" onClick={() => setOpenRadiologyOrderId(order.id)} className="flex w-full items-center justify-between gap-2 py-2 text-left hover:bg-slate-50/60">
                      <span className="patient-text-body truncate" style={{ color: 'var(--text-primary)' }}>{order.study_name}</span>
                      <StatusPill text={t(`radiology.status.${order.status}`)} className="bg-sky-50 text-sky-700 border-sky-200/60" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      {showRx && <PrescriptionModal encounter={encounter} onClose={() => setShowRx(false)} onSaved={refreshEncounter} />}
      {showLab && <LabOrderModal encounter={encounter} onClose={() => setShowLab(false)} onSaved={refreshEncounter} />}
      {showProcedure && <ProcedureModal encounter={encounter} onClose={() => setShowProcedure(false)} onSaved={refreshEncounter} />}
      {showRadiologyOrder && <RadiologyOrderModal encounter={encounter} onClose={() => setShowRadiologyOrder(false)} onSaved={refreshEncounter} />}
      {showReferral && <CreateReferralModal encounterId={encounter.id} onClose={() => setShowReferral(false)} />}
      {openProcedureId != null && (
        <ProcedureDetailModal
          procedureId={openProcedureId}
          onClose={() => setOpenProcedureId(null)}
          onChanged={refreshEncounter}
        />
      )}
      {openRadiologyOrderId != null && (
        <RadiologyOrderDetailModal
          orderId={openRadiologyOrderId}
          onClose={() => setOpenRadiologyOrderId(null)}
          onChanged={refreshEncounter}
        />
      )}
    </div>
  )
}
