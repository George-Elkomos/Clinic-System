import { useTranslation } from 'react-i18next'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { localizedName } from '../../lib/format'
import type { SpecialtyAnalyticsRow } from '../../services/types'

interface TooltipContentProps {
  active?: boolean
  payload?: { name?: string; value?: number }[]
}

function BarTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null
  const { name, value } = payload[0]
  return (
    <div className="viz-tooltip">
      <div className="viz-tooltip__row">
        <span className="viz-tooltip__label">{name}</span>
        <span className="viz-tooltip__value">{value}</span>
      </div>
    </div>
  )
}

export function SpecialtyBarChart({ rows, language }: { rows: SpecialtyAnalyticsRow[]; language: string }) {
  const { t } = useTranslation()

  if (rows.length === 0) {
    return <p className="chart-empty">{t('reports.noSpecialtyData')}</p>
  }

  const data = [...rows]
    .sort((a, b) => b.total_appointments - a.total_appointments)
    .map((r) => ({
      name: localizedName({ name: r.specialty_name, name_ar: r.specialty_name_ar }, language),
      total: r.total_appointments,
    }))

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--viz-grid)" strokeDasharray="0" />
        <XAxis
          dataKey="name"
          tick={{ fill: 'var(--text-muted)', fontSize: 13 }}
          axisLine={{ stroke: 'var(--viz-grid)' }}
          tickLine={false}
        />
        <YAxis allowDecimals={false} tick={{ fill: 'var(--text-muted)', fontSize: 13 }} axisLine={false} tickLine={false} />
        <Tooltip content={<BarTooltip />} cursor={{ fill: 'var(--surface-2)' }} />
        <Bar dataKey="total" name={t('reports.total')} fill="var(--primary)" barSize={24} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
