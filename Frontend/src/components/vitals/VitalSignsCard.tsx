import { useTranslation } from 'react-i18next'

import { Button } from '../primitives/Button'
import { getVitalAlertLevel, vitalBadgeClass } from '../../services/vitals.utils'
import { formatDate } from '../../lib/format'
import { useLanguage } from '../../hooks/useLanguage'
import type { VitalSigns } from '../../services/types'

interface VitalSignsCardProps {
  record: VitalSigns
  onEdit?: () => void
  onDelete?: () => void
  editLocked?: boolean
}

interface MetricTileProps {
  label: string
  value: string | number
  unit?: string
  alertClass: string
}

function MetricTile({ label, value, unit, alertClass }: MetricTileProps) {
  return (
    <div className={`vitals-card__item${alertClass ? ` ${alertClass}` : ''}`}>
      <div className="vitals-card__item-label">{label}</div>
      <div>
        <span className="vitals-card__item-value">{value}</span>
        {unit && <span className="vitals-card__item-unit">{unit}</span>}
      </div>
    </div>
  )
}

export function VitalSignsCard({ record, onEdit, onDelete, editLocked = false }: VitalSignsCardProps) {
  const { t } = useTranslation()
  const { language } = useLanguage()

  const temp = parseFloat(record.temperature)
  const weight = parseFloat(record.weight)

  return (
    <div className="vitals-history__item">
      <div className="vitals-card__meta">
        {record.recorded_by_name && (
          <>
            {t('vitals.recordedBy')} <strong>{record.recorded_by_name}</strong>{' '}
          </>
        )}
        {t('vitals.recordedOn')} {formatDate(record.created_at, language)}
      </div>

      <div className="vitals-card__grid">
        <MetricTile
          label={t('vitals.metricBpSystolic')}
          value={`${record.bp_systolic}/${record.bp_diastolic}`}
          unit={t('vitals.unitMmhg')}
          alertClass={vitalBadgeClass(getVitalAlertLevel('bp_systolic', record.bp_systolic))}
        />
        <MetricTile
          label={t('vitals.metricHeartRate')}
          value={record.heart_rate}
          unit={t('vitals.unitBpm')}
          alertClass={vitalBadgeClass(getVitalAlertLevel('heart_rate', record.heart_rate))}
        />
        <MetricTile
          label={t('vitals.temperature')}
          value={temp.toFixed(1)}
          unit={t('vitals.unitCelsius')}
          alertClass={vitalBadgeClass(getVitalAlertLevel('temperature', temp))}
        />
        <MetricTile
          label={t('vitals.respiratoryRate')}
          value={record.respiratory_rate}
          unit="/min"
          alertClass={vitalBadgeClass(getVitalAlertLevel('respiratory_rate', record.respiratory_rate))}
        />
        <MetricTile
          label={t('vitals.oxygenSaturation')}
          value={record.oxygen_saturation}
          unit={t('vitals.unitPercent')}
          alertClass={vitalBadgeClass(getVitalAlertLevel('oxygen_saturation', record.oxygen_saturation))}
        />
        <MetricTile
          label={t('vitals.weight')}
          value={weight.toFixed(1)}
          unit={t('vitals.unitKg')}
          alertClass=""
        />
        <MetricTile
          label={t('vitals.height')}
          value={record.height}
          unit={t('vitals.unitCm')}
          alertClass=""
        />
        {record.bmi != null && (
          <MetricTile
            label={t('vitals.bmi')}
            value={record.bmi.toFixed(1)}
            alertClass={vitalBadgeClass(getVitalAlertLevel('bmi', record.bmi))}
          />
        )}
        {record.blood_glucose != null && (
          <MetricTile
            label={t('vitals.bloodGlucose')}
            value={record.blood_glucose}
            unit={t('vitals.unitMgdl')}
            alertClass={vitalBadgeClass(getVitalAlertLevel('blood_glucose', record.blood_glucose))}
          />
        )}
      </div>

      {record.notes && <p style={{ marginBottom: 'var(--space-3)' }}>{record.notes}</p>}

      {(onEdit || editLocked || onDelete) && (
        <div className="vitals-card__actions">
          {(onEdit || editLocked) && (
            <span title={editLocked ? t('vitals.editLockedTooltip') : undefined}>
              <Button
                variant="secondary"
                onClick={editLocked ? undefined : onEdit}
                disabled={editLocked}
              >
                {t('common.edit')}
              </Button>
            </span>
          )}
          {onDelete && (
            <Button variant="danger" onClick={onDelete}>
              {t('medical.delete')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
