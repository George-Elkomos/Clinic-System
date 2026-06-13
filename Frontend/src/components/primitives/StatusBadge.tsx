import { useTranslation } from 'react-i18next'

import type { AppointmentStatus } from '../../services/types'

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const { t } = useTranslation()
  return <span className={`badge badge--${status}`}>{t(`status.${status}`)}</span>
}
