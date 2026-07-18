import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Button } from '../../components/primitives/Button'
import { Card } from '../../components/primitives/Card'
import { FormField } from '../../components/primitives/FormField'
import { Modal } from '../../components/primitives/Modal'
import { Select } from '../../components/primitives/Select'
import { AsyncCombobox, type ComboOption } from '../../components/primitives/AsyncCombobox'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { StatusBadge } from '../../components/primitives/StatusBadge'
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
import { localizedName } from '../../lib/format'
import type { Complaint, Encounter, Prescription, PrescriptionItem, UpdateEncounterPayload } from '../../services/types'

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
      <Button variant="secondary" onClick={() => setItems((arr) => [...arr, newEncounterRxItem()])} className="medical-add-item-btn">{t('medical.addItem')}</Button>
      <FormField label={t('medical.instructions')}>
        {(p) => <textarea {...p} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </FormField>
      <div className="modal__actions">
        <Button variant="secondary" onClick={onClose}>{t('encounters.cancel')}</Button>
        <Button loading={save.isPending || checking} disabled={!items.some(hasContent)} onClick={handleSave}>{t('encounters.save')}</Button>
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
        <div key={idx} className="lab-item-row">
          <div className="lab-item-row__name"><FormField label={t('lab.testName')}>{(p) => <input {...p} value={tst.test_name} onChange={(e) => setTest(idx, 'test_name', e.target.value)} />}</FormField></div>
          <div className="lab-item-row__code"><FormField label={t('lab.testCode')}>{(p) => <input {...p} value={tst.test_code} onChange={(e) => setTest(idx, 'test_code', e.target.value)} />}</FormField></div>
          {tests.length > 1 && <Button variant="secondary" onClick={() => setTests((arr) => arr.filter((_, i) => i !== idx))}>{t('medical.removeItem')}</Button>}
        </div>
      ))}
      <Button variant="secondary" onClick={() => setTests((arr) => [...arr, { test_name: '', test_code: '', notes: '' }])} className="medical-add-item-btn">{t('encounters.addTest')}</Button>
      <div className="modal__actions">
        <Button variant="secondary" onClick={onClose}>{t('encounters.cancel')}</Button>
        <Button loading={save.isPending} disabled={!tests.some((tst) => tst.test_name)} onClick={() => save.mutate()}>{t('encounters.save')}</Button>
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
    <li className={`encounter-rx-item${p.status === 'CANCELLED' ? ' encounter-rx-item--voided' : ''}`}>
      <div className="encounter-rx-item__row">
        <span className="encounter-rx-item__drugs">{drugs}</span>
        {p.status === 'CANCELLED' ? (
          <span className="badge badge--CANCELLED">{t('medical.voidedBadge')}</span>
        ) : canVoid ? (
          <button
            type="button"
            className="encounter-rx-void-btn"
            onClick={() => setVoiding((v) => !v)}
            title={t('medical.voidPrescription')}
          >
            🚫
          </button>
        ) : null}
      </div>

      {p.status === 'CANCELLED' && p.cancellation_reason && (
        <p className="encounter-rx-item__reason">
          {t('medical.voidReason', { reason: p.cancellation_reason })}
        </p>
      )}

      {voiding && (
        <div className="encounter-rx-void-form">
          <textarea
            className="encounter-rx-void-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('medical.voidReasonPlaceholder')}
          />
          <div className="encounter-rx-void-actions">
            <Button variant="secondary" onClick={() => { setVoiding(false); setReason('') }}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={cancel.isPending}
              disabled={reason.trim().length < 5}
              onClick={() => cancel.mutate()}
            >
              {t('medical.voidConfirmBtn')}
            </Button>
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
  const [showReferral, setShowReferral] = useState(false)
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
      setEncounterId(twin.id)
      qc.setQueryData(['encounter', twin.id], twin)
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const handleSubmit = async () => {
    const ok = await confirm({
      title: t('encounters.submitConfirmTitle'),
      message: t('encounters.submitConfirmMessage'),
    })
    if (ok) {
      // Flush any pending field edits before submitting.
      if (form) await save.mutateAsync(buildPayload(form))
      submit.mutate()
    }
  }

  const refreshEncounter = () => qc.invalidateQueries({ queryKey: ['encounter', encounterId] })

  if (!encounter || !form) return <CenteredSpinner />

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

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('encounters.title') }]} />
      <div className="encounter-head">
        <h1>{t('encounters.title')} — {encounter.patient_name}</h1>
        <StatusBadge status={encounter.status} ns="encounters.status" />
      </div>

      {readOnly && (
        <Card>
          <p className="encounter-locked">{t('encounters.lockedHint')}</p>
          {isOwner && encounter.status !== 'DRAFT' && (
            <Button loading={amend.isPending} onClick={() => amend.mutate()}>{t('encounters.amend')}</Button>
          )}
        </Card>
      )}

      <div className="encounter-layout">
        <div className="encounter-main">
          <Card title={t('encounters.blockComplaint')}>
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
              {(p) => <input {...p} dir="rtl" readOnly value={form.chief_complaint_ar} disabled={readOnly} />}
            </FormField>
          </Card>

          <Card title={t('encounters.blockSymptomsVitals')}>
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

            <h3 className="medical-section-divider">{t('encounters.captureVitals')}</h3>
            {encounter.vitals_detail ? (
              <p className="encounter-vitals-linked">
                ✓ {t('encounters.vitalsLinked')} — BP {encounter.vitals_detail.bp_systolic}/{encounter.vitals_detail.bp_diastolic}, HR {encounter.vitals_detail.heart_rate}
              </p>
            ) : !readOnly ? (
              <VitalSignsForm
                patientId={encounter.patient}
                appointmentId={encounter.appointment}
                onSuccess={(created) => {
                  if (created) save.mutate({ vitals: created.id })
                  refreshEncounter()
                }}
              />
            ) : (
              <p className="encounter-vitals-linked">—</p>
            )}
          </Card>

          <Card title={t('encounters.blockExamination')}>
            <FormField label={t('encounters.examinationFindings')}>
              {(p) => <textarea {...p} rows={3} value={form.examination_findings} onChange={(e) => set('examination_findings', e.target.value)} disabled={readOnly} />}
            </FormField>
            <FormField label={t('encounters.examinationFindingsAr')}>
              {(p) => <textarea {...p} dir="rtl" rows={3} value={form.examination_findings_ar} onChange={(e) => set('examination_findings_ar', e.target.value)} disabled={readOnly} />}
            </FormField>
          </Card>

          <Card title={t('encounters.blockDiagnosis')}>
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
              {(p) => <textarea {...p} rows={2} value={form.diagnosis_notes} onChange={(e) => set('diagnosis_notes', e.target.value)} disabled={readOnly} />}
            </FormField>
            <FormField label={t('encounters.treatmentPlan')}>
              {(p) => <textarea {...p} rows={3} value={form.treatment_plan} onChange={(e) => set('treatment_plan', e.target.value)} disabled={readOnly} />}
            </FormField>
            <FormField label={t('encounters.treatmentPlanAr')}>
              {(p) => <textarea {...p} dir="rtl" rows={3} value={form.treatment_plan_ar} onChange={(e) => set('treatment_plan_ar', e.target.value)} disabled={readOnly} />}
            </FormField>
          </Card>

          {!readOnly && (
            <div className="encounter-submit-row">
              <span className="encounter-autosave-hint">{t('encounters.savedDraftHint')}</span>
              <Button loading={submit.isPending} onClick={handleSubmit}>{t('encounters.submit')}</Button>
            </div>
          )}
        </div>

        <aside className="encounter-sidebar">
          <Card title={t('encounters.sidebarTitle')}>
            <div className="encounter-sidebar-actions">
              <Button variant="secondary" disabled={readOnly} onClick={() => setShowRx(true)}>{t('encounters.addPrescription')}</Button>
              <Button variant="secondary" disabled={readOnly} onClick={() => setShowLab(true)}>{t('encounters.orderLab')}</Button>
              <Button variant="secondary" disabled={!isOwner} onClick={() => setShowReferral(true)}>{t('referrals.referPatient')}</Button>
            </div>

            <h3 className="medical-section-divider">{t('encounters.linkedPrescriptions')}</h3>
            {(encounter.prescriptions ?? []).length === 0 ? (
              <p className="encounter-none">{t('encounters.noneLinked')}</p>
            ) : (
              <ul className="encounter-linked-list">
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

            <h3 className="medical-section-divider">{t('encounters.linkedLabs')}</h3>
            {(encounter.lab_orders ?? []).length === 0 ? (
              <p className="encounter-none">{t('encounters.noneLinked')}</p>
            ) : (
              <ul className="encounter-linked-list">
                {(encounter.lab_orders ?? []).map((o) => (
                  <li key={o.id}>{o.order_number} · {t(`status.${o.status}`)}</li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>

      {showRx && <PrescriptionModal encounter={encounter} onClose={() => setShowRx(false)} onSaved={refreshEncounter} />}
      {showLab && <LabOrderModal encounter={encounter} onClose={() => setShowLab(false)} onSaved={refreshEncounter} />}
      {showReferral && <CreateReferralModal encounterId={encounter.id} onClose={() => setShowReferral(false)} />}
    </div>
  )
}
