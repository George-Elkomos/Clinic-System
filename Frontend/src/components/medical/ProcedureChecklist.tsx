import { useTranslation } from 'react-i18next'

import type { ProcedureChecklistItem } from '../../services/types'

interface Props {
  items: ProcedureChecklistItem[]
  onToggle: (index: number) => void
  disabled?: boolean
}

/** Plain checkbox list for a procedure's checklist_state — no shared Checkbox
 * primitive exists in this codebase, so this follows the raw-`<input>` pattern
 * already used for lab result flags (.lab-flags-row / .lab-flag-check). */
export function ProcedureChecklist({ items, onToggle, disabled = false }: Props) {
  const { t } = useTranslation()

  if (items.length === 0) {
    return <p className="encounter-none">{t('procedures.noChecklist')}</p>
  }

  return (
    <ul className="procedure-checklist">
      {items.map((item, idx) => (
        <li key={idx}>
          <label className={`procedure-checklist-item${item.completed ? ' procedure-checklist-item--done' : ''}`}>
            <input
              type="checkbox"
              checked={!!item.completed}
              disabled={disabled}
              onChange={() => onToggle(idx)}
            />
            <span className="procedure-checklist-item__label">{item.step}</span>
            {item.required && <span className="procedure-checklist-item__required">*</span>}
          </label>
        </li>
      ))}
    </ul>
  )
}
