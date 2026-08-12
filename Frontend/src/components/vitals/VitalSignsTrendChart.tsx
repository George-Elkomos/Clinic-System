import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { Select } from '../primitives/Select'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate } from '../../lib/format'
import type { VitalSigns } from '../../services/types'

type TrendMetric = 'bp_systolic' | 'heart_rate' | 'oxygen_saturation' | 'temperature' | 'bmi'

const METRICS: TrendMetric[] = ['bp_systolic', 'heart_rate', 'oxygen_saturation', 'temperature', 'bmi']

function metricToPascal(m: string) {
  return m.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join('')
}

function metricValue(v: VitalSigns, metric: TrendMetric): number | null {
  switch (metric) {
    case 'bp_systolic': return v.bp_systolic
    case 'heart_rate': return v.heart_rate
    case 'oxygen_saturation': return v.oxygen_saturation
    case 'temperature': return parseFloat(v.temperature)
    case 'bmi': return v.bmi
  }
}

function metricUnit(metric: TrendMetric, t: (k: string) => string): string {
  switch (metric) {
    case 'bp_systolic': return t('vitals.unitMmhg')
    case 'heart_rate': return t('vitals.unitBpm')
    case 'oxygen_saturation': return t('vitals.unitPercent')
    case 'temperature': return t('vitals.unitCelsius')
    case 'bmi': return ''
  }
}

function CustomTooltip({ active, payload, label, unit }: { active?: boolean; payload?: { value: number }[]; label?: string; unit: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl bg-slate-900 p-2 text-xs text-white shadow-lg">
      <div className="mb-0.5 font-semibold">{label}</div>
      <div>{payload[0].value} {unit}</div>
    </div>
  )
}

interface TrendChartProps {
  data: VitalSigns[]
  defaultMetric?: TrendMetric
}

export function VitalSignsTrendChart({ data, defaultMetric = 'bp_systolic' }: TrendChartProps) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const [metric, setMetric] = useState<TrendMetric>(defaultMetric)

  const chartData = useMemo(() => {
    // API returns newest-first; chart plots oldest-first.
    return [...data]
      .reverse()
      .map((v) => ({ date: formatDate(v.created_at, language), value: metricValue(v, metric) }))
      .filter((d): d is { date: string; value: number } => d.value != null)
  }, [data, metric, language])

  const unit = metricUnit(metric, t)
  const metricOptions = METRICS.map((m) => ({ value: m, label: t(`vitals.metric${metricToPascal(m)}`) }))

  return (
    <div className="mb-5 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="patient-text-card-title" style={{ color: 'var(--text-primary)' }}>{t('vitals.trend')}</h3>
        <div className="w-full sm:w-56">
          <Select
            options={metricOptions}
            value={metric}
            onChange={(v) => setMetric((Array.isArray(v) ? v[0] : v) as TrendMetric)}
          />
        </div>
      </div>

      {chartData.length < 2 ? (
        <div className="flex h-[220px] items-center justify-center patient-text-body-secondary" style={{ color: 'var(--text-muted)' }}>
          {t('vitals.noTrendData')}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={chartData} margin={{ top: 8, right: 25, left: -12, bottom: 15 }}>
            <defs>
              <linearGradient id="doctorVitalsFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#0D9488" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#0D9488" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="#f1f5f9" strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={36} domain={['auto', 'auto']} />
            <Tooltip content={<CustomTooltip unit={unit} />} />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#0D9488"
              strokeWidth={2.5}
              fill="url(#doctorVitalsFill)"
              dot={{ r: 3, fill: '#0D9488', strokeWidth: 0 }}
              activeDot={{ r: 5 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
