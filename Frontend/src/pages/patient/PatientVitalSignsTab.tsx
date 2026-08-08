import { useQuery } from '@tanstack/react-query'
import { Activity, Droplet, Droplets, Gauge, Heart, Ruler, Scale, Thermometer, Wind } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { useAuth } from '../../hooks/useAuth'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate } from '../../lib/format'
import { getVitalAlertLevel } from '../../services/vitals.utils'
import { vitalsApi } from '../../services/vitals.api'
import type { VitalAlertLevel, VitalSigns } from '../../services/types'

const PAGE_SIZE = 5

type MetricKey = 'bp_systolic' | 'heart_rate' | 'oxygen_saturation' | 'temperature' | 'bmi'
const METRICS: MetricKey[] = ['bp_systolic', 'heart_rate', 'oxygen_saturation', 'temperature', 'bmi']

type FieldKey = 'bp_systolic' | 'bp_diastolic' | 'heart_rate' | 'temperature' | 'respiratory_rate' | 'oxygen_saturation' | 'bmi' | 'blood_glucose'

const NORMAL_RANGE: Partial<Record<FieldKey, [number, number]>> = {
  bp_systolic: [90, 140],
  bp_diastolic: [60, 90],
  heart_rate: [60, 100],
  temperature: [36, 37.5],
  respiratory_rate: [12, 20],
  oxygen_saturation: [95, 100],
  bmi: [18.5, 30],
  blood_glucose: [70, 140],
}

const LEVEL_RANK: Record<VitalAlertLevel, number> = { normal: 0, warning: 1, danger: 2 }

function metricToPascal(m: string) {
  return m.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join('')
}

function metricValue(v: VitalSigns, metric: MetricKey): number | null {
  switch (metric) {
    case 'bp_systolic': return v.bp_systolic
    case 'heart_rate': return v.heart_rate
    case 'oxygen_saturation': return v.oxygen_saturation
    case 'temperature': return parseFloat(v.temperature)
    case 'bmi': return v.bmi
  }
}

function metricUnit(metric: MetricKey, t: (k: string) => string): string {
  switch (metric) {
    case 'bp_systolic': return t('vitals.unitMmhg')
    case 'heart_rate': return t('vitals.unitBpm')
    case 'oxygen_saturation': return t('vitals.unitPercent')
    case 'temperature': return t('vitals.unitCelsius')
    case 'bmi': return ''
  }
}

interface Evaluation {
  level: VitalAlertLevel
  direction: 'low' | 'high' | null
}

function evaluate(field: FieldKey, value: number): Evaluation {
  const level = getVitalAlertLevel(field, value)
  if (level === 'normal') return { level, direction: null }
  const range = NORMAL_RANGE[field]
  return { level, direction: range && value < range[0] ? 'low' : 'high' }
}

function worse(a: Evaluation, b: Evaluation): Evaluation {
  return LEVEL_RANK[a.level] >= LEVEL_RANK[b.level] ? a : b
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

function TrendSection({ data }: { data: VitalSigns[] }) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const [metric, setMetric] = useState<MetricKey>('bp_systolic')

  const chartData = useMemo(() => {
    return [...data]
      .reverse()
      .map((v) => ({ date: formatDate(v.created_at, language), value: metricValue(v, metric) }))
      .filter((d): d is { date: string; value: number } => d.value != null)
  }, [data, metric, language])

  const unit = metricUnit(metric, t)

  return (
    <div className="mb-6 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-lg font-bold text-slate-800">{t('vitals.trend')}</div>
        <div className="w-full sm:w-56">
          <Select
            options={METRICS.map((m) => ({ value: m, label: t(`vitals.metric${metricToPascal(m)}`) }))}
            value={metric}
            onChange={(v) => setMetric((Array.isArray(v) ? v[0] : v) as MetricKey)}
          />
        </div>
      </div>

      {chartData.length < 2 ? (
        <div className="flex h-[220px] items-center justify-center text-sm text-slate-400">{t('vitals.noTrendData')}</div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={chartData} margin={{ top: 8, right: 25, left: -12, bottom: 15 }}>
            <defs>
              <linearGradient id="vitalsFill" x1="0" y1="0" x2="0" y2="1">
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
              fill="url(#vitalsFill)"
              dot={{ r: 3, fill: '#0D9488', strokeWidth: 0 }}
              activeDot={{ r: 5 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

interface Tile {
  key: string
  icon: React.ReactNode
  label: string
  value: string
  unit: string
  alert?: Evaluation
  abbr?: string
}

function MetricTile({ tile }: { tile: Tile }) {
  return (
    <div className="flex flex-col justify-between rounded-xl border border-slate-100 bg-slate-50/70 p-3.5 transition-all hover:bg-[#0D9488]/5">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
        <span className="text-[#0D9488]">{tile.icon}</span>
        {tile.label}
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-1.5">
        <span className="text-lg font-extrabold text-slate-800 sm:text-xl">{tile.value}</span>
        {tile.unit && <span className="ms-1 text-xs font-normal text-slate-400">{tile.unit}</span>}
      </div>
      {tile.alert && tile.alert.level !== 'normal' && tile.alert.direction && (
        <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-full border border-rose-100 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600">
          {tile.alert.direction === 'high' ? '↑' : '↓'} {tile.abbr}
        </span>
      )}
    </div>
  )
}

function VitalsEntryCard({ v }: { v: VitalSigns }) {
  const { t } = useTranslation()
  const { language } = useLanguage()

  const bpSys = evaluate('bp_systolic', v.bp_systolic)
  const bpDia = evaluate('bp_diastolic', v.bp_diastolic)
  const bpAlert = worse(bpSys, bpDia)
  const temp = parseFloat(v.temperature)
  const weight = parseFloat(v.weight)

  const tiles: Tile[] = [
    {
      key: 'bp', icon: <Activity className="h-4 w-4" aria-hidden="true" />, label: t('vitals.bp'),
      value: `${v.bp_systolic}/${v.bp_diastolic}`, unit: t('vitals.unitMmhg'), alert: bpAlert, abbr: t('vitals.abbrBp'),
    },
    {
      key: 'hr', icon: <Heart className="h-4 w-4" aria-hidden="true" />, label: t('vitals.metricHeartRate'),
      value: String(v.heart_rate), unit: t('vitals.unitBpm'), alert: evaluate('heart_rate', v.heart_rate), abbr: t('vitals.abbrHeartRate'),
    },
    {
      key: 'temp', icon: <Thermometer className="h-4 w-4" aria-hidden="true" />, label: t('vitals.metricTemperature'),
      value: temp.toFixed(1), unit: t('vitals.unitCelsius'), alert: evaluate('temperature', temp), abbr: t('vitals.abbrTemp'),
    },
    {
      key: 'rr', icon: <Wind className="h-4 w-4" aria-hidden="true" />, label: t('vitals.tileRespRate'),
      value: String(v.respiratory_rate), unit: '/min', alert: evaluate('respiratory_rate', v.respiratory_rate), abbr: t('vitals.abbrRespRate'),
    },
    {
      key: 'spo2', icon: <Droplet className="h-4 w-4" aria-hidden="true" />, label: t('vitals.metricOxygenSaturation'),
      value: String(v.oxygen_saturation), unit: t('vitals.unitPercent'), alert: evaluate('oxygen_saturation', v.oxygen_saturation), abbr: t('vitals.abbrSpo2'),
    },
    {
      key: 'weight', icon: <Scale className="h-4 w-4" aria-hidden="true" />, label: t('vitals.tileWeight'),
      value: weight.toFixed(1), unit: t('vitals.unitKg'),
    },
    {
      key: 'height', icon: <Ruler className="h-4 w-4" aria-hidden="true" />, label: t('vitals.tileHeight'),
      value: String(v.height), unit: t('vitals.unitCm'),
    },
  ]
  if (v.bmi != null) {
    tiles.push({
      key: 'bmi', icon: <Gauge className="h-4 w-4" aria-hidden="true" />, label: t('vitals.metricBmi'),
      value: v.bmi.toFixed(1), unit: '', alert: evaluate('bmi', v.bmi), abbr: t('vitals.abbrBmi'),
    })
  }
  if (v.blood_glucose != null) {
    tiles.push({
      key: 'glucose', icon: <Droplets className="h-4 w-4" aria-hidden="true" />, label: t('vitals.tileGlucose'),
      value: String(v.blood_glucose), unit: t('vitals.unitMgdl'), alert: evaluate('blood_glucose', v.blood_glucose), abbr: t('vitals.abbrGlucose'),
    })
  }

  return (
    <div className="mb-5 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-slate-800">
        <Activity className="h-4 w-4 shrink-0 text-[#0D9488]" aria-hidden="true" />
        {t('vitals.recordedBy')} {v.recorded_by_name}
        <span className="font-normal text-slate-400">{t('vitals.recordedOn')} {formatDate(v.created_at, language)}</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
        {tiles.map((tile) => (
          <MetricTile key={tile.key} tile={tile} />
        ))}
      </div>

      {v.notes && <div className="mt-4 text-xs text-slate-500 sm:text-sm">{v.notes}</div>}
    </div>
  )
}

function EmptyVitalsState() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-100 bg-slate-50/60 p-8 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0D9488]/10 text-[#0D9488]">
        <Activity className="h-6 w-6" aria-hidden="true" />
      </div>
      <span className="text-sm font-medium text-slate-500">{t('vitals.noHistory')}</span>
    </div>
  )
}

function Pager({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  const { t } = useTranslation()
  return (
    <div className="mt-2 flex items-center justify-center gap-3">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40"
      >
        {t('vitals.prevPage')}
      </button>
      <span className="text-xs font-medium text-slate-500">
        {t('vitals.page')} {page} {t('vitals.of')} {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40"
      >
        {t('vitals.nextPage')}
      </button>
    </div>
  )
}

export function PatientVitalSignsTab() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const patientId = user?.patient_profile?.id
  const [page, setPage] = useState(1)

  const { data: trend = [], isLoading: trendLoading } = useQuery({
    queryKey: ['vitals', patientId, 'trend'],
    queryFn: () => vitalsApi.trend(patientId!),
    enabled: patientId != null,
    staleTime: 30_000,
    retry: 1,
  })

  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ['vitals', patientId, 'list', page],
    queryFn: () => vitalsApi.list(patientId!, page, PAGE_SIZE),
    enabled: patientId != null,
    staleTime: 30_000,
    retry: 1,
  })

  if (!patientId) return <CenteredSpinner />

  const records = history?.results ?? []
  const totalPages = history ? Math.max(1, Math.ceil(history.count / PAGE_SIZE)) : 1

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('nav.vitals') }]} />
      {/* PatientShell already renders this same title (hidden lg:block) in its
          own sticky header — shown only below lg so the two never duplicate. */}
      <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>
        {t('nav.vitals')}
      </h1>
      <div className="mt-1 mb-6">
        <p className="text-sm text-slate-500">{t('vitals.pageSubtitle')}</p>
      </div>

      {trendLoading ? <CenteredSpinner /> : <TrendSection data={trend} />}

      <div className="mb-4 text-lg font-bold text-slate-800">{t('vitals.history')}</div>

      {historyLoading ? (
        <CenteredSpinner />
      ) : records.length === 0 ? (
        <EmptyVitalsState />
      ) : (
        <>
          {records.map((v) => (
            <VitalsEntryCard key={v.id} v={v} />
          ))}
          {totalPages > 1 && <Pager page={page} totalPages={totalPages} onChange={setPage} />}
        </>
      )}
    </div>
  )
}
