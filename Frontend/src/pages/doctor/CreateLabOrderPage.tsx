import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { FormField } from '../../components/primitives/FormField'
import { Select } from '../../components/primitives/Select'
import { Spinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { errorMessage } from '../../services/apiClient'
import { labOrdersApi } from '../../services/labOrders.api'
import { medicalApi } from '../../services/medical.api'
import type { CreateLabOrderPayload, LabOrderItem, LabOrderPriority } from '../../services/types'

// ARCH-4: each form row carries a stable client-side key so React doesn't
// reuse DOM nodes when rows are inserted or removed mid-list.
type OrderFormItem = Omit<LabOrderItem, 'id'> & { _key: string }
const EMPTY_ITEM = (): OrderFormItem => ({ test_name: '', test_code: '', notes: '', _key: crypto.randomUUID() })
const PRIORITIES: LabOrderPriority[] = ['ROUTINE', 'URGENT', 'STAT']

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all disabled:opacity-60 sm:text-sm'
const BTN_SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-60 sm:text-sm'

export function CreateLabOrderPage() {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [patient, setPatient] = useState<number | ''>('')
  const [priority, setPriority] = useState<LabOrderPriority>('ROUTINE')
  const [clinicalNotes, setClinicalNotes] = useState('')
  const [items, setItems] = useState<OrderFormItem[]>([EMPTY_ITEM()])

  const { data: patients = [] } = useQuery({
    queryKey: ['my-patients'],
    queryFn: medicalApi.myPatients,
  })

  const setItem = (idx: number, key: keyof Omit<LabOrderItem, 'id'>, value: string) =>
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, [key]: value } : it)))

  function buildPayload(): CreateLabOrderPayload {
    return {
      patient: patient as number,
      priority,
      clinical_notes: clinicalNotes,
      // Strip the client-only _key before sending to the API.
      items: items.filter((it) => it.test_name.trim()).map(({ _key: _, ...rest }) => rest),
    }
  }

  const create = useMutation({
    mutationFn: () => labOrdersApi.create(buildPayload()),
    onSuccess: (order) => {
      qc.invalidateQueries({ queryKey: ['lab-orders'] })
      showToast(t('lab.saveDraft'), 'success')
      navigate(`/doctor/lab-orders/${order.id}`)
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const createAndSubmit = useMutation({
    mutationFn: async () => {
      const order = await labOrdersApi.create(buildPayload())
      return labOrdersApi.submit(order.id)
    },
    onSuccess: (order) => {
      qc.invalidateQueries({ queryKey: ['lab-orders'] })
      showToast(t('lab.submitted'), 'success')
      navigate(`/doctor/lab-orders/${order.id}`)
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const pending = create.isPending || createAndSubmit.isPending
  const canSubmit = patient !== '' && items.some((it) => it.test_name.trim())

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[{ label: t('lab.title'), to: '/doctor/lab-orders' }, { label: t('lab.newOrder') }]} />
        <h1 className="patient-text-page-title" style={{ color: 'var(--text-primary)' }}>{t('lab.newOrder')}</h1>
      </div>

      <div className={CARD}>
        <FormField label={t('lab.patient')}>
          {(p) => (
            <Select
              id={p.id}
              options={patients.map((pt) => ({ value: pt.id, label: pt.full_name || pt.email || String(pt.id) }))}
              value={patient}
              onChange={(v) => setPatient(Array.isArray(v) || v === '' ? '' : Number(v))}
              searchable
              placeholder="—"
            />
          )}
        </FormField>

        <FormField label={t('lab.priority')}>
          {(p) => (
            <Select
              id={p.id}
              options={PRIORITIES.map((pr) => ({ value: pr, label: t(`status.${pr}`) }))}
              value={priority}
              onChange={(v) => setPriority(Array.isArray(v) ? 'ROUTINE' : v as LabOrderPriority)}
            />
          )}
        </FormField>

        <FormField label={t('lab.clinicalNotes')}>
          {(p) => (
            <textarea
              {...p}
              className="patient-field"
              rows={2}
              value={clinicalNotes}
              onChange={(e) => setClinicalNotes(e.target.value)}
              placeholder={t('lab.clinicalNotesPlaceholder')}
            />
          )}
        </FormField>

        <h3 className="patient-text-card-title mb-3 mt-4" style={{ color: 'var(--text-primary)' }}>{t('lab.tests')}</h3>
        <div className="flex flex-col gap-3">
          {items.map((item, idx) => (
            <div key={item._key} className="flex flex-col gap-3 rounded-xl border border-slate-100 bg-slate-50/40 p-4 sm:flex-row sm:items-end">
              <div className="flex-1">
                <FormField label={t('lab.testName')}>
                  {(p) => <input {...p} className="patient-field" value={item.test_name} onChange={(e) => setItem(idx, 'test_name', e.target.value)} />}
                </FormField>
              </div>
              <div className="flex-1">
                <FormField label={t('lab.testCode')}>
                  {(p) => <input {...p} className="patient-field" value={item.test_code} onChange={(e) => setItem(idx, 'test_code', e.target.value)} />}
                </FormField>
              </div>
              <div className="flex-1">
                <FormField label={t('lab.testNotes')}>
                  {(p) => <input {...p} className="patient-field" value={item.notes} onChange={(e) => setItem(idx, 'notes', e.target.value)} />}
                </FormField>
              </div>
              {items.length > 1 && (
                <button type="button" onClick={() => setItems((arr) => arr.filter((it) => it._key !== item._key))} className={BTN_SECONDARY}>
                  {t('lab.removeTest')}
                </button>
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setItems((arr) => [...arr, EMPTY_ITEM()])} className={`${BTN_SECONDARY} mt-3`}>
          {t('lab.addTest')}
        </button>

        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" disabled={!canSubmit || pending} onClick={() => create.mutate()} className={BTN_SECONDARY}>
            {create.isPending && <Spinner size={14} />}{t('lab.saveAsDraft')}
          </button>
          <button type="button" disabled={!canSubmit || pending} onClick={() => createAndSubmit.mutate()} className={BTN_PRIMARY}>
            {createAndSubmit.isPending && <Spinner size={14} />}{t('lab.submitOrder')}
          </button>
        </div>
      </div>
    </div>
  )
}
