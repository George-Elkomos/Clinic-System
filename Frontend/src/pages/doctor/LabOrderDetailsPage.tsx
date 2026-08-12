import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { useConfirm } from '../../components/primitives/ConfirmDialog'
import { CenteredSpinner, Spinner } from '../../components/primitives/Spinner'
import { CustomDatePicker } from '../../components/primitives/CustomDatePicker'
import { useToast } from '../../components/primitives/Toast'
import { FormField } from '../../components/primitives/FormField'
import { LabStatusTimeline } from '../../components/lab/LabStatusTimeline'
import { useAuth } from '../../hooks/useAuth'
import { useLanguage } from '../../hooks/useLanguage'
import { saveBlob } from '../../lib/download'
import { formatDate } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { labOrdersApi } from '../../services/labOrders.api'
import type { CreateLabOrderResultPayload, LabOrderPriority, LabOrderResult } from '../../services/types'

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

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#1AB5B3] to-[#38E4DD] px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-95 disabled:opacity-60 sm:text-sm'
const BTN_SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-medium text-slate-700 transition-all hover:border-[#0D9488] hover:text-[#0D9488] disabled:opacity-60 sm:text-sm'
const BTN_SECONDARY_SM = 'inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-all hover:border-[#0D9488] hover:text-[#0D9488] disabled:opacity-60'
const BTN_DANGER = 'inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-5 py-2.5 text-xs font-medium text-rose-600 transition-all hover:bg-rose-100 disabled:opacity-60 sm:text-sm'

const LAB_PRIORITY_BADGE: Record<LabOrderPriority, string> = {
  ROUTINE: 'bg-slate-50 text-slate-500 border-slate-200/60',
  URGENT: 'bg-amber-50 text-amber-700 border-amber-200/60',
  STAT: 'bg-rose-50 text-rose-700 border-rose-200/60',
}

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
    <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/40 p-4">
      <strong className="patient-text-overline" style={{ color: 'var(--text-muted)' }}>#{index + 1}</strong>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <FormField label={t('lab.testName')} error={errors?.test_name}>
          {(p) => <input {...p} className="patient-field" value={value.test_name} onChange={(e) => set('test_name', e.target.value)} />}
        </FormField>
        <FormField label={t('lab.resultValue')} error={errors?.result_value}>
          {(p) => <input {...p} className="patient-field" value={value.result_value} onChange={(e) => set('result_value', e.target.value)} />}
        </FormField>
        <FormField label={t('lab.unit')}>
          {(p) => <input {...p} className="patient-field" value={value.unit ?? ''} onChange={(e) => set('unit', e.target.value)} />}
        </FormField>
        <FormField label={t('lab.referenceRange')}>
          {(p) => <input {...p} className="patient-field" value={value.reference_range ?? ''} onChange={(e) => set('reference_range', e.target.value)} />}
        </FormField>
        <FormField label={t('lab.resultDate')} error={errors?.result_date}>
          {(p) => <CustomDatePicker {...p} variant="field" value={value.result_date} onChange={(iso) => set('result_date', iso)} />}
        </FormField>
      </div>
      <div className="mt-3 flex flex-wrap gap-4">
        <label className="patient-text-body flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <input type="checkbox" checked={value.is_abnormal} onChange={(e) => set('is_abnormal', e.target.checked)} />
          {t('lab.isAbnormal')}
        </label>
        <label className="patient-text-body flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <input type="checkbox" checked={value.is_critical} onChange={(e) => set('is_critical', e.target.checked)} />
          {t('lab.isCritical')}
        </label>
      </div>
      <div className="mt-3">
        <FormField label={t('lab.resultFile')}>
          {(p) => <input {...p} type="file" onChange={(e) => set('file', e.target.files?.[0] ?? null)} />}
        </FormField>
      </div>
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
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[{ label: t('lab.title'), to: backPath }, { label: order.order_number }]} />
        <h1 className="patient-text-page-title" style={{ color: 'var(--text-primary)' }}>{order.order_number}</h1>
      </div>

      <div className={CARD}>
        <LabStatusTimeline status={order.status} />
        <div className="mb-4 grid gap-3 grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
          <div><span className="patient-text-body-secondary" style={{ color: 'var(--text-muted)' }}>{t('lab.patient')}: </span><strong className="patient-text-body" style={{ color: 'var(--text-primary)' }}>{order.patient_name}</strong></div>
          <div><span className="patient-text-body-secondary" style={{ color: 'var(--text-muted)' }}>{t('lab.doctor')}: </span><strong className="patient-text-body" style={{ color: 'var(--text-primary)' }}>{order.doctor_name}</strong></div>
          <div>
            <span className="patient-text-body-secondary" style={{ color: 'var(--text-muted)' }}>{t('lab.priority')}: </span>
            <span className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${LAB_PRIORITY_BADGE[order.priority] ?? LAB_PRIORITY_BADGE.ROUTINE}`}>
              {t(`status.${order.priority}`)}
            </span>
          </div>
          <div><span className="patient-text-body-secondary" style={{ color: 'var(--text-muted)' }}>{t('appointments.when')}: </span>{formatDate(order.created_at, language)}</div>
        </div>
        {order.clinical_notes && <p className="patient-text-body mb-4" style={{ color: 'var(--text-primary)' }}>{order.clinical_notes}</p>}
        {order.has_critical && (
          <div className="mb-3 inline-block rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">
            ⚠ {t('lab.hasCritical')}
          </div>
        )}

        {/* Test items */}
        <h3 className="patient-text-card-title mb-2" style={{ color: 'var(--text-primary)' }}>{t('lab.tests')}</h3>
        {order.items.length === 0 ? (
          <p className="patient-text-body-secondary mb-4" style={{ color: 'var(--text-muted)' }}>—</p>
        ) : (
          <ul className="mb-4 list-disc space-y-1 ps-5 patient-text-body" style={{ color: 'var(--text-primary)' }}>
            {order.items.map((item) => (
              <li key={item.id}><strong>{item.test_name}</strong>{item.test_code && ` (${item.test_code})`}{item.notes && ` — ${item.notes}`}</li>
            ))}
          </ul>
        )}

        {/* Results table */}
        {order.results.length > 0 && (
          <>
            <h3 className="patient-text-card-title mb-2" style={{ color: 'var(--text-primary)' }}>{t('lab.results')}</h3>
            <div className="mb-4 overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-100">
                    {[t('lab.testName'), t('lab.resultValue'), t('lab.unit'), t('lab.referenceRange'), t('lab.resultDate'), ''].map((h) => (
                      <th key={h || 'actions'} className="patient-text-overline px-3 py-2 text-left" style={{ color: 'var(--text-muted)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {order.results.map((r) => (
                    <tr
                      key={r.id}
                      className={`border-b border-slate-100 ${r.is_critical ? 'bg-rose-50/60' : r.is_abnormal ? 'bg-amber-50/60' : ''}`}
                    >
                      <td className="px-3 py-2.5">{r.test_name}</td>
                      <td className="px-3 py-2.5 font-semibold">{r.result_value}</td>
                      <td className="px-3 py-2.5">{r.unit}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--text-muted)' }}>{r.reference_range}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--text-muted)' }}>{formatDate(r.result_date, language)}</td>
                      <td className="px-3 py-2.5">
                        {r.file && (
                          <button type="button" onClick={() => download(r)} className={BTN_SECONDARY_SM}>
                            {t('lab.download')}
                          </button>
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
                <h3 className="patient-text-card-title mb-2" style={{ color: 'var(--text-primary)' }}>{t('lab.enterResults')}</h3>
                {Object.keys(resultErrors).length > 0 && (
                  <div role="alert" className="mb-4 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    <span aria-hidden="true">⚠</span>
                    {t('vitals.formErrors')}
                  </div>
                )}
                {resultEntries.length === 0 && (
                  <button type="button" onClick={() => setResultEntries([newResultEntry()])} className={BTN_SECONDARY}>
                    {t('lab.addTest')}
                  </button>
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
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button type="button" onClick={() => setResultEntries((arr) => [...arr, newResultEntry()])} className={BTN_SECONDARY}>
                      {t('lab.addTest')}
                    </button>
                    <button type="button" onClick={() => { setShowResultForm(false); setResultEntries([]); setResultErrors({}) }} className={BTN_SECONDARY}>
                      {t('common.cancel')}
                    </button>
                    <button type="button" disabled={enterResultsMut.isPending} onClick={() => { if (validateEntries()) enterResultsMut.mutate() }} className={BTN_PRIMARY}>
                      {enterResultsMut.isPending && <Spinner size={14} />}{t('lab.enterResults')}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <button type="button" onClick={() => setShowResultForm(true)} className={BTN_PRIMARY}>{t('lab.enterResults')}</button>
            )}
          </>
        )}

        {/* Action buttons */}
        <div className="mt-5 flex flex-wrap gap-3">
          {(isOrderingDoctor || isManager) && order.status === 'DRAFT' && (
            <>
              <button type="button" disabled={submitMut.isPending} onClick={() => submitMut.mutate()} className={BTN_PRIMARY}>
                {submitMut.isPending && <Spinner size={14} />}{t('lab.submitOrder')}
              </button>
              <button type="button" disabled={deleteMut.isPending} onClick={handleDelete} className={BTN_DANGER}>
                {deleteMut.isPending && <Spinner size={14} />}{t('lab.deleteOrder')}
              </button>
            </>
          )}
          {(isSecretary || isManager) && order.status === 'ORDERED' && (
            <button type="button" onClick={() => navigate('/secretary/lab')} className={BTN_PRIMARY}>{t('lab.collectSample')}</button>
          )}
          {(isSecretary || isManager) && order.status === 'SAMPLE_COLLECTED' && (
            <button type="button" disabled={processMut.isPending} onClick={() => processMut.mutate()} className={BTN_PRIMARY}>
              {processMut.isPending && <Spinner size={14} />}{t('lab.startProcessing')}
            </button>
          )}
          {(isOrderingDoctor || isManager) && order.status === 'COMPLETED' && (
            <button type="button" disabled={reviewMut.isPending} onClick={() => reviewMut.mutate()} className={BTN_PRIMARY}>
              {reviewMut.isPending && <Spinner size={14} />}{t('lab.review')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
