import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DiagnosisPieChart } from '../../components/analytics/DiagnosisPieChart'
import { SpecialtyBarChart } from '../../components/analytics/SpecialtyBarChart'
import { SpecialtyTrendLineChart } from '../../components/analytics/SpecialtyTrendLineChart'
import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Button } from '../../components/primitives/Button'
import { Card } from '../../components/primitives/Card'
import { FormField } from '../../components/primitives/FormField'
import { KpiRow } from '../../components/primitives/KpiRow'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { useLanguage } from '../../hooks/useLanguage'
import { saveBlob } from '../../lib/download'
import { errorMessage } from '../../services/apiClient'
import { reportsApi } from '../../services/reports.api'

function Bar({ pct }: { pct: number }) {
  return (
    <div className="bar-track" aria-hidden="true">
      <div className="bar-fill" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="kpi-card">
      <div className="kpi-card__value">{value}</div>
      <div className="kpi-card__label">{label}</div>
    </div>
  )
}

export function ReportsDashboardPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { showToast } = useToast()
  const [period, setPeriod] = useState('month')

  const { data, isLoading } = useQuery({
    queryKey: ['report', period],
    queryFn: () => reportsApi.dashboard(period),
  })

  const { data: diagnosisData } = useQuery({
    queryKey: ['diagnosis-distribution', period],
    queryFn: () => reportsApi.diagnosisDistribution(period),
  })

  // specialty-analytics / lab-analytics only understand week|month|year (no
  // "all") — the page's period Select still offers "all" for the older
  // dashboard/diagnosis-distribution sections, so translate it to "year"
  // (the closest available upper bound) rather than let the backend's
  // silent month-fallback quietly disagree with what the Select shows.
  const analyticsPeriod = period === 'all' ? 'year' : period

  const { data: specialtyData, isLoading: isSpecialtyLoading } = useQuery({
    queryKey: ['specialty-analytics', analyticsPeriod],
    queryFn: () => reportsApi.specialtyAnalytics(analyticsPeriod),
  })

  const { data: labData, isLoading: isLabLoading } = useQuery({
    queryKey: ['lab-analytics', analyticsPeriod],
    queryFn: () => reportsApi.labAnalytics(analyticsPeriod),
  })

  const maxDiagnosis = Math.max(1, ...(diagnosisData?.diagnoses ?? []).map((d) => d.count))

  const specialtyTotals = specialtyData?.specialties ?? []
  const specialtyTotalAppointments = specialtyTotals.reduce((sum, r) => sum + r.total_appointments, 0)
  const specialtyTotalCompleted = specialtyTotals.reduce((sum, r) => sum + r.completed, 0)
  const specialtyCompletionRate = specialtyTotalAppointments
    ? Math.round((specialtyTotalCompleted / specialtyTotalAppointments) * 1000) / 10
    : 0
  const specialtyAvgWait = specialtyTotalAppointments
    ? Math.round(
        (specialtyTotals.reduce((sum, r) => sum + r.avg_wait_minutes * r.total_appointments, 0) /
          specialtyTotalAppointments) *
          10,
      ) / 10
    : 0

  const exportReport = async (fmt: 'pdf' | 'csv') => {
    try {
      saveBlob(await reportsApi.exportBlob(fmt, period), `clinic_report_${period}.${fmt}`)
    } catch (err) {
      showToast(errorMessage(err), 'error')
    }
  }

  const maxTotal = Math.max(1, ...(data?.appointments_per_doctor ?? []).map((d) => d.total))

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('reports.title') }]} />
      <h1>{t('reports.title')}</h1>

      <Card>
        <div className="filter-bar">
          <div className="filter-bar__field">
            <FormField label={t('reports.period')}>
              {(p) => (
                <Select
                  id={p.id}
                  options={[
                    { value: 'week', label: t('reports.week') },
                    { value: 'month', label: t('reports.month') },
                    { value: 'all', label: t('reports.all') },
                  ]}
                  value={period}
                  onChange={(v) => setPeriod(Array.isArray(v) ? 'month' : String(v))}
                />
              )}
            </FormField>
          </div>
          <div className="filter-bar__actions">
            <Button variant="secondary" onClick={() => exportReport('pdf')}>{t('reports.exportPdf')}</Button>
            <Button variant="secondary" onClick={() => exportReport('csv')}>{t('reports.exportCsv')}</Button>
          </div>
        </div>
      </Card>

      {isLoading || !data ? (
        <CenteredSpinner />
      ) : (
        <>
          <Card title={t('reports.overall')}>
            <div className="kpi-row">
              <Kpi label={t('reports.total')} value={data.overall.total} />
              <Kpi label={t('reports.completed')} value={data.overall.completed} />
              <Kpi label={t('reports.noShow')} value={data.overall.no_show} />
              <Kpi label={t('reports.cancelled')} value={data.overall.cancelled} />
              <Kpi label={t('reports.avgWait')} value={data.avg_wait_minutes} />
              <Kpi label={t('reports.newPatients')} value={data.new_patients_total} />
            </div>
          </Card>

          <Card title={t('reports.perDoctor')}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'start', color: 'var(--text-muted)' }}>
                  <th style={{ textAlign: 'start', padding: 'var(--space-2)' }}>{t('reports.doctor')}</th>
                  <th style={{ textAlign: 'start', padding: 'var(--space-2)' }}>{t('reports.total')}</th>
                  <th style={{ textAlign: 'start', padding: 'var(--space-2)' }}></th>
                  <th style={{ textAlign: 'start', padding: 'var(--space-2)' }}>{t('reports.noShowRate')}</th>
                </tr>
              </thead>
              <tbody>
                {data.appointments_per_doctor.map((d) => (
                  <tr key={d.doctor_id} style={{ borderTop: '1px solid var(--surface-2)' }}>
                    <td style={{ padding: 'var(--space-2)' }}>{d.doctor_name}</td>
                    <td style={{ padding: 'var(--space-2)' }}>{d.total}</td>
                    <td style={{ padding: 'var(--space-2)', width: '40%' }}><Bar pct={(d.total / maxTotal) * 100} /></td>
                    <td style={{ padding: 'var(--space-2)' }}>{d.no_show_rate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title={t('reports.ratingsTitle')}>
            {data.most_reviewed && <p>{t('reports.mostReviewed', { name: data.most_reviewed.doctor_name })}</p>}
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)' }}>
                  <th style={{ textAlign: 'start', padding: 'var(--space-2)' }}>{t('reports.doctor')}</th>
                  <th style={{ textAlign: 'start', padding: 'var(--space-2)' }}>{t('reports.avgRating')}</th>
                  <th style={{ textAlign: 'start', padding: 'var(--space-2)' }}>{t('reports.reviewsCount')}</th>
                </tr>
              </thead>
              <tbody>
                {data.ratings.map((r) => (
                  <tr key={r.doctor_name} style={{ borderTop: '1px solid var(--surface-2)' }}>
                    <td style={{ padding: 'var(--space-2)' }}>{r.doctor_name}</td>
                    <td style={{ padding: 'var(--space-2)' }}>{r.average || '—'}</td>
                    <td style={{ padding: 'var(--space-2)' }}>{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title={t('reports.attendance')}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {data.attendance.map((a) => (
                  <tr key={a.doctor_name} style={{ borderTop: '1px solid var(--surface-2)' }}>
                    <td style={{ padding: 'var(--space-2)' }}>{a.doctor_name}</td>
                    <td style={{ padding: 'var(--space-2)' }}>{a.absence_days} {t('reports.absenceDays')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title={t('reports.specialtyAnalytics')}>
            {isSpecialtyLoading || !specialtyData ? (
              <CenteredSpinner />
            ) : specialtyData.specialties.length === 0 ? (
              <p>{t('reports.noSpecialtyData')}</p>
            ) : (
              <>
                <KpiRow
                  items={[
                    { label: t('reports.total'), value: specialtyTotalAppointments },
                    { label: t('reports.completionRate'), value: `${specialtyCompletionRate}%` },
                    { label: t('reports.avgWait'), value: specialtyAvgWait },
                  ]}
                />
                <div className="chart-container">
                  <SpecialtyBarChart rows={specialtyData.specialties} language={language} />
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ color: 'var(--text-muted)' }}>
                      <th style={{ textAlign: 'start', padding: 'var(--space-2)' }}>{t('reports.specialty')}</th>
                      <th style={{ textAlign: 'start', padding: 'var(--space-2)' }}>{t('reports.total')}</th>
                      <th style={{ textAlign: 'start', padding: 'var(--space-2)' }}>{t('reports.completed')}</th>
                      <th style={{ textAlign: 'start', padding: 'var(--space-2)' }}>{t('reports.completionRate')}</th>
                      <th style={{ textAlign: 'start', padding: 'var(--space-2)' }}>{t('reports.avgWait')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {specialtyData.specialties.map((r) => (
                      <tr key={r.specialty_id} style={{ borderTop: '1px solid var(--surface-2)' }}>
                        <td style={{ padding: 'var(--space-2)' }} dir="auto">
                          {language === 'ar' && r.specialty_name_ar ? r.specialty_name_ar : r.specialty_name}
                        </td>
                        <td style={{ padding: 'var(--space-2)' }}>{r.total_appointments}</td>
                        <td style={{ padding: 'var(--space-2)' }}>{r.completed}</td>
                        <td style={{ padding: 'var(--space-2)' }}>{r.completion_rate}%</td>
                        <td style={{ padding: 'var(--space-2)' }}>{r.avg_wait_minutes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </Card>

          <Card title={t('reports.specialtyTrend')}>
            <p className="chart-caption">{t('reports.trendFixedWindow')}</p>
            {isSpecialtyLoading || !specialtyData ? (
              <CenteredSpinner />
            ) : (
              <div className="chart-container analytics-charts">
                <SpecialtyTrendLineChart points={specialtyData.monthly_trend} language={language} />
              </div>
            )}
          </Card>

          <Card title={t('reports.topDiagnoses')}>
            {!diagnosisData || diagnosisData.diagnoses.length === 0 ? (
              <p>{t('reports.noDiagnoses')}</p>
            ) : (
              <div className="analytics-summary-grid">
                <div className="chart-container analytics-charts">
                  <DiagnosisPieChart diagnoses={diagnosisData.diagnoses} language={language} />
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ color: 'var(--text-muted)' }}>
                      <th style={{ textAlign: 'start', padding: 'var(--space-2)' }}>{t('reports.diagnosis')}</th>
                      <th style={{ textAlign: 'start', padding: 'var(--space-2)' }}>{t('reports.count')}</th>
                      <th style={{ textAlign: 'start', padding: 'var(--space-2)' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {diagnosisData.diagnoses.map((d) => (
                      <tr key={d.name} style={{ borderTop: '1px solid var(--surface-2)' }}>
                        <td style={{ padding: 'var(--space-2)' }} dir="auto">
                          {language === 'ar' && d.name_ar ? d.name_ar : d.name}
                          {d.icd10_code && <span style={{ color: 'var(--text-muted)' }}> ({d.icd10_code})</span>}
                        </td>
                        <td style={{ padding: 'var(--space-2)' }}>{d.count}</td>
                        <td style={{ padding: 'var(--space-2)', width: '40%' }}><Bar pct={(d.count / maxDiagnosis) * 100} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title={t('reports.labAnalytics')}>
            {isLabLoading || !labData ? (
              <CenteredSpinner />
            ) : labData.tests.length === 0 ? (
              <p>{t('reports.noLabData')}</p>
            ) : (
              <>
                <KpiRow
                  items={[
                    { label: t('reports.totalOrders'), value: labData.total_lab_orders },
                    { label: t('reports.avgTurnaround'), value: labData.overall_avg_turnaround_hours ?? '—' },
                    { label: t('reports.abnormalRate'), value: `${labData.abnormal_result_pct}%` },
                  ]}
                />
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ color: 'var(--text-muted)' }}>
                      <th style={{ textAlign: 'start', padding: 'var(--space-2)' }}>{t('reports.testName')}</th>
                      <th style={{ textAlign: 'start', padding: 'var(--space-2)' }}>{t('reports.count')}</th>
                      <th style={{ textAlign: 'start', padding: 'var(--space-2)' }}>{t('reports.avgTurnaround')}</th>
                      <th style={{ textAlign: 'start', padding: 'var(--space-2)' }}>{t('reports.abnormalRate')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {labData.tests.map((row) => (
                      <tr key={row.test_name} style={{ borderTop: '1px solid var(--surface-2)' }}>
                        <td style={{ padding: 'var(--space-2)' }}>{row.test_name}</td>
                        <td style={{ padding: 'var(--space-2)' }}>{row.count}</td>
                        <td style={{ padding: 'var(--space-2)' }}>{row.avg_turnaround_hours ?? '—'}</td>
                        <td style={{ padding: 'var(--space-2)' }}>{row.abnormal_pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
