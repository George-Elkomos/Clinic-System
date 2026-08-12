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
    <div className="mb-5 flex min-w-max items-center overflow-x-auto pb-1" role="list" aria-label={t('lab.status')}>
      {STEPS.map((step, i) => {
        const isDone = i < currentIndex
        const isActive = i === currentIndex

        return (
          <div key={step} className="flex items-center" role="listitem">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  isDone
                    ? 'bg-gradient-to-r from-[#1AB5B3] to-[#38E4DD] text-white'
                    : isActive
                    ? 'border-2 border-[#1AB5B3] text-[#0D9488]'
                    : 'border border-slate-200 text-slate-400'
                }`}
              >
                {isDone ? '✓' : i + 1}
              </div>
              <div
                className={`patient-text-overline whitespace-nowrap ${isDone || isActive ? '' : ''}`}
                style={{ color: isDone || isActive ? 'var(--brand-teal-start)' : 'var(--text-muted)' }}
              >
                {t(`status.${step}`)}
              </div>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`mx-2 h-0.5 w-8 shrink-0 sm:w-12 ${isDone ? 'bg-[#38E4DD]' : 'bg-slate-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
