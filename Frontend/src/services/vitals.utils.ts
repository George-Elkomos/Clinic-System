import type { VitalAlertLevel, VitalSigns } from './types'

type VitalField =
  | 'bp_systolic'
  | 'bp_diastolic'
  | 'heart_rate'
  | 'temperature'
  | 'respiratory_rate'
  | 'oxygen_saturation'
  | 'weight'
  | 'height'
  | 'bmi'
  | 'blood_glucose'

export function getVitalAlertLevel(field: VitalField, value: number): VitalAlertLevel {
  switch (field) {
    case 'oxygen_saturation':
      if (value < 90) return 'danger'
      if (value < 95) return 'warning'
      return 'normal'

    case 'heart_rate':
      if (value < 40 || value > 150) return 'danger'
      if (value < 60 || value > 100) return 'warning'
      return 'normal'

    case 'bp_systolic':
      if (value > 180 || value < 70) return 'danger'
      if (value > 140 || value < 90) return 'warning'
      return 'normal'

    case 'bp_diastolic':
      if (value > 120 || value < 40) return 'danger'
      if (value > 90 || value < 60) return 'warning'
      return 'normal'

    case 'temperature':
      if (value > 39 || value < 35) return 'danger'
      if (value > 37.5 || value < 36) return 'warning'
      return 'normal'

    case 'respiratory_rate':
      if (value > 30 || value < 8) return 'danger'
      if (value > 20 || value < 12) return 'warning'
      return 'normal'

    case 'bmi':
      if (value > 35 || value < 16) return 'danger'
      if (value > 30 || value < 18.5) return 'warning'
      return 'normal'

    case 'blood_glucose':
      if (value > 200 || value < 70) return 'danger'
      if (value > 140) return 'warning'
      return 'normal'

    default:
      return 'normal'
  }
}

export function vitalBadgeClass(level: VitalAlertLevel): string {
  if (level === 'danger') return 'vitals-card__item--danger'
  if (level === 'warning') return 'vitals-card__item--warning'
  return ''
}

export function hasAbnormalVitals(v: VitalSigns): boolean {
  const checks: [VitalField, number][] = [
    ['bp_systolic', v.bp_systolic],
    ['bp_diastolic', v.bp_diastolic],
    ['heart_rate', v.heart_rate],
    ['temperature', parseFloat(v.temperature)],
    ['respiratory_rate', v.respiratory_rate],
    ['oxygen_saturation', v.oxygen_saturation],
  ]
  if (v.bmi != null) checks.push(['bmi', v.bmi])
  if (v.blood_glucose != null) checks.push(['blood_glucose', v.blood_glucose])
  return checks.some(([field, val]) => getVitalAlertLevel(field, val) !== 'normal')
}
