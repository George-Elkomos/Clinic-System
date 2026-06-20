import { useTranslation } from 'react-i18next'

import type { LabOrderStatus } from '../../services/types'

const STEPS: LabOrderStatus[] = [
  'DRAFT', 'ORDERED', 'SAMPLE_COLLECTED', 'PROCESSING', 'COMPLETED', 'REVIEWED',
]

interface LabStatusTimelineProps {
  status: LabOrderStatus
}

export function LabStatusTimeline({ status }: LabStatusTimelineProps) {
  const { t } = useTranslation()
  const currentIndex = STEPS.indexOf(status)

  return (
    <div className="lab-timeline" role="list" aria-label={t('lab.status')}>
      {STEPS.map((step, i) => {
        const isDone = i < currentIndex
        const isActive = i === currentIndex
        const modClass = isDone
          ? 'lab-timeline__step--done'
          : isActive
          ? 'lab-timeline__step--active'
          : ''

        return (
          <div key={step} style={{ display: 'flex', alignItems: 'center' }} role="listitem">
            <div className={`lab-timeline__step ${modClass}`}>
              <div className="lab-timeline__dot">{isDone ? '✓' : i + 1}</div>
              <div className="lab-timeline__label">{t(`status.${step}`)}</div>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`lab-timeline__connector${isDone ? ' lab-timeline__connector--done' : ''}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
