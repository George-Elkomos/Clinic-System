import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { MedicationItemRow } from '../../components/medical/MedicationItemRow'
import { useAuth } from '../../hooks/useAuth'
import { useInteractionCheck } from '../../hooks/useInteractionCheck'

import { AIScribePanel } from '../../components/ai/AIScribePanel'
import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Button } from '../../components/primitives/Button'
import { Card } from '../../components/primitives/Card'
import { useConfirm } from '../../components/primitives/ConfirmDialog'
import { FormField } from '../../components/primitives/FormField'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner } from '../../components/primitives/Spinner'
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
import type { Diagnosis, Prescription, PrescriptionItem } from '../../services/types'

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
    <Card title={t('vitals.title')}>
      {trend.length >= 2 && <VitalSignsTrendChart data={trend} />}

      {showForm ? (
        <>
          <h3 className="medical-section-divider">{t('vitals.record')}</h3>
          <VitalSignsForm patientId={patientId} onSuccess={() => setShowForm(false)} />
        </>
      ) : (
        <div style={{ marginBottom: 'var(--space-3)', textAlign: 'right' }}>
          <Button variant="secondary" onClick={() => setShowForm(true)}>{t('vitals.record')}</Button>
        </div>
      )}

      <h3 className="medical-section-divider">{t('vitals.history')}</h3>
      <VitalSignsHistory patientId={patientId} />
    </Card>
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
    <Card title={t('medical.records')}>
      {records.length === 0 ? <p>{t('medical.noRecords')}</p> : records.map((r) => (
        <div key={r.id} className="medical-version-row">
          <div className="medical-version-header">
            <strong className="medical-version-label">{t('medical.version', { n: r.version })}</strong>
            {r.is_current && <span className="badge badge--active">{t('medical.current')}</span>}
            <span className="medical-version-date">{formatDate(r.created_at, language)}</span>
          </div>
          {r.diagnosis && <div className="medical-version-detail">{t('medical.diagnosis')}: {r.diagnosis}</div>}
          {r.treatment_plan && <div className="medical-version-detail">{t('medical.treatmentPlan')}: {r.treatment_plan}</div>}
        </div>
      ))}
      <h3 className="medical-section-divider">{t('medical.addRecord')}</h3>
      <FormField label={t('medical.chiefComplaint')}>
        {(p) => <input {...p} value={form.chief_complaint} onChange={(e) => setForm((f) => ({ ...f, chief_complaint: e.target.value }))} />}
      </FormField>
      <FormField label={t('medical.diagnosis')}>
        {(p) => <textarea {...p} rows={2} value={form.diagnosis} onChange={(e) => setForm((f) => ({ ...f, diagnosis: e.target.value }))} />}
      </FormField>
      <FormField label={t('medical.treatmentPlan')}>
        {(p) => <textarea {...p} rows={2} value={form.treatment_plan} onChange={(e) => setForm((f) => ({ ...f, treatment_plan: e.target.value }))} />}
      </FormField>
      <Button loading={add.isPending} onClick={() => add.mutate()} className="medical-form-submit">{t('medical.addRecord')}</Button>
    </Card>
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
    <Card title={t('medical.notes')}>
      {notes.length === 0 ? <p>{t('medical.noNotes')}</p> : notes.map((n) => (
        <div key={n.id} className="medical-note-row">
          <div className="medical-note-meta">{n.specialty_category_name} · {n.doctor_name} · {formatDate(n.created_at, language)}</div>
          <div>{n.body}</div>
        </div>
      ))}
      <h3 className="medical-section-divider">{t('medical.addNote')}</h3>
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
        {(p) => <textarea {...p} rows={3} value={body} onChange={(e) => setBody(e.target.value)} />}
      </FormField>
      <Button loading={add.isPending} disabled={!category || !body} onClick={() => add.mutate()} className="medical-form-submit">{t('medical.addNote')}</Button>
    </Card>
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
    <Card title={t('medical.prescriptions')}>
      {prescriptions.length === 0 ? <p>{t('medical.noPrescriptions')}</p> : prescriptions.map((p) => {
        const isCancelled = p.status === 'CANCELLED'
        const isVoiding = voidingId === p.id
        const canVoid = p.status === 'ACTIVE' && (
          user?.role === 'MANAGER' ||
          (user?.doctor_profile?.id != null && p.doctor === user.doctor_profile.id)
        )

        return (
          <div key={p.id} className={`medical-prescription-row${isCancelled ? ' encounter-rx-item--voided' : ''}`}>
            <div style={{ flex: 1 }}>
              <div className="encounter-rx-item__row">
                <strong>{t('medical.issuedOn', { date: formatDate(p.issued_date, language) })}</strong>
                {isCancelled && <span className="badge badge--CANCELLED">{t('medical.voidedBadge')}</span>}
              </div>
              <div className={`medical-list-meta${isCancelled ? ' rx-items--voided' : ''}`}>
                {p.items.map((i) => i.drug_name).join(', ')}
              </div>
              {isCancelled && p.cancelled_at && (
                <div className="rx-voided-banner">
                  <span className="rx-voided-meta">
                    {t('medical.voidedOn', { date: formatDate(p.cancelled_at, language) })}
                    {p.cancelled_by_name && ` · ${t('medical.voidedBy', { name: p.cancelled_by_name })}`}
                  </span>
                  {p.cancellation_reason && (
                    <span className="rx-voided-reason">{t('medical.voidReason', { reason: p.cancellation_reason })}</span>
                  )}
                </div>
              )}
              {isVoiding && (
                <div className="encounter-rx-void-form">
                  <textarea
                    className="encounter-rx-void-reason"
                    rows={2}
                    placeholder={t('medical.voidReasonPlaceholder')}
                    value={voidReason}
                    onChange={(e) => setVoidReason(e.target.value)}
                  />
                  <div className="encounter-rx-void-actions">
                    <Button
                      variant="danger"
                      loading={cancelRx.isPending}
                      disabled={voidReason.trim().length < 5}
                      onClick={() => cancelRx.mutate(p.id)}
                    >
                      {t('medical.voidConfirmBtn')}
                    </Button>
                    <Button variant="secondary" onClick={() => { setVoidingId(null); setVoidReason('') }}>
                      {t('common.cancel')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0, alignItems: 'flex-start' }}>
              {!isCancelled && (
                <Button variant="secondary" onClick={() => openPdf(p.id)}>{t('medical.openPdf')}</Button>
              )}
              {canVoid && !isVoiding && (
                <>
                  <button
                    className="encounter-rx-void-btn"
                    title={t('medical.reissuePrescription')}
                    onClick={() => handleReissue(p)}
                    disabled={reissueMut.isPending}
                  >✏️</button>
                  <button
                    className="encounter-rx-void-btn"
                    title={t('medical.voidPrescription')}
                    onClick={() => { setVoidingId(p.id); setVoidReason('') }}
                  >🚫</button>
                </>
              )}
              {isVoiding && (
                <button
                  className="encounter-rx-void-btn"
                  title={t('common.cancel')}
                  onClick={() => { setVoidingId(null); setVoidReason('') }}
                >✕</button>
              )}
            </div>
          </div>
        )
      })}

      <h3 ref={newRxRef} className="medical-section-divider">{t('medical.newPrescription')}</h3>
      {items.map((it, idx) => (
        <MedicationItemRow
          key={it._key}
          item={it}
          onChange={(patch) => patchItem(idx, patch)}
          onRemove={() => setItems((arr) => arr.filter((i) => i._key !== it._key))}
          canRemove={items.length > 1}
        />
      ))}
      <Button variant="secondary" onClick={() => setItems((arr) => [...arr, newRxItem()])} className="medical-add-item-btn">{t('medical.addItem')}</Button>
      <FormField label={t('medical.instructions')}>
        {(p) => <textarea {...p} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </FormField>
      <Button loading={issue.isPending || checking} disabled={!items.some(hasContent)} onClick={handleIssue} className="medical-form-submit">{t('medical.issuePrescription')}</Button>
      {modal}
    </Card>
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
    <Card title={`${t('medical.scans')} / ${t('medical.labs')}`}>
      {scans.map((s) => (
        <div key={s.id} className="medical-scan-row">
          <span><strong>{s.category}</strong> · {s.original_filename} · {formatDate(s.created_at, language)}</span>
          <div className="medical-scan-actions">
            <Button variant="secondary" onClick={() => download(s.id, s.original_filename)}>{t('medical.download')}</Button>
            <Button variant="danger" onClick={() => handleDelete(s.id, s.original_filename)}>🗑 {t('medical.delete')}</Button>
          </div>
        </div>
      ))}
      {labs.map((l) => (
        <div key={`l${l.id}`} className="medical-lab-row">
          <strong>{l.test_name}</strong>: {l.result_value} {l.unit}
        </div>
      ))}
      <h3 className="medical-section-divider">{t('medical.uploadScan')}</h3>
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
          <div className="file-input-wrap">
            <input {...p} type="file" accept=".jpg,.jpeg,.png,.pdf,.dcm,.dicom" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
        )}
      </FormField>
      <Button loading={upload.isPending} disabled={!file} onClick={() => upload.mutate()} className="medical-form-submit medical-upload-submit">{t('medical.uploadScan')}</Button>
    </Card>
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
    <Card title={t('medical.chronicDiagnoses')}>
      {chronic.length === 0 ? (
        <p>{t('medical.noChronicDiagnoses')}</p>
      ) : (
        <ul className="chronic-dx-list">
          {chronic.map(({ d, count }) => (
            <li key={d.id} dir="auto">
              <strong>{language === 'ar' && d.name_ar ? d.name_ar : d.name}</strong>
              {d.icd10_code && <span className="medical-list-meta"> ({d.icd10_code})</span>}
              {' — '}
              {t('medical.encounterCount', { count })}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

// ---- Page ------------------------------------------------------------------
export function PatientRecordPage() {
  const { t } = useTranslation()
  const [patientId, setPatientId] = useState<number | ''>('')

  const { data: patients, isLoading } = useQuery({ queryKey: ['my-patients'], queryFn: medicalApi.myPatients })
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: authApi.me })

  const categories = useMemo(() => {
    const map = new Map<number, string>()
    me?.doctor_profile?.specialties_detail.forEach((s) => map.set(s.category, s.category_name))
    return Array.from(map, ([id, name]) => ({ id, name }))
  }, [me])

  if (isLoading) return <CenteredSpinner />

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('nav.patients') }]} />
      <h1>{t('nav.patients')}</h1>

      {(patients ?? []).length === 0 ? (
        <Card><p>{t('medical.noPatients')}</p></Card>
      ) : (
        <Card>
          <FormField label={t('medical.selectPatient')}>
            {(p) => (
              <Select
                id={p.id}
                options={(patients ?? []).map((pt) => ({ value: pt.id, label: pt.full_name || pt.email || String(pt.id) }))}
                value={patientId}
                onChange={(v) => setPatientId(Array.isArray(v) || v === '' ? '' : Number(v))}
                placeholder="—"
                searchable
              />
            )}
          </FormField>
        </Card>
      )}

      {patientId !== '' && (
        <>
          <AIScribePanel patientId={patientId} />
          <VitalsSection patientId={patientId} />
          <RecordsSection patientId={patientId} />
          <ChronicDiagnosesSection patientId={patientId} />
          <NotesSection patientId={patientId} categories={categories} />
          <PrescriptionsSection patientId={patientId} />
          <ScansLabsSection patientId={patientId} />
          <Card title={t('timeline.title')}>
            <PatientTimeline patientId={patientId} />
          </Card>
        </>
      )}
    </div>
  )
}
