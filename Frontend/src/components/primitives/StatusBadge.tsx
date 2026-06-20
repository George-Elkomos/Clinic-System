import { useTranslation } from 'react-i18next'

import type { AppointmentStatus, LabOrderPriority, LabOrderStatus } from '../../services/types'

type BadgeStatus = AppointmentStatus | LabOrderStatus | LabOrderPriority | string

export function StatusBadge({ status, ns = 'status' }: { status: BadgeStatus; ns?: string }) {
  const { t } = useTranslation()
  return <span className={`badge badge--${status}`}>{t(`${ns}.${status}`)}</span>
}
