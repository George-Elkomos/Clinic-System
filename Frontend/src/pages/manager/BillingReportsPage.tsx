import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Card } from '../../components/primitives/Card'
import { FormField } from '../../components/primitives/FormField'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { useLanguage } from '../../hooks/useLanguage'
import { formatMoney } from '../../lib/format'
import { billingApi } from '../../services/billing.api'

type Period = 'day' | 'month' | 'year'

function Bar({ pct }: { pct: number }) {
  return (
    <div className="bar-track" aria-hidden="true">
      <div className="bar-fill" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi-card">
      <div className="kpi-card__value">{value}</div>
      <div className="kpi-card__label">{label}</div>
    </div>
  )
}

export function BillingReportsPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const [period, setPeriod] = useState<Period>('month')

  const { data, isLoading } = useQuery({
    queryKey: ['billing-report', period],
    queryFn: () => billingApi.report(period),
  })

  // Currency comes from backend settings; report money is all one currency.
  const money = (v: string) => formatMoney(v, data?.currency ?? 'USD', language)
  const maxBilled = Math.max(
    1,
    ...(data?.revenue_by_doctor ?? []).map((d) => parseFloat(d.total_billed)),
  )

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('billing.reportsTitle') }]} />
      <h1>{t('billing.reportsTitle')}</h1>

      <Card>
        <FormField label={t('reports.period')}>
          {(p) => (
            <Select
              id={p.id}
              options={[
                { value: 'day', label: t('billing.periodDay') },
                { value: 'month', label: t('billing.periodMonth') },
                { value: 'year', label: t('billing.periodYear') },
              ]}
              value={period}
              onChange={(v) => setPeriod((Array.isArray(v) ? 'month' : String(v)) as Period)}
            />
          )}
        </FormField>
      </Card>

      {isLoading || !data ? (
        <CenteredSpinner />
      ) : (
        <>
          <Card title={t('billing.kpisTitle')}>
            <div className="kpi-row">
              <Kpi label={t('billing.totalBilled')} value={money(data.total_billed)} />
              <Kpi label={t('billing.totalCollected')} value={money(data.total_collected)} />
              <Kpi label={t('billing.totalOutstanding')} value={money(data.total_outstanding)} />
            </div>
          </Card>

          <Card title={t('billing.revenueByDoctor')}>
            {data.revenue_by_doctor.length === 0 ? (
              <p>{t('billing.noRevenue')}</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)' }}>
                    <th style={{ textAlign: 'start', padding: 'var(--space-2)' }}>{t('billing.doctor')}</th>
                    <th style={{ textAlign: 'start', padding: 'var(--space-2)' }}>{t('billing.totalBilled')}</th>
                    <th style={{ textAlign: 'start', padding: 'var(--space-2)' }}>{t('billing.totalCollected')}</th>
                    <th style={{ textAlign: 'start', padding: 'var(--space-2)' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {data.revenue_by_doctor.map((d) => (
                    <tr key={d.doctor_id} style={{ borderTop: '1px solid var(--surface-2)' }}>
                      <td style={{ padding: 'var(--space-2)' }}>{d.doctor_name}</td>
                      <td style={{ padding: 'var(--space-2)' }}>{money(d.total_billed)}</td>
                      <td style={{ padding: 'var(--space-2)' }}>{money(d.total_collected)}</td>
                      <td style={{ padding: 'var(--space-2)', width: '40%' }}>
                        <Bar pct={(parseFloat(d.total_billed) / maxBilled) * 100} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
