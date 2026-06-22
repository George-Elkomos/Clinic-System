import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Card } from '../../components/primitives/Card'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { PatientTimeline } from '../../components/timeline/PatientTimeline'
import { useAuth } from '../../hooks/useAuth'

export function PatientTimelinePage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const patientId = user?.patient_profile?.id

  if (!patientId) return <CenteredSpinner />

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('timeline.title') }]} />
      <h1>{t('timeline.title')}</h1>
      <Card>
        <PatientTimeline patientId={patientId} />
      </Card>
    </div>
  )
}
