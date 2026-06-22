import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AIScribePanel } from '../../components/ai/AIScribePanel'
import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Button } from '../../components/primitives/Button'
import { Card } from '../../components/primitives/Card'
import { FormField } from '../../components/primitives/FormField'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { VitalSignsForm } from '../../components/vitals/VitalSignsForm'
import { VitalSignsHistory } from '../../components/vitals/VitalSignsHistory'
import { VitalSignsTrendChart } from '../../components/vitals/VitalSignsTrendChart'
import { useLanguage } from '../../hooks/useLanguage'
import { openBlob, saveBlob } from '../../lib/download'
import { formatDate } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { authApi } from '../../services/auth.api'
import { medicalApi } from '../../services/medical.api'
import { vitalsApi } from '../../services/vitals.api'
import type { PrescriptionItem } from '../../services/types'

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
  drug_name: '', dosage: '', frequency: '', duration: '', instructions: '',
  _key: crypto.randomUUID(),
})

function PrescriptionsSection({ patientId }: { patientId: number }) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { showToast } = useToast()
  const qc = useQueryClient()
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<RxItem[]>([newRxItem()])

  const { data: prescriptions = [] } = useQuery({
    queryKey: ['prescriptions', patientId],
    queryFn: () => medicalApi.prescriptions(patientId),
  })

  const issue = useMutation({
    mutationFn: () => medicalApi.createPrescription({
      patient: patientId,
      notes,
      // Strip the client-only _key before sending to the API.
      items: items.filter((i) => i.drug_name).map(({ _key: _, ...rest }) => rest),
    }),
    onSuccess: () => {
      showToast(t('medical.prescriptionIssued'), 'success')
      setNotes(''); setItems([newRxItem()])
      qc.invalidateQueries({ queryKey: ['prescriptions', patientId] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const openPdf = async (id: number) => {
    try { openBlob(await medicalApi.prescriptionPdf(id)) } catch (err) { showToast(errorMessage(err), 'error') }
  }

  const setItem = (idx: number, key: keyof PrescriptionItem, value: string) =>
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, [key]: value } : it)))

  return (
    <Card title={t('medical.prescriptions')}>
      {prescriptions.length === 0 ? <p>{t('medical.noPrescriptions')}</p> : prescriptions.map((p) => (
        <div key={p.id} className="medical-prescription-row">
          <div>
            <strong>{t('medical.issuedOn', { date: formatDate(p.issued_date, language) })}</strong>
            <div className="medical-list-meta">{p.items.map((i) => i.drug_name).join(', ')}</div>
          </div>
          <Button variant="secondary" onClick={() => openPdf(p.id)}>{t('medical.openPdf')}</Button>
        </div>
      ))}

      <h3 className="medical-section-divider">{t('medical.newPrescription')}</h3>
      {items.map((it, idx) => (
        <div key={it._key} className="medical-rx-item">
          <div className="medical-rx-field--wide"><FormField label={t('medical.medication')}>{(p) => <input {...p} value={it.drug_name} onChange={(e) => setItem(idx, 'drug_name', e.target.value)} />}</FormField></div>
          <div className="medical-rx-field"><FormField label={t('medical.dosage')}>{(p) => <input {...p} value={it.dosage} onChange={(e) => setItem(idx, 'dosage', e.target.value)} />}</FormField></div>
          <div className="medical-rx-field--mid"><FormField label={t('medical.frequency')}>{(p) => <input {...p} value={it.frequency} onChange={(e) => setItem(idx, 'frequency', e.target.value)} />}</FormField></div>
          <div className="medical-rx-field"><FormField label={t('medical.duration')}>{(p) => <input {...p} value={it.duration} onChange={(e) => setItem(idx, 'duration', e.target.value)} />}</FormField></div>
          {items.length > 1 && <Button variant="secondary" onClick={() => setItems((arr) => arr.filter((i) => i._key !== it._key))}>{t('medical.removeItem')}</Button>}
        </div>
      ))}
      <Button variant="secondary" onClick={() => setItems((arr) => [...arr, newRxItem()])} className="medical-add-item-btn">{t('medical.addItem')}</Button>
      <FormField label={t('medical.instructions')}>
        {(p) => <textarea {...p} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </FormField>
      <Button loading={issue.isPending} disabled={!items.some((i) => i.drug_name)} onClick={() => issue.mutate()} className="medical-form-submit">{t('medical.issuePrescription')}</Button>
    </Card>
  )
}

// ---- Scans / Labs ----------------------------------------------------------
function ScansLabsSection({ patientId }: { patientId: number }) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { showToast } = useToast()
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

  const download = async (id: number, name: string) => {
    try { saveBlob(await medicalApi.downloadScan(id), name || `scan-${id}`) } catch (err) { showToast(errorMessage(err), 'error') }
  }

  return (
    <Card title={`${t('medical.scans')} / ${t('medical.labs')}`}>
      {scans.map((s) => (
        <div key={s.id} className="medical-scan-row">
          <span><strong>{s.category}</strong> · {s.original_filename} · {formatDate(s.created_at, language)}</span>
          <Button variant="secondary" onClick={() => download(s.id, s.original_filename)}>{t('medical.download')}</Button>
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
          <NotesSection patientId={patientId} categories={categories} />
          <PrescriptionsSection patientId={patientId} />
          <ScansLabsSection patientId={patientId} />
        </>
      )}
    </div>
  )
}
