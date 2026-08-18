import { useTranslation } from 'react-i18next'

import type { Reliability } from '../services/types'

const STYLES: Record<Reliability['label'], string> = {
  GOOD: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  WATCH: 'bg-amber-50 text-amber-700 border-amber-200/60',
  HIGH_RISK: 'bg-rose-50 text-rose-700 border-rose-200/60',
}

// No-show reliability pill — same {score, label} shape wherever a patient is
// shown (queue cards, patient profile, booking flow), so it always reads the
// same way regardless of which page it's on.
export function ReliabilityBadge({ reliability, className = '' }: { reliability: Reliability; className?: string }) {
  const { t } = useTranslation()
  return (
    <span
      title={t('reliability.tooltip', { score: reliability.score })}
      className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STYLES[reliability.label]} ${className}`}
    >
      {t(`reliability.label.${reliability.label}`)} · {reliability.score}%
    </span>
  )
}

// Prominent standalone warning for the secretary booking flow — renders
// nothing unless the patient is actually HIGH_RISK, so callers can render it
// unconditionally.
export function HighRiskWarningBanner({ reliability }: { reliability: Reliability }) {
  const { t } = useTranslation()
  if (reliability.label !== 'HIGH_RISK') return null
  return (
    <div className="mb-3 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
      <span aria-hidden="true">⚠</span>
      <p className="text-sm font-medium text-rose-700">{t('reliability.highRiskWarning')}</p>
    </div>
  )
}
