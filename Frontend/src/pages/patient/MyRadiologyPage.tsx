import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Card } from '../../components/primitives/Card'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { StatusBadge } from '../../components/primitives/StatusBadge'
import { RadiologyOrderDetailModal } from '../../components/medical/RadiologyOrderDetailModal'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate } from '../../lib/format'
import { radiologyApi } from '../../services/radiology.api'

export function MyRadiologyPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const [openOrderId, setOpenOrderId] = useState<number | null>(null)

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['radiology-orders', 'mine'],
    queryFn: () => radiologyApi.list().then((r) => r.results),
  })

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('nav.radiology') }]} />
      <h1>{t('nav.radiology')}</h1>

      <Card title={t('radiology.title')}>
        {isLoading ? (
          <CenteredSpinner />
        ) : orders.length === 0 ? (
          <p>{t('radiology.none')}</p>
        ) : (
          <ul className="procedure-list">
            {orders.map((order) => (
              <li key={order.id}>
                <button type="button" className="procedure-row" onClick={() => setOpenOrderId(order.id)}>
                  <div className="procedure-row__main">
                    <span className="procedure-row__name">
                      {language === 'ar' && order.study_name_ar ? order.study_name_ar : order.study_name}
                    </span>
                    <span className="procedure-row__meta">
                      {order.doctor_name} · {formatDate(order.created_at, language)}
                    </span>
                  </div>
                  <StatusBadge status={order.status} ns="radiology.status" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {openOrderId != null && (
        <RadiologyOrderDetailModal orderId={openOrderId} onClose={() => setOpenOrderId(null)} />
      )}
    </div>
  )
}
