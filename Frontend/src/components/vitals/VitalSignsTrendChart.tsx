import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Select } from '../primitives/Select'
import { getVitalAlertLevel } from '../../services/vitals.utils'
import type { VitalSigns } from '../../services/types'

type TrendMetric = 'bp_systolic' | 'heart_rate' | 'oxygen_saturation' | 'temperature' | 'bmi'

const METRICS: TrendMetric[] = ['bp_systolic', 'heart_rate', 'oxygen_saturation', 'temperature', 'bmi']

const ALERT_COLORS: Record<'normal' | 'warning' | 'danger', string> = {
  normal: 'var(--primary)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
}

function extractValue(record: VitalSigns, metric: TrendMetric): number | null {
  if (metric === 'temperature') return parseFloat(record.temperature)
  if (metric === 'bmi') return record.bmi
  return record[metric] as number
}

interface TrendChartProps {
  data: VitalSigns[]
  defaultMetric?: TrendMetric
}

export function VitalSignsTrendChart({ data, defaultMetric = 'bp_systolic' }: TrendChartProps) {
  const { t } = useTranslation()
  const [metric, setMetric] = useState<TrendMetric>(defaultMetric)

  // API returns newest-first; chart plots oldest-first
  const chronological = [...data].reverse()

  const points = chronological
    .map((r) => extractValue(r, metric))
    .filter((v): v is number => v != null)

  const metricOptions = METRICS.map((m) => ({
    value: m,
    label: t(`vitals.metric${m.charAt(0).toUpperCase()}${m.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase())}` as Parameters<typeof t>[0]),
  }))

  if (points.length < 2) {
    return (
      <div className="vitals-trend">
        <div className="vitals-trend__header">
          <h3 className="vitals-trend__title">{t('vitals.trend')}</h3>
          <Select
            options={metricOptions}
            value={metric}
            onChange={(v) => setMetric(v as TrendMetric)}
          />
        </div>
        <p className="vitals-trend__no-data">{t('vitals.noTrendData')}</p>
      </div>
    )
  }

  const W = 600
  const H = 160
  const PAD = { top: 16, right: 24, bottom: 28, left: 40 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  const minVal = Math.min(...points)
  const maxVal = Math.max(...points)
  const range = maxVal - minVal || 1

  const toX = (i: number) => PAD.left + (i / (points.length - 1)) * innerW
  const toY = (v: number) => PAD.top + innerH - ((v - minVal) / range) * innerH

  const polylinePoints = points.map((v, i) => `${toX(i)},${toY(v)}`).join(' ')

  // Color by worst alert level in dataset
  const worstLevel = points.reduce<'normal' | 'warning' | 'danger'>((acc, v) => {
    const lvl = getVitalAlertLevel(metric, v)
    if (lvl === 'danger') return 'danger'
    if (lvl === 'warning' && acc !== 'danger') return 'warning'
    return acc
  }, 'normal')

  const strokeColor = ALERT_COLORS[worstLevel]

  const yLabels = [minVal, (minVal + maxVal) / 2, maxVal]

  return (
    <div className="vitals-trend">
      <div className="vitals-trend__header">
        <h3 className="vitals-trend__title">{t('vitals.trend')}</h3>
        <Select
          options={metricOptions}
          value={metric}
          onChange={(v) => setMetric(v as TrendMetric)}
        />
      </div>
      <div className="vitals-trend__svg-wrap">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          aria-label={t('vitals.trend')}
          role="img"
        >
          {/* Y-axis labels */}
          {yLabels.map((label, i) => {
            const y = toY(label)
            return (
              <g key={i}>
                <line
                  x1={PAD.left}
                  y1={y}
                  x2={W - PAD.right}
                  y2={y}
                  stroke="var(--border)"
                  strokeWidth={1}
                  strokeDasharray="4 4"
                />
                <text
                  x={PAD.left - 6}
                  y={y + 4}
                  textAnchor="end"
                  fontSize={11}
                  fill="var(--text-muted)"
                >
                  {typeof label === 'number' ? label.toFixed(metric === 'temperature' ? 1 : 0) : label}
                </text>
              </g>
            )
          })}

          {/* X-axis labels (first and last date skipped — just show index) */}
          <text x={PAD.left} y={H - 4} fontSize={11} fill="var(--text-muted)">1</text>
          <text x={W - PAD.right} y={H - 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">
            {points.length}
          </text>

          {/* Polyline */}
          <polyline
            points={polylinePoints}
            fill="none"
            stroke={strokeColor}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Data point circles */}
          {points.map((v, i) => (
            <circle
              key={i}
              cx={toX(i)}
              cy={toY(v)}
              r={4}
              fill={strokeColor}
              stroke="var(--bg)"
              strokeWidth={1.5}
            >
              <title>{v.toFixed(metric === 'temperature' ? 1 : 0)}</title>
            </circle>
          ))}
        </svg>
      </div>
    </div>
  )
}
