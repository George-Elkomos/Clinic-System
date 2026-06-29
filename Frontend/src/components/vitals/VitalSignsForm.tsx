import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Button } from '../primitives/Button'
import { FormField } from '../primitives/FormField'
import { useToast } from '../primitives/Toast'
import { errorMessage } from '../../services/apiClient'
import { vitalsApi } from '../../services/vitals.api'
import type { CreateVitalSignsPayload, VitalSigns } from '../../services/types'

interface VitalSignsFormProps {
  patientId: number
  appointmentId?: number | null
  initial?: VitalSigns
  onSuccess?: (created?: VitalSigns) => void
  onCancel?: () => void
}

type FormState = {
  bp_systolic: string
  bp_diastolic: string
  heart_rate: string
  temperature: string
  respiratory_rate: string
  oxygen_saturation: string
  weight: string
  height: string
  blood_glucose: string
  notes: string
}

function fromInitial(v?: VitalSigns): FormState {
  if (!v) return {
    bp_systolic: '', bp_diastolic: '', heart_rate: '', temperature: '',
    respiratory_rate: '', oxygen_saturation: '', weight: '', height: '',
    blood_glucose: '', notes: '',
  }
  return {
    bp_systolic: String(v.bp_systolic),
    bp_diastolic: String(v.bp_diastolic),
    heart_rate: String(v.heart_rate),
    temperature: parseFloat(v.temperature).toFixed(1),
    respiratory_rate: String(v.respiratory_rate),
    oxygen_saturation: String(v.oxygen_saturation),
    weight: parseFloat(v.weight).toFixed(1),
    height: String(v.height),
    blood_glucose: v.blood_glucose != null ? String(v.blood_glucose) : '',
    notes: v.notes,
  }
}

export function VitalSignsForm({ patientId, appointmentId, initial, onSuccess, onCancel }: VitalSignsFormProps) {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const qc = useQueryClient()
  const [form, setForm] = useState<FormState>(() => fromInitial(initial))
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})

  const bmi = useMemo(() => {
    const w = parseFloat(form.weight)
    const h = parseFloat(form.height)
    if (!w || !h || h === 0) return null
    const hm = h / 100
    return (w / (hm * hm)).toFixed(1)
  }, [form.weight, form.height])

  const set = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  function validate(): boolean {
    const errs: Partial<Record<keyof FormState, string>> = {}
    const req: (keyof FormState)[] = ['bp_systolic', 'bp_diastolic', 'heart_rate', 'temperature', 'respiratory_rate', 'oxygen_saturation', 'weight', 'height']
    req.forEach((k) => { if (!form[k].trim()) errs[k] = t('errors.generic') })
    const sys = parseInt(form.bp_systolic)
    const dia = parseInt(form.bp_diastolic)
    if (!isNaN(sys) && !isNaN(dia) && dia >= sys) errs.bp_diastolic = t('vitals.bpDiastolic')
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  function buildPayload(): CreateVitalSignsPayload {
    return {
      patient: patientId,
      appointment: appointmentId ?? null,
      bp_systolic: parseInt(form.bp_systolic),
      bp_diastolic: parseInt(form.bp_diastolic),
      heart_rate: parseInt(form.heart_rate),
      temperature: parseFloat(form.temperature),
      respiratory_rate: parseInt(form.respiratory_rate),
      oxygen_saturation: parseInt(form.oxygen_saturation),
      weight: parseFloat(form.weight),
      height: parseInt(form.height),
      blood_glucose: form.blood_glucose.trim() ? parseInt(form.blood_glucose) : null,
      notes: form.notes,
    }
  }

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['vitals', patientId] })
    qc.invalidateQueries({ queryKey: ['vitals', patientId, 'trend'] })
  }

  const create = useMutation({
    mutationFn: () => vitalsApi.create(buildPayload()),
    onSuccess: (created) => {
      showToast(t('vitals.saved'), 'success')
      setForm(fromInitial())
      setErrors({})
      invalidate()
      onSuccess?.(created)
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const update = useMutation({
    mutationFn: () => vitalsApi.update(initial!.id, buildPayload()),
    onSuccess: (updated) => {
      showToast(t('vitals.saved'), 'success')
      invalidate()
      onSuccess?.(updated)
    },
    onError: (err) => {
      if ((err as { response?: { status?: number } })?.response?.status === 403) {
        showToast(t('vitals.editWindowExpired'), 'error')
      } else {
        showToast(errorMessage(err), 'error')
      }
    },
  })

  const pending = create.isPending || update.isPending

  const handleSubmit = () => {
    if (!validate()) return
    initial ? update.mutate() : create.mutate()
  }

  return (
    <div>
      <div className="vitals-form__row">
        <FormField label={t('vitals.bpSystolic')} error={errors.bp_systolic}>
          {(p) => <input {...p} type="number" value={form.bp_systolic} onChange={set('bp_systolic')} min={60} max={250} />}
        </FormField>
        <FormField label={t('vitals.bpDiastolic')} error={errors.bp_diastolic}>
          {(p) => <input {...p} type="number" value={form.bp_diastolic} onChange={set('bp_diastolic')} min={30} max={150} />}
        </FormField>
      </div>

      <div className="vitals-form__row">
        <FormField label={t('vitals.heartRate')} error={errors.heart_rate}>
          {(p) => <input {...p} type="number" value={form.heart_rate} onChange={set('heart_rate')} min={20} max={300} />}
        </FormField>
        <FormField label={t('vitals.temperature')} error={errors.temperature}>
          {(p) => <input {...p} type="number" step="0.1" value={form.temperature} onChange={set('temperature')} min={30} max={45} />}
        </FormField>
      </div>

      <div className="vitals-form__row">
        <FormField label={t('vitals.respiratoryRate')} error={errors.respiratory_rate}>
          {(p) => <input {...p} type="number" value={form.respiratory_rate} onChange={set('respiratory_rate')} min={5} max={60} />}
        </FormField>
        <FormField label={t('vitals.oxygenSaturation')} error={errors.oxygen_saturation}>
          {(p) => <input {...p} type="number" value={form.oxygen_saturation} onChange={set('oxygen_saturation')} min={70} max={100} />}
        </FormField>
      </div>

      <div className="vitals-form__row">
        <FormField label={t('vitals.weight')} error={errors.weight}>
          {(p) => <input {...p} type="number" step="0.1" value={form.weight} onChange={set('weight')} min={0.5} max={500} />}
        </FormField>
        <FormField label={t('vitals.height')} error={errors.height}>
          {(p) => <input {...p} type="number" value={form.height} onChange={set('height')} min={20} max={300} />}
        </FormField>
      </div>

      <div className="vitals-form__bmi">
        <span className="vitals-form__bmi-label">{t('vitals.bmi')}:</span>
        <span className="vitals-form__bmi-value">{bmi ?? '—'}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-small)' }}>({t('vitals.bmiAuto')})</span>
      </div>

      <FormField label={t('vitals.bloodGlucoseOptional')} error={errors.blood_glucose}>
        {(p) => <input {...p} type="number" value={form.blood_glucose} onChange={set('blood_glucose')} min={20} max={600} />}
      </FormField>

      <FormField label={t('vitals.notes')}>
        {(p) => <textarea {...p} rows={2} value={form.notes} onChange={set('notes')} placeholder={t('vitals.notesPlaceholder')} />}
      </FormField>

      {Object.keys(errors).length > 0 && (
        <div role="alert" style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          marginTop: 'var(--space-3)',
          padding: 'var(--space-3) var(--space-4)',
          background: 'color-mix(in srgb, var(--danger) 8%, var(--bg))',
          border: '1px solid var(--danger)',
          borderRadius: 'var(--radius)',
          color: 'var(--danger)', fontSize: 'var(--font-small)',
        }}>
          <span aria-hidden="true">⚠</span>
          {t('vitals.formErrors')}
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end', marginTop: 'var(--space-4)' }}>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} disabled={pending}>
            {t('common.cancel')}
          </Button>
        )}
        <Button loading={pending} onClick={handleSubmit}>
          {t('common.save')}
        </Button>
      </div>
    </div>
  )
}
