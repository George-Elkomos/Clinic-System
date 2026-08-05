import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { localizedName } from '../../lib/format'
import type { MonthlyTrendPoint } from '../../services/types'

interface TooltipContentProps {
  active?: boolean
  label?: string
  payload?: { name?: string; value?: number; color?: string; dataKey?: string }[]
}

// The dataviz-skill validated categorical order (8 hues, fixed sequence) —
// see analytics.css. Color is assigned by specialty_id (a stable identity),
// never by volume rank, so a specialty keeps its color across period/filter
// changes. Past 8 distinct specialties, the rest fold into a de-emphasized
// "Other" line (the skill's series-count token ceiling).
const SERIES_COLORS = [
  'var(--viz-series-1)', 'var(--viz-series-2)', 'var(--viz-series-3)', 'var(--viz-series-4)',
  'var(--viz-series-5)', 'var(--viz-series-6)', 'var(--viz-series-7)', 'var(--viz-series-8)',
]
const MAX_SERIES = SERIES_COLORS.length

function formatMonth(month: string, language: string) {
  const [y, m] = month.split('-').map(Number)
  return new Intl.DateTimeFormat(language === 'ar' ? 'ar' : 'en', { year: 'numeric', month: 'short' }).format(
    new Date(y, m - 1, 1),
  )
}

function TrendTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="viz-tooltip">
      <div className="viz-tooltip__label">{label}</div>
      {payload.map((p) => (
        <div className="viz-tooltip__row" key={p.dataKey}>
          <span className="viz-tooltip__swatch" style={{ background: p.color }} />
          <span className="viz-tooltip__label">{p.name}</span>
          <span className="viz-tooltip__value">{p.value}</span>
        </div>
      ))}
    </div>
  )
}


export function SpecialtyTrendLineChart({ points, language }: { points: MonthlyTrendPoint[]; language: string }) {
  const { t } = useTranslation()

  const { data, seriesKeys, seriesLabels } = useMemo(() => {
    if (points.length === 0) {
      return { data: [] as Record<string, string | number>[], seriesKeys: [] as string[], seriesLabels: {} as Record<string, string> }
    }

    const uniqueIds = Array.from(new Set(points.map((p) => p.specialty_id))).sort((a, b) => a - b)
    const kept = new Set(uniqueIds.slice(0, MAX_SERIES))
    const hasOther = uniqueIds.length > MAX_SERIES

    const names = new Map<number, string>()
    points.forEach((p) => {
      if (!names.has(p.specialty_id)) {
        names.set(p.specialty_id, localizedName({ name: p.specialty_name, name_ar: p.specialty_name_ar }, language))
      }
    })

    const months = Array.from(new Set(points.map((p) => p.month))).sort()
    const byMonth = new Map<string, Record<string, number>>()
    months.forEach((m) => byMonth.set(m, {}))
    points.forEach((p) => {
      const key = kept.has(p.specialty_id) ? `s${p.specialty_id}` : 'other'
      const row = byMonth.get(p.month)!
      row[key] = (row[key] ?? 0) + p.count
    })

    const seriesKeys = uniqueIds.filter((id) => kept.has(id)).map((id) => `s${id}`)
    if (hasOther) seriesKeys.push('other')

    const seriesLabels: Record<string, string> = {}
    uniqueIds.forEach((id) => {
      if (kept.has(id)) seriesLabels[`s${id}`] = names.get(id) ?? String(id)
    })
    if (hasOther) seriesLabels.other = t('reports.other')

    const data = months.map((m) => ({ month: formatMonth(m, language), ...byMonth.get(m) }))
    return { data, seriesKeys, seriesLabels }
  }, [points, language, t])

  if (data.length === 0) {
    return <p className="chart-empty">{t('reports.noTrendData')}</p>
  }

  // Direct end-of-line labels only when few enough series to not collide
  // (marks-and-anatomy: "past ~4 converging series, fall back to legend +
  // tooltip"). The legend and tooltip always carry every series regardless.
  const showEndLabels = seriesKeys.length <= 4

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 32, left: 0, bottom: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--viz-grid)" strokeDasharray="0" />
        <XAxis
          dataKey="month"
          tick={{ fill: 'var(--text-muted)', fontSize: 13 }}
          axisLine={{ stroke: 'var(--viz-grid)' }}
          tickLine={false}
        />
        <YAxis allowDecimals={false} tick={{ fill: 'var(--text-muted)', fontSize: 13 }} axisLine={false} tickLine={false} />
        <Tooltip content={<TrendTooltip />} />
        <Legend
          iconType="plainline"
          // `value` here is already the resolved label (each Line's `name` prop
          // below), not the raw dataKey — render it directly rather than
          // re-indexing seriesLabels a second time.
          formatter={(value: string) => <span style={{ color: 'var(--text-muted)' }}>{value}</span>}
        />
        {seriesKeys.map((key, i) => {
          const color = key === 'other' ? 'var(--viz-other)' : SERIES_COLORS[i]
          return (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              name={seriesLabels[key]}
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
              dot={{ r: 4, strokeWidth: 2, stroke: 'var(--bg)', fill: color }}
              connectNulls
              label={
                showEndLabels
                  ? // Recharts' label render-prop type is a moving target across versions;
                    // read the few fields this renderer needs off the props object at runtime.
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (props: any) => {
                      if (props.index !== data.length - 1 || props.value == null) return <></>
                      const x = Number(props.x ?? 0) + 6
                      return (
                        <text x={x} y={props.y} dy={4} fill={color} fontSize={12} textAnchor="start">
                          {props.value}
                        </text>
                      )
                    }
                  : false
              }
            />
          )
        })}
      </LineChart>
    </ResponsiveContainer>
  )
}
