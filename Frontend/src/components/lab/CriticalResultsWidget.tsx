import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Card } from '../primitives/Card'
import { labOrdersApi } from '../../services/labOrders.api'

export function CriticalResultsWidget() {
  const { t } = useTranslation()

  const { data } = useQuery({
    queryKey: ['lab-orders', 'critical-count'],
    queryFn: () => labOrdersApi.list({ status: 'COMPLETED', page_size: 1 }),
    staleTime: 30_000,
    retry: 1,
  })

  return (
    <Card>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 'var(--font-h1)', fontWeight: 700, color: 'var(--danger)' }}>
          {data?.count ?? '—'}
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-small)', marginTop: 'var(--space-1)' }}>
          {t('lab.criticalCount')}
        </div>
      </div>
    </Card>
  )
}
