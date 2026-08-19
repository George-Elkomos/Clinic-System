import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { FormField } from '../../components/primitives/FormField'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { useLanguage } from '../../hooks/useLanguage'
import { formatCurrency } from '../../lib/format'
import { billingApi } from '../../services/billing.api'

type Period = 'day' | 'month' | 'year'

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'

function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
      <div
        className="h-full rounded-full bg-gradient-to-r from-[#1AB5B3] to-[#38E4DD]"
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
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

  // System is single-currency (EGP).
  const money = (v: string) => formatCurrency(v, language)
  const maxBilled = Math.max(
    1,
    ...(data?.revenue_by_doctor ?? []).map((d) => parseFloat(d.total_billed)),
  )

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[{ label: t('billing.reportsTitle') }]} />
        <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>{t('billing.reportsTitle')}</h1>
      </div>

      <div className={CARD}>
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
      </div>

      {isLoading || !data ? (
        <CenteredSpinner />
      ) : (
        <>
          <div className={CARD}>
            <h2 className="patient-text-card-title mb-3" style={{ color: 'var(--text-primary)' }}>{t('billing.kpisTitle')}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
                <div className="text-xl font-extrabold" style={{ color: 'var(--brand-teal-start)' }}>{money(data.total_billed)}</div>
                <div className="patient-text-body-secondary mt-0.5" style={{ color: 'var(--text-secondary)' }}>{t('billing.totalBilled')}</div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
                <div className="text-xl font-extrabold" style={{ color: 'var(--brand-teal-start)' }}>{money(data.total_collected)}</div>
                <div className="patient-text-body-secondary mt-0.5" style={{ color: 'var(--text-secondary)' }}>{t('billing.totalCollected')}</div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
                <div className="text-xl font-extrabold" style={{ color: '#EF4444' }}>{money(data.total_outstanding)}</div>
                <div className="patient-text-body-secondary mt-0.5" style={{ color: 'var(--text-secondary)' }}>{t('billing.totalOutstanding')}</div>
              </div>
            </div>
          </div>

          <div className={CARD}>
            <h2 className="patient-text-card-title mb-3" style={{ color: 'var(--text-primary)' }}>{t('billing.revenueByDoctor')}</h2>
            {data.revenue_by_doctor.length === 0 ? (
              <p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{t('billing.noRevenue')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b-2 border-slate-100">
                      <th className="patient-text-overline px-3 py-2 text-left" style={{ color: 'var(--text-muted)' }}>{t('billing.doctor')}</th>
                      <th className="patient-text-overline px-3 py-2 text-left" style={{ color: 'var(--text-muted)' }}>{t('billing.totalBilled')}</th>
                      <th className="patient-text-overline px-3 py-2 text-left" style={{ color: 'var(--text-muted)' }}>{t('billing.totalCollected')}</th>
                      <th className="patient-text-overline px-3 py-2 text-left" style={{ color: 'var(--text-muted)' }}>{t('billing.revenueShare')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.revenue_by_doctor.map((d) => (
                      <tr key={d.doctor_id} className="border-b border-slate-100">
                        <td className="px-3 py-2.5 font-semibold" style={{ color: 'var(--text-primary)' }}>{d.doctor_name}</td>
                        <td className="px-3 py-2.5 patient-text-body" style={{ color: 'var(--text-secondary)' }}>{money(d.total_billed)}</td>
                        <td className="px-3 py-2.5 patient-text-body" style={{ color: 'var(--text-secondary)' }}>{money(d.total_collected)}</td>
                        <td className="w-1/3 px-3 py-2.5"><Bar pct={(parseFloat(d.total_billed) / maxBilled) * 100} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
