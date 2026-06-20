import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Button } from '../../components/primitives/Button'
import { Card } from '../../components/primitives/Card'
import { FormField } from '../../components/primitives/FormField'
import { Select } from '../../components/primitives/Select'
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
    <div>
      <Breadcrumbs trail={[{ label: t('lab.title'), to: '/doctor/lab-orders' }, { label: t('lab.newOrder') }]} />
      <h1>{t('lab.newOrder')}</h1>

      <Card>
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
              rows={2}
              value={clinicalNotes}
              onChange={(e) => setClinicalNotes(e.target.value)}
              placeholder={t('lab.clinicalNotesPlaceholder')}
            />
          )}
        </FormField>

        <h3 style={{ marginBottom: 'var(--space-3)' }}>{t('lab.tests')}</h3>
        {items.map((item, idx) => (
          <div key={item._key} className="lab-item-row">
            <div className="lab-item-row__name">
              <FormField label={t('lab.testName')}>
                {(p) => <input {...p} value={item.test_name} onChange={(e) => setItem(idx, 'test_name', e.target.value)} />}
              </FormField>
            </div>
            <div className="lab-item-row__code">
              <FormField label={t('lab.testCode')}>
                {(p) => <input {...p} value={item.test_code} onChange={(e) => setItem(idx, 'test_code', e.target.value)} />}
              </FormField>
            </div>
            <div className="lab-item-row__notes">
              <FormField label={t('lab.testNotes')}>
                {(p) => <input {...p} value={item.notes} onChange={(e) => setItem(idx, 'notes', e.target.value)} />}
              </FormField>
            </div>
            {items.length > 1 && (
              <Button variant="secondary" onClick={() => setItems((arr) => arr.filter((it) => it._key !== item._key))}>
                {t('lab.removeTest')}
              </Button>
            )}
          </div>
        ))}
        <Button variant="secondary" onClick={() => setItems((arr) => [...arr, EMPTY_ITEM()])} style={{ marginBottom: 'var(--space-4)' }}>
          {t('lab.addTest')}
        </Button>

        <div className="lab-form-actions">
          <Button variant="secondary" loading={create.isPending} disabled={!canSubmit || pending} onClick={() => create.mutate()}>
            {t('lab.saveAsDraft')}
          </Button>
          <Button loading={createAndSubmit.isPending} disabled={!canSubmit || pending} onClick={() => createAndSubmit.mutate()}>
            {t('lab.submitOrder')}
          </Button>
        </div>
      </Card>
    </div>
  )
}
