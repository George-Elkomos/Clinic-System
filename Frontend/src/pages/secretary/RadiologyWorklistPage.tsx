import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Button } from '../../components/primitives/Button'
import { Card } from '../../components/primitives/Card'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { StatusBadge } from '../../components/primitives/StatusBadge'
import { RadiologyOrderDetailModal } from '../../components/medical/RadiologyOrderDetailModal'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate } from '../../lib/format'
import { radiologyApi } from '../../services/radiology.api'

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
    <div>
      <Breadcrumbs trail={[{ label: t('nav.radiologyWorklist') }]} />
      <h1>{t('radiology.worklistTitle')}</h1>

      <Card>
        {isLoading ? (
          <CenteredSpinner />
        ) : orders.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>{t('radiology.noOrders')}</p>
        ) : (
          orders.map((order) => (
            <div key={order.id} className="appt-list-row">
              <div className="appt-list-info">
                <strong>{language === 'ar' && order.study_name_ar ? order.study_name_ar : order.study_name}</strong>
                <div className="medical-list-meta">
                  {order.patient_name} · {order.doctor_name} · {formatDate(order.created_at, language)}
                </div>
                {order.priority !== 'ROUTINE' && <StatusBadge status={order.priority} ns="status" />}
              </div>
              <Button onClick={() => setOpenOrderId(order.id)}>{t('radiology.complete')}</Button>
            </div>
          ))
        )}
      </Card>

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
