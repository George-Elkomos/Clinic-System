import { useQuery } from '@tanstack/react-query'
import { Check, Clock, FlaskConical } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate } from '../../lib/format'
import { labOrdersApi } from '../../services/labOrders.api'
import type { LabOrderResult, LabOrderStatus } from '../../services/types'

const LAB_STEPS: LabOrderStatus[] = ['DRAFT', 'ORDERED', 'SAMPLE_COLLECTED', 'PROCESSING', 'COMPLETED', 'REVIEWED']

function EmptyOrdersState() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-100 bg-white px-6 py-16 text-center shadow-sm">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0D9488]/10 text-[#0D9488]">
        <FlaskConical className="h-7 w-7" aria-hidden="true" />
      </div>
      <div className="text-base font-bold text-slate-800">{t('lab.noOrders')}</div>
    </div>
  )
}

function LabProgressStepper({ status }: { status: LabOrderStatus }) {
  const { t } = useTranslation()
  const currentIndex = LAB_STEPS.indexOf(status)

  return (
    <div className="overflow-x-auto px-1 pb-1">
      <div className="flex min-w-[520px] items-start">
        {LAB_STEPS.map((step, i) => {
          const isDone = i < currentIndex
          const isActive = i === currentIndex
          return (
            <div key={step} className={`flex items-start ${i < LAB_STEPS.length - 1 ? 'flex-1' : ''}`}>
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${
                    isDone || isActive
                      ? 'border-[#0D9488] bg-[#0D9488] text-white'
                      : 'border-slate-200 bg-slate-100 text-slate-400'
                  }`}
                >
                  {isDone ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : i + 1}
                </div>
                <span
                  className={`w-[72px] text-center text-[10px] leading-tight sm:text-xs ${
                    isActive ? 'font-bold text-[#0D9488]' : isDone ? 'font-medium text-slate-600' : 'text-slate-400'
                  }`}
                >
                  {t(`status.${step}`)}
                </span>
              </div>
              {i < LAB_STEPS.length - 1 && (
                <div className={`mt-[13px] h-0.5 flex-1 ${isDone ? 'bg-[#0D9488]' : 'bg-slate-200'}`} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ResultsTable({ results, language }: { results: LabOrderResult[]; language: string }) {
  const { t } = useTranslation()
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-100">
      <table className="w-full min-w-[480px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50/70 text-start text-xs font-semibold uppercase tracking-wide text-slate-400">
            <th className="px-3 py-2.5 text-start">{t('lab.testName')}</th>
            <th className="px-3 py-2.5 text-start">{t('lab.resultValue')}</th>
            <th className="px-3 py-2.5 text-start">{t('lab.referenceRange')}</th>
            <th className="px-3 py-2.5 text-start">{t('lab.resultDate')}</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr
              key={r.id}
              className={`border-b border-slate-50 last:border-0 ${
                r.is_critical ? 'bg-rose-50/60' : r.is_abnormal ? 'bg-amber-50/60' : ''
              }`}
            >
              <td className="px-3 py-2.5 font-medium text-slate-700">{r.test_name}</td>
              <td className="px-3 py-2.5">
                <span className="font-semibold text-slate-800">{[r.result_value, r.unit].filter(Boolean).join(' ')}</span>
                {(r.is_critical || r.is_abnormal) && (
                  <span
                    className={`ms-2 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                      r.is_critical ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {r.is_critical ? t('lab.isCritical') : t('lab.isAbnormal')}
                  </span>
                )}
              </td>
              <td className="px-3 py-2.5 text-slate-500">{r.reference_range}</td>
              <td className="px-3 py-2.5 text-slate-500">{r.result_date ? formatDate(r.result_date, language) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function LabOrderCard({ orderId, orderNumber, issuedAt }: { orderId: number; orderNumber: string; issuedAt: string }) {
  const { t } = useTranslation()
  const { language } = useLanguage()

  const { data: order, isLoading } = useQuery({
    queryKey: ['lab-orders', orderId],
    queryFn: () => labOrdersApi.get(orderId),
    staleTime: 15_000,
    retry: 1,
  })

  return (
    <div className="mb-5 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-base font-bold text-slate-800 sm:text-lg">{orderNumber}</div>
          <div className="mt-0.5 text-xs font-medium text-slate-400">{formatDate(issuedAt, language)}</div>
        </div>
        {order && (
          <span className="inline-flex w-fit items-center rounded-full bg-[#0D9488]/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#0D9488]">
            {t(`status.${order.status}`)}
          </span>
        )}
      </div>

      {isLoading || !order ? (
        <div className="mt-4">
          <CenteredSpinner />
        </div>
      ) : (
        <>
          <div className="mt-5">
            <LabProgressStepper status={order.status} />
          </div>

          <div className="mt-5">
            {order.results.length === 0 ? (
              <div className="flex items-center gap-2 rounded-xl border border-amber-100 bg-amber-50/60 p-4 text-xs text-amber-800 sm:text-sm">
                <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
                {t('lab.resultsPending')}
              </div>
            ) : (
              <ResultsTable results={order.results} language={language} />
            )}
          </div>
        </>
      )}
    </div>
  )
}

export function PatientLabResultsPage() {
  const { t } = useTranslation()

  const { data, isLoading } = useQuery({
    queryKey: ['lab-orders', { patient: 'mine' }],
    queryFn: () => labOrdersApi.list({ page_size: 50 }),
    staleTime: 30_000,
    retry: 1,
  })

  const orders = data?.results ?? []

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('nav.labResults') }]} />
      {/* PatientShell already renders this same title (hidden lg:block) in its
          own sticky header — shown only below lg so the two never duplicate. */}
      <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>
        {t('nav.labResults')}
      </h1>
      <div className="mt-1 mb-6">
        <p className="text-sm text-slate-500">{t('lab.resultsSubtitle')}</p>
      </div>

      {isLoading ? (
        <CenteredSpinner />
      ) : orders.length === 0 ? (
        <EmptyOrdersState />
      ) : (
        orders.map((order) => (
          <LabOrderCard
            key={order.id}
            orderId={order.id}
            orderNumber={order.order_number}
            issuedAt={order.ordered_at || order.created_at}
          />
        ))
      )}
    </div>
  )
}
