import { useTranslation } from 'react-i18next'

import { Button } from '../primitives/Button'
import { Modal } from '../primitives/Modal'
import { useLanguage } from '../../hooks/useLanguage'
import type { AllergyInteractionWarning } from '../../services/types'

interface Props {
  warnings: AllergyInteractionWarning[]
  onProceed: () => void
  onCancel: () => void
  loading?: boolean
}

/** Blocking allergy-warning modal shown before a prescription is issued. */
export function InteractionWarningModal({ warnings, onProceed, onCancel, loading }: Props) {
  const { t } = useTranslation()
  const { language } = useLanguage()

  return (
    <Modal title={t('medications.interactionTitle')} onClose={onCancel}>
      <p className="medication-warning__intro">
        {t('medications.interactionIntro', { count: warnings.length })}
      </p>
      <ul className="medication-warning__list">
        {warnings.map((w, idx) => (
          <li key={idx} className={`medication-warning__item medication-warning__item--${w.severity}`}>
            <div className="medication-warning__head">
              <strong dir="ltr">{w.medication_name}</strong>
              <span className={`badge badge--${w.severity}`}>{t(`medications.severity.${w.severity}`)}</span>
            </div>
            <div className="medication-warning__msg">
              {language === 'ar' && w.message_ar ? w.message_ar : w.message}
            </div>
            <div className="medication-warning__meta">
              {t('medications.allergyMatch', { keyword: w.allergy_keyword })}
            </div>
          </li>
        ))}
      </ul>
      <div className="modal__actions">
        <Button variant="secondary" onClick={onCancel}>{t('common.cancel')}</Button>
        <Button variant="danger" loading={loading} onClick={onProceed}>{t('medications.proceedAnyway')}</Button>
      </div>
    </Modal>
  )
}
