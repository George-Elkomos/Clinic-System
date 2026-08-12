import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DiagnosisPieChart } from '../../components/analytics/DiagnosisPieChart'
import { SpecialtyBarChart } from '../../components/analytics/SpecialtyBarChart'
import { SpecialtyTrendLineChart } from '../../components/analytics/SpecialtyTrendLineChart'
import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { FormField } from '../../components/primitives/FormField'
import { KpiRow } from '../../components/primitives/KpiRow'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { useLanguage } from '../../hooks/useLanguage'
import { saveBlob } from '../../lib/download'
import { errorMessage } from '../../services/apiClient'
import { reportsApi } from '../../services/reports.api'

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const BTN_SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-all'
const TH = 'patient-text-overline px-3 py-2 text-left'
const TD = 'px-3 py-2.5 patient-text-body'

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
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[{ label: t('reports.title') }]} />
        <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>{t('reports.title')}</h1>
      </div>

      <div className={CARD}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="w-full sm:w-56">
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
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => exportReport('pdf')} className={BTN_SECONDARY}>{t('reports.exportPdf')}</button>
            <button type="button" onClick={() => exportReport('csv')} className={BTN_SECONDARY}>{t('reports.exportCsv')}</button>
          </div>
        </div>
      </div>

      {isLoading || !data ? (
        <CenteredSpinner />
      ) : (
        <>
          <div className={CARD}>
            <h2 className="patient-text-card-title mb-3" style={{ color: 'var(--text-primary)' }}>{t('reports.overall')}</h2>
            <KpiRow
              items={[
                { label: t('reports.total'), value: data.overall.total },
                { label: t('reports.completed'), value: data.overall.completed },
                { label: t('reports.noShow'), value: data.overall.no_show },
                { label: t('reports.cancelled'), value: data.overall.cancelled },
                { label: t('reports.avgWait'), value: data.avg_wait_minutes },
                { label: t('reports.newPatients'), value: data.new_patients_total },
              ]}
            />
          </div>

          <div className={CARD}>
            <h2 className="patient-text-card-title mb-3" style={{ color: 'var(--text-primary)' }}>{t('reports.perDoctor')}</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-100">
                    <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('reports.doctor')}</th>
                    <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('reports.total')}</th>
                    <th className={TH} />
                    <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('reports.noShowRate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.appointments_per_doctor.map((d) => (
                    <tr key={d.doctor_id} className="border-b border-slate-100">
                      <td className={TD} style={{ color: 'var(--text-primary)' }}>{d.doctor_name}</td>
                      <td className={TD} style={{ color: 'var(--text-secondary)' }}>{d.total}</td>
                      <td className="w-2/5 px-3 py-2.5"><Bar pct={(d.total / maxTotal) * 100} /></td>
                      <td className={TD} style={{ color: 'var(--text-secondary)' }}>{d.no_show_rate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className={CARD}>
            <h2 className="patient-text-card-title mb-3" style={{ color: 'var(--text-primary)' }}>{t('reports.ratingsTitle')}</h2>
            {data.most_reviewed && <p className="patient-text-body mb-3" style={{ color: 'var(--text-primary)' }}>{t('reports.mostReviewed', { name: data.most_reviewed.doctor_name })}</p>}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-100">
                    <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('reports.doctor')}</th>
                    <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('reports.avgRating')}</th>
                    <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('reports.reviewsCount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ratings.map((r) => (
                    <tr key={r.doctor_name} className="border-b border-slate-100">
                      <td className={TD} style={{ color: 'var(--text-primary)' }}>{r.doctor_name}</td>
                      <td className={TD} style={{ color: 'var(--text-secondary)' }}>{r.average || '—'}</td>
                      <td className={TD} style={{ color: 'var(--text-secondary)' }}>{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className={CARD}>
            <h2 className="patient-text-card-title mb-3" style={{ color: 'var(--text-primary)' }}>{t('reports.attendance')}</h2>
            <div className="flex flex-col divide-y divide-slate-100">
              {data.attendance.map((a) => (
                <div key={a.doctor_name} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="patient-text-body font-medium" style={{ color: 'var(--text-primary)' }}>{a.doctor_name}</span>
                  <span className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{a.absence_days} {t('reports.absenceDays')}</span>
                </div>
              ))}
            </div>
          </div>

          <div className={CARD}>
            <h2 className="patient-text-card-title mb-3" style={{ color: 'var(--text-primary)' }}>{t('reports.specialtyAnalytics')}</h2>
            {isSpecialtyLoading || !specialtyData ? (
              <CenteredSpinner />
            ) : specialtyData.specialties.length === 0 ? (
              <p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{t('reports.noSpecialtyData')}</p>
            ) : (
              <>
                <KpiRow
                  items={[
                    { label: t('reports.total'), value: specialtyTotalAppointments },
                    { label: t('reports.completionRate'), value: `${specialtyCompletionRate}%` },
                    { label: t('reports.avgWait'), value: specialtyAvgWait },
                  ]}
                />
                {/* chart-container/analytics-charts (analytics.css) aren't just visual
                    chrome — chart-container gives Recharts' ResponsiveContainer the
                    explicit height its own height="100%" needs, and analytics-charts
                    scopes the viz-series, viz-grid, and viz-other custom properties
                    every chart here reads. Dropping either breaks the chart (0-height,
                    or slices and gridlines falling back to unstyled black). */}
                <div className="chart-container analytics-charts mb-4">
                  <SpecialtyBarChart rows={specialtyData.specialties} language={language} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b-2 border-slate-100">
                        <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('reports.specialty')}</th>
                        <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('reports.total')}</th>
                        <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('reports.completed')}</th>
                        <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('reports.completionRate')}</th>
                        <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('reports.avgWait')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {specialtyData.specialties.map((r) => (
                        <tr key={r.specialty_id} className="border-b border-slate-100">
                          <td className={TD} style={{ color: 'var(--text-primary)' }} dir="auto">
                            {language === 'ar' && r.specialty_name_ar ? r.specialty_name_ar : r.specialty_name}
                          </td>
                          <td className={TD} style={{ color: 'var(--text-secondary)' }}>{r.total_appointments}</td>
                          <td className={TD} style={{ color: 'var(--text-secondary)' }}>{r.completed}</td>
                          <td className={TD} style={{ color: 'var(--text-secondary)' }}>{r.completion_rate}%</td>
                          <td className={TD} style={{ color: 'var(--text-secondary)' }}>{r.avg_wait_minutes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          <div className={CARD}>
            <h2 className="patient-text-card-title" style={{ color: 'var(--text-primary)' }}>{t('reports.specialtyTrend')}</h2>
            <p className="patient-text-body-secondary mb-3" style={{ color: 'var(--text-muted)' }}>{t('reports.trendFixedWindow')}</p>
            {isSpecialtyLoading || !specialtyData ? (
              <CenteredSpinner />
            ) : (
              <div className="chart-container analytics-charts">
                <SpecialtyTrendLineChart points={specialtyData.monthly_trend} language={language} />
              </div>
            )}
          </div>

          <div className={CARD}>
            <h2 className="patient-text-card-title mb-3" style={{ color: 'var(--text-primary)' }}>{t('reports.topDiagnoses')}</h2>
            {!diagnosisData || diagnosisData.diagnoses.length === 0 ? (
              <p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{t('reports.noDiagnoses')}</p>
            ) : (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="chart-container analytics-charts">
                  <DiagnosisPieChart diagnoses={diagnosisData.diagnoses} language={language} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b-2 border-slate-100">
                        <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('reports.diagnosis')}</th>
                        <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('reports.count')}</th>
                        <th className={TH} />
                      </tr>
                    </thead>
                    <tbody>
                      {diagnosisData.diagnoses.map((d) => (
                        <tr key={d.name} className="border-b border-slate-100">
                          <td className={TD} style={{ color: 'var(--text-primary)' }} dir="auto">
                            {language === 'ar' && d.name_ar ? d.name_ar : d.name}
                            {d.icd10_code && <span style={{ color: 'var(--text-muted)' }}> ({d.icd10_code})</span>}
                          </td>
                          <td className={TD} style={{ color: 'var(--text-secondary)' }}>{d.count}</td>
                          <td className="w-2/5 px-3 py-2.5"><Bar pct={(d.count / maxDiagnosis) * 100} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <div className={CARD}>
            <h2 className="patient-text-card-title mb-3" style={{ color: 'var(--text-primary)' }}>{t('reports.labAnalytics')}</h2>
            {isLabLoading || !labData ? (
              <CenteredSpinner />
            ) : labData.tests.length === 0 ? (
              <p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{t('reports.noLabData')}</p>
            ) : (
              <>
                <KpiRow
                  items={[
                    { label: t('reports.totalOrders'), value: labData.total_lab_orders },
                    { label: t('reports.avgTurnaround'), value: labData.overall_avg_turnaround_hours ?? '—' },
                    { label: t('reports.abnormalRate'), value: `${labData.abnormal_result_pct}%` },
                  ]}
                />
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b-2 border-slate-100">
                        <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('reports.testName')}</th>
                        <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('reports.count')}</th>
                        <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('reports.avgTurnaround')}</th>
                        <th className={TH} style={{ color: 'var(--text-muted)' }}>{t('reports.abnormalRate')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {labData.tests.map((row) => (
                        <tr key={row.test_name} className="border-b border-slate-100">
                          <td className={TD} style={{ color: 'var(--text-primary)' }}>{row.test_name}</td>
                          <td className={TD} style={{ color: 'var(--text-secondary)' }}>{row.count}</td>
                          <td className={TD} style={{ color: 'var(--text-secondary)' }}>{row.avg_turnaround_hours ?? '—'}</td>
                          <td className={TD} style={{ color: 'var(--text-secondary)' }}>{row.abnormal_pct}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
