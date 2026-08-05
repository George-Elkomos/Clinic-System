import { useTranslation } from 'react-i18next'
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

import type { DiagnosisDistribution } from '../../services/types'

interface TooltipContentProps {
  active?: boolean
  payload?: { name?: string; value?: number }[]
}

// Same validated categorical order as the trend chart (see analytics.css) —
// a Top-N-by-period pie has no persistent per-entity identity to preserve
// across period changes, so slots are assigned simply by rank here.
const SLICE_COLORS = [
  'var(--viz-series-1)', 'var(--viz-series-2)', 'var(--viz-series-3)', 'var(--viz-series-4)',
  'var(--viz-series-5)', 'var(--viz-series-6)', 'var(--viz-series-7)', 'var(--viz-series-8)',
]
const MAX_SLICES = SLICE_COLORS.length

function PieTooltip({ active, payload }: TooltipContentProps) {
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

export function DiagnosisPieChart({
  diagnoses,
  language,
}: {
  diagnoses: DiagnosisDistribution['diagnoses']
  language: string
}) {
  const { t } = useTranslation()
  if (diagnoses.length === 0) return null

  const top = diagnoses.slice(0, MAX_SLICES)
  const rest = diagnoses.slice(MAX_SLICES)
  const restTotal = rest.reduce((sum, d) => sum + d.count, 0)

  const data = top.map((d) => ({
    name: language === 'ar' && d.name_ar ? d.name_ar : d.name,
    value: d.count,
  }))
  if (restTotal > 0) {
    data.push({ name: t('reports.other'), value: restTotal })
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" outerRadius="75%" stroke="var(--bg)" strokeWidth={2}>
          {data.map((entry, i) => (
            <Cell key={entry.name} fill={i < top.length ? SLICE_COLORS[i] : 'var(--viz-other)'} />
          ))}
        </Pie>
        <Tooltip content={<PieTooltip />} />
        <Legend formatter={(value: string) => <span dir="auto" style={{ color: 'var(--text-muted)' }}>{value}</span>} />
      </PieChart>
    </ResponsiveContainer>
  )
}
