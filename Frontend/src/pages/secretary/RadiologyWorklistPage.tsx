import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { RadiologyOrderDetailModal } from '../../components/medical/RadiologyOrderDetailModal'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate } from '../../lib/format'
import { radiologyApi } from '../../services/radiology.api'
import type { LabOrderPriority } from '../../services/types'

const LAB_PRIORITY_BADGE: Record<LabOrderPriority, string> = {
  ROUTINE: 'bg-slate-50 text-slate-500 border-slate-200/60',
  URGENT: 'bg-amber-50 text-amber-700 border-amber-200/60',
  STAT: 'bg-rose-50 text-rose-700 border-rose-200/60',
}

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all'

export function RadiologyWorklistPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const qc = useQueryClient()
  const [openOrderId, setOpenOrderId] = useState<number | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['radiology-orders', { status: 'ORDERED' }],
    queryFn: () => radiologyApi.list({ status: 'ORDERED', page_size: 50 }),
    staleTime: 15_000,
  })

  const orders = data?.results ?? []
  const refresh = () => qc.invalidateQueries({ queryKey: ['radiology-orders'] })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[{ label: t('nav.radiologyWorklist') }]} />
        <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>{t('radiology.worklistTitle')}</h1>
      </div>

      <div className={CARD}>
        {isLoading ? (
          <CenteredSpinner />
        ) : orders.length === 0 ? (
          <p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{t('radiology.noOrders')}</p>
        ) : (
          <div className="flex flex-col divide-y divide-slate-100">
            {orders.map((order) => (
              <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <strong className="patient-text-body font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {language === 'ar' && order.study_name_ar ? order.study_name_ar : order.study_name}
                  </strong>
                  <div className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>
                    {order.patient_name} · {order.doctor_name} · {formatDate(order.created_at, language)}
                  </div>
                  {order.priority !== 'ROUTINE' && (
                    <span className={`mt-1 inline-block shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${LAB_PRIORITY_BADGE[order.priority] ?? LAB_PRIORITY_BADGE.ROUTINE}`}>
                      {t(`status.${order.priority}`)}
                    </span>
                  )}
                </div>
                <button type="button" onClick={() => setOpenOrderId(order.id)} className={BTN_PRIMARY}>{t('radiology.complete')}</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {openOrderId != null && (
        <RadiologyOrderDetailModal
          orderId={openOrderId}
          onClose={() => setOpenOrderId(null)}
          onChanged={refresh}
        />
      )}
    </div>
  )
}
