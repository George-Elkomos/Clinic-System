import { Activity, Droplet, Droplets, Gauge, Heart, Ruler, Scale, Thermometer, Wind } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { getVitalAlertLevel } from '../../services/vitals.utils'
import { formatDate } from '../../lib/format'
import { useLanguage } from '../../hooks/useLanguage'
import type { VitalAlertLevel, VitalSigns } from '../../services/types'

const BTN_SECONDARY_SM = 'inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-60'
const BTN_DANGER_SM = 'inline-flex items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-600 transition-all hover:bg-rose-100 disabled:opacity-60'

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

interface VitalSignsCardProps {
  record: VitalSigns
  onEdit?: () => void
  onDelete?: () => void
  editLocked?: boolean
}

export function VitalSignsCard({ record: v, onEdit, onDelete, editLocked = false }: VitalSignsCardProps) {
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
    <div className="mb-4 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-slate-800">
        <Activity className="h-4 w-4 shrink-0 text-[#0D9488]" aria-hidden="true" />
        {v.recorded_by_name && (
          <>{t('vitals.recordedBy')} {v.recorded_by_name}</>
        )}
        <span className="font-normal text-slate-400">{t('vitals.recordedOn')} {formatDate(v.created_at, language)}</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
        {tiles.map((tile) => (
          <MetricTile key={tile.key} tile={tile} />
        ))}
      </div>

      {v.notes && <div className="mt-4 text-xs text-slate-500 sm:text-sm">{v.notes}</div>}

      {(onEdit || editLocked || onDelete) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {(onEdit || editLocked) && (
            <span title={editLocked ? t('vitals.editLockedTooltip') : undefined}>
              <button
                type="button"
                onClick={editLocked ? undefined : onEdit}
                disabled={editLocked}
                className={BTN_SECONDARY_SM}
              >
                {t('common.edit')}
              </button>
            </span>
          )}
          {onDelete && (
            <button type="button" onClick={onDelete} className={BTN_DANGER_SM}>
              {t('medical.delete')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
