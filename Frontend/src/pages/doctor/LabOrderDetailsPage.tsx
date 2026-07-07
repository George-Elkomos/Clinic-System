import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Button } from '../../components/primitives/Button'
import { Card } from '../../components/primitives/Card'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { StatusBadge } from '../../components/primitives/StatusBadge'
import { useConfirm } from '../../components/primitives/ConfirmDialog'
import { useToast } from '../../components/primitives/Toast'
import { FormField } from '../../components/primitives/FormField'
import { LabStatusTimeline } from '../../components/lab/LabStatusTimeline'
import { useAuth } from '../../hooks/useAuth'
import { useLanguage } from '../../hooks/useLanguage'
import { saveBlob } from '../../lib/download'
import { formatDate } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { labOrdersApi } from '../../services/labOrders.api'
import type { CreateLabOrderResultPayload, LabOrderResult } from '../../services/types'

// ARCH-4: result entry rows carry a stable client-side key so React doesn't
// misidentify rows when items are added or removed mid-list.
type ResultEntry = CreateLabOrderResultPayload & { _key: string }
const newResultEntry = (): ResultEntry => ({
  test_name: '', result_value: '', unit: '', reference_range: '',
  is_abnormal: false, is_critical: false,
  result_date: new Date().toISOString().slice(0, 10),
  interpretation: '',
  _key: crypto.randomUUID(),
})

type EntryErrors = { test_name?: string; result_value?: string; result_date?: string }

function ResultEntryRow({
  index,
  value,
  onChange,
  errors,
}: {
  index: number
  value: CreateLabOrderResultPayload
  onChange: (v: CreateLabOrderResultPayload) => void
  errors?: EntryErrors
}) {
  const { t } = useTranslation()
  const set = (key: keyof CreateLabOrderResultPayload, val: string | boolean | File | null) =>
    onChange({ ...value, [key]: val })

  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
      <strong style={{ fontSize: 'var(--font-small)', color: 'var(--text-muted)' }}>#{index + 1}</strong>
      <div className="lab-item-row" style={{ marginTop: 'var(--space-2)' }}>
        <div className="lab-item-row__name">
          <FormField label={t('lab.testName')} error={errors?.test_name}>
            {(p) => <input {...p} value={value.test_name} onChange={(e) => set('test_name', e.target.value)} />}
          </FormField>
        </div>
        <div className="lab-item-row__code">
          <FormField label={t('lab.resultValue')} error={errors?.result_value}>
            {(p) => <input {...p} value={value.result_value} onChange={(e) => set('result_value', e.target.value)} />}
          </FormField>
        </div>
        <div className="lab-item-row__code">
          <FormField label={t('lab.unit')}>
            {(p) => <input {...p} value={value.unit ?? ''} onChange={(e) => set('unit', e.target.value)} />}
          </FormField>
        </div>
        <div className="lab-item-row__name">
          <FormField label={t('lab.referenceRange')}>
            {(p) => <input {...p} value={value.reference_range ?? ''} onChange={(e) => set('reference_range', e.target.value)} />}
          </FormField>
        </div>
        <div className="lab-item-row__code">
          <FormField label={t('lab.resultDate')} error={errors?.result_date}>
            {(p) => <input {...p} type="date" value={value.result_date} onChange={(e) => set('result_date', e.target.value)} />}
          </FormField>
        </div>
      </div>
      <div className="lab-flags-row">
        <label className="lab-flag-check">
          <input type="checkbox" checked={value.is_abnormal} onChange={(e) => set('is_abnormal', e.target.checked)} />
          {t('lab.isAbnormal')}
        </label>
        <label className="lab-flag-check">
          <input type="checkbox" checked={value.is_critical} onChange={(e) => set('is_critical', e.target.checked)} />
          {t('lab.isCritical')}
        </label>
      </div>
      <FormField label={t('lab.resultFile')}>
        {(p) => (
          <input {...p} type="file" onChange={(e) => set('file', e.target.files?.[0] ?? null)} />
        )}
      </FormField>
    </div>
  )
}

export function LabOrderDetailsPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { user } = useAuth()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()

  const [resultEntries, setResultEntries] = useState<ResultEntry[]>([])
  const [showResultForm, setShowResultForm] = useState(false)
  const [resultErrors, setResultErrors] = useState<Record<string, EntryErrors>>({})

  const { data: order, isLoading } = useQuery({
    queryKey: ['lab-orders', Number(id)],
    queryFn: () => labOrdersApi.get(Number(id)),
    enabled: !!id,
    staleTime: 15_000,
    retry: 1,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['lab-orders'] })

  const submitMut = useMutation({
    mutationFn: () => labOrdersApi.submit(Number(id)),
    onSuccess: () => { showToast(t('lab.submitted'), 'success'); invalidate() },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const processMut = useMutation({
    mutationFn: () => labOrdersApi.startProcessing(Number(id)),
    onSuccess: () => { showToast(t('lab.processingStarted'), 'success'); invalidate() },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const enterResultsMut = useMutation({
    mutationFn: () => labOrdersApi.enterResults(
      Number(id),
      resultEntries.map(({ _key: _, ...rest }) => rest),
    ),
    onSuccess: () => {
      showToast(t('lab.resultsSaved'), 'success')
      setShowResultForm(false)
      setResultEntries([])
      setResultErrors({})
      invalidate()
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const validateEntries = (): boolean => {
    const errs: Record<string, EntryErrors> = {}
    resultEntries.forEach((entry) => {
      const row: EntryErrors = {}
      if (!entry.test_name.trim()) row.test_name = t('errors.required')
      if (!entry.result_value.trim()) row.result_value = t('errors.required')
      if (!entry.result_date.trim()) row.result_date = t('errors.required')
      if (Object.keys(row).length > 0) errs[entry._key] = row
    })
    setResultErrors(errs)
    return Object.keys(errs).length === 0
  }

  const reviewMut = useMutation({
    mutationFn: () => labOrdersApi.review(Number(id)),
    onSuccess: () => { showToast(t('lab.reviewed'), 'success'); invalidate() },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const deleteMut = useMutation({
    mutationFn: () => labOrdersApi.delete(Number(id)),
    onSuccess: () => {
      showToast(t('lab.deleted'), 'success')
      invalidate()
      navigate(user?.role === 'DOCTOR' ? '/doctor/lab-orders' : '/secretary/lab')
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const handleDelete = async () => {
    const ok = await confirm({ title: t('lab.deleteConfirmTitle'), message: t('lab.deleteConfirmMessage'), danger: true })
    if (ok) deleteMut.mutate()
  }

  const download = async (result: LabOrderResult) => {
    try {
      const blob = await labOrdersApi.downloadResultFile(Number(id), result.id)
      saveBlob(blob, result.file?.split('/').pop() ?? `result-${result.id}`)
    } catch (err) {
      showToast(errorMessage(err), 'error')
    }
  }

  if (isLoading || !order) return <CenteredSpinner />

  const role = user?.role
  // order.doctor is the DoctorProfile PK (FK on the model), not the User PK.
  // user.doctor_profile.id is the DoctorProfile PK — the only correct comparand.
  const isOrderingDoctor = role === 'DOCTOR' &&
    !!user?.doctor_profile?.id &&
    Number(order.doctor) === Number(user.doctor_profile.id)
  const isManager = role === 'MANAGER'
  const isSecretary = role === 'SECRETARY'

  const backPath = role === 'DOCTOR' ? '/doctor/lab-orders'
    : role === 'SECRETARY' ? '/secretary/lab'
    : '/secretary/lab'

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('lab.title'), to: backPath }, { label: order.order_number }]} />
      <h1>{order.order_number}</h1>

      <Card>
        <LabStatusTimeline status={order.status} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
          <div><span style={{ color: 'var(--text-muted)' }}>{t('lab.patient')}: </span><strong>{order.patient_name}</strong></div>
          <div><span style={{ color: 'var(--text-muted)' }}>{t('lab.doctor')}: </span><strong>{order.doctor_name}</strong></div>
          <div><span style={{ color: 'var(--text-muted)' }}>{t('lab.priority')}: </span><StatusBadge status={order.priority} ns="status" /></div>
          <div><span style={{ color: 'var(--text-muted)' }}>{t('appointments.when')}: </span>{formatDate(order.created_at, language)}</div>
        </div>
        {order.clinical_notes && <p style={{ marginBottom: 'var(--space-4)' }}>{order.clinical_notes}</p>}
        {order.has_critical && (
          <div className="badge badge--STAT" style={{ marginBottom: 'var(--space-3)', display: 'inline-block' }}>
            ⚠ {t('lab.hasCritical')}
          </div>
        )}

        {/* Test items */}
        <h3>{t('lab.tests')}</h3>
        {order.items.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>—</p>
        ) : (
          <ul style={{ paddingInlineStart: 'var(--space-5)', marginBottom: 'var(--space-4)' }}>
            {order.items.map((item) => (
              <li key={item.id}><strong>{item.test_name}</strong>{item.test_code && ` (${item.test_code})`}{item.notes && ` — ${item.notes}`}</li>
            ))}
          </ul>
        )}

        {/* Results table */}
        {order.results.length > 0 && (
          <>
            <h3>{t('lab.results')}</h3>
            <div style={{ overflowX: 'auto', marginBottom: 'var(--space-4)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-body)' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)' }}>
                    {[t('lab.testName'), t('lab.resultValue'), t('lab.unit'), t('lab.referenceRange'), t('lab.resultDate'), ''].map((h) => (
                      <th key={h || 'actions'} style={{ textAlign: 'left', padding: 'var(--space-2) var(--space-3)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {order.results.map((r) => (
                    <tr
                      key={r.id}
                      className={r.is_critical ? 'lab-result-row--critical' : r.is_abnormal ? 'lab-result-row--abnormal' : ''}
                      style={{ borderBottom: '1px solid var(--border)' }}
                    >
                      <td style={{ padding: 'var(--space-2) var(--space-3)' }}>{r.test_name}</td>
                      <td style={{ padding: 'var(--space-2) var(--space-3)', fontWeight: 600 }}>{r.result_value}</td>
                      <td style={{ padding: 'var(--space-2) var(--space-3)' }}>{r.unit}</td>
                      <td style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--text-muted)' }}>{r.reference_range}</td>
                      <td style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--text-muted)' }}>{formatDate(r.result_date, language)}</td>
                      <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                        {r.file && (
                          <Button variant="secondary" onClick={() => download(r)} style={{ padding: 'var(--space-1) var(--space-3)', minHeight: 'unset' }}>
                            {t('lab.download')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Result entry form */}
        {(isSecretary || isManager) && order.status === 'PROCESSING' && (
          <>
            {showResultForm ? (
              <>
                <h3>{t('lab.enterResults')}</h3>
                {Object.keys(resultErrors).length > 0 && (
                  <div role="alert" style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                    marginBottom: 'var(--space-4)',
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
                {resultEntries.length === 0 && (
                  <Button variant="secondary" onClick={() => setResultEntries([newResultEntry()])}>
                    {t('lab.addTest')}
                  </Button>
                )}
                {resultEntries.map((entry, idx) => (
                  <ResultEntryRow
                    key={entry._key}
                    index={idx}
                    value={entry}
                    errors={resultErrors[entry._key]}
                    onChange={(v) => {
                      setResultEntries((arr) =>
                        arr.map((e) => e._key === entry._key ? { ...v, _key: entry._key } : e)
                      )
                      if (resultErrors[entry._key]) {
                        setResultErrors((prev) => {
                          const next = { ...prev }
                          delete next[entry._key]
                          return next
                        })
                      }
                    }}
                  />
                ))}
                {resultEntries.length > 0 && (
                  <div className="lab-form-actions">
                    <Button variant="secondary" onClick={() => setResultEntries((arr) => [...arr, newResultEntry()])}>
                      {t('lab.addTest')}
                    </Button>
                    <Button variant="secondary" onClick={() => { setShowResultForm(false); setResultEntries([]); setResultErrors({}) }}>
                      {t('common.cancel')}
                    </Button>
                    <Button loading={enterResultsMut.isPending} onClick={() => { if (validateEntries()) enterResultsMut.mutate() }}>
                      {t('lab.enterResults')}
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <Button onClick={() => setShowResultForm(true)}>{t('lab.enterResults')}</Button>
            )}
          </>
        )}

        {/* Action buttons */}
        <div className="lab-order-actions">
          {(isOrderingDoctor || isManager) && order.status === 'DRAFT' && (
            <>
              <Button loading={submitMut.isPending} onClick={() => submitMut.mutate()}>{t('lab.submitOrder')}</Button>
              <Button variant="danger" loading={deleteMut.isPending} onClick={handleDelete}>{t('lab.deleteOrder')}</Button>
            </>
          )}
          {(isSecretary || isManager) && order.status === 'ORDERED' && (
            <Button onClick={() => navigate('/secretary/lab')}>{t('lab.collectSample')}</Button>
          )}
          {(isSecretary || isManager) && order.status === 'SAMPLE_COLLECTED' && (
            <Button loading={processMut.isPending} onClick={() => processMut.mutate()}>{t('lab.startProcessing')}</Button>
          )}
          {(isOrderingDoctor || isManager) && order.status === 'COMPLETED' && (
            <Button loading={reviewMut.isPending} onClick={() => reviewMut.mutate()}>{t('lab.review')}</Button>
          )}
        </div>
      </Card>
    </div>
  )
}
