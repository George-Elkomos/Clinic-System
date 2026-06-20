import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Card } from '../../components/primitives/Card'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { VitalSignsHistory } from '../../components/vitals/VitalSignsHistory'
import { VitalSignsTrendChart } from '../../components/vitals/VitalSignsTrendChart'
import { useAuth } from '../../hooks/useAuth'
import { vitalsApi } from '../../services/vitals.api'

export function PatientVitalSignsTab() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const patientId = user?.patient_profile?.id

  const { data: trend = [], isLoading } = useQuery({
    queryKey: ['vitals', patientId, 'trend'],
    queryFn: () => vitalsApi.trend(patientId!),
    enabled: patientId != null,
    staleTime: 30_000,
    retry: 1,
  })

  if (!patientId) return <CenteredSpinner />
  if (isLoading) return <CenteredSpinner />

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('vitals.title') }]} />
      <h1>{t('vitals.title')}</h1>

      {trend.length >= 2 && (
        <Card>
          <VitalSignsTrendChart data={trend} />
        </Card>
      )}

      <Card title={t('vitals.history')}>
        <VitalSignsHistory patientId={patientId} readOnly />
      </Card>
    </div>
  )
}
