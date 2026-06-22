import { type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}

/** Lightweight modal reusing the shared `.modal__backdrop` / `.modal` styles. */
export function Modal({ title, onClose, children, wide = false }: ModalProps) {
  const { t } = useTranslation()
  return (
    <div
      className="modal__backdrop"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className={`modal${wide ? ' modal--wide' : ''}`}>
        <div className="modal__header">
          <h2 className="modal__title">{title}</h2>
          <button className="modal__close" onClick={onClose} aria-label={t('common.cancel')}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}
