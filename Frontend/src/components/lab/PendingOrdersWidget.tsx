import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Card } from '../primitives/Card'
import { labOrdersApi } from '../../services/labOrders.api'

export function PendingOrdersWidget() {
  const { t } = useTranslation()

  const { data } = useQuery({
    queryKey: ['lab-orders', 'pending-count'],
    queryFn: () => labOrdersApi.list({ status: 'ORDERED', page_size: 1 }),
    staleTime: 30_000,
    retry: 1,
  })

  return (
    <Card>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 'var(--font-h1)', fontWeight: 700, color: 'var(--primary)' }}>
          {data?.count ?? '—'}
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-small)', marginTop: 'var(--space-1)' }}>
          {t('lab.pendingCount')}
        </div>
      </div>
    </Card>
  )
}
