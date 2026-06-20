import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Card } from '../primitives/Card'
import { StatusBadge } from '../primitives/StatusBadge'
import { labOrdersApi } from '../../services/labOrders.api'
import { useAuth } from '../../hooks/useAuth'

export function RecentLabsWidget() {
  const { t } = useTranslation()
  const { user } = useAuth()

  const { data } = useQuery({
    queryKey: ['lab-orders', 'recent'],
    queryFn: () => labOrdersApi.list({ page_size: 5 }),
    staleTime: 30_000,
    retry: 1,
  })

  const baseRoute = user?.role === 'DOCTOR' ? '/doctor/lab-orders' : '/secretary/lab'

  return (
    <Card title={t('lab.recentLabs')}>
      {(data?.results ?? []).length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>{t('lab.noOrders')}</p>
      ) : (
        <div>
          {(data?.results ?? []).map((order) => (
            <div
              key={order.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: 'var(--space-2) 0',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div>
                <Link to={`${baseRoute}/${order.id}`} style={{ fontWeight: 600, color: 'var(--primary)' }}>
                  {order.order_number}
                </Link>
                <div style={{ fontSize: 'var(--font-small)', color: 'var(--text-muted)' }}>
                  {order.patient_name}
                </div>
              </div>
              <StatusBadge status={order.status} />
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
