import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { AsyncCombobox, type ComboOption } from '../primitives/AsyncCombobox'
import { Button } from '../primitives/Button'
import { FormField } from '../primitives/FormField'
import { Select } from '../primitives/Select'
import { dosageFormsApi, dosagePatternsApi, medicationsApi } from '../../services/medications.api'
import type { PrescriptionItem } from '../../services/types'

const medicationFetcher = (q: string): Promise<ComboOption[]> =>
  medicationsApi.search(q).then((rows) => rows.map((m) => ({ value: m.id, label: m.name })))

interface Props {
  item: PrescriptionItem
  onChange: (patch: Partial<PrescriptionItem>) => void
  onRemove?: () => void
  canRemove?: boolean
  disabled?: boolean
}

/**
 * One prescription line backed by the medication master. The drug is chosen via
 * an async typeahead; unlisted drugs fall back to a free-text name. Dosage form
 * and pattern come from reference dropdowns. `dosage_strength` mirrors into the
 * legacy `dosage` field and the chosen pattern mirrors into `frequency` so the
 * existing PDF / timeline / free-text consumers keep working unchanged.
 */
export function MedicationItemRow({ item, onChange, onRemove, canRemove = false, disabled = false }: Props) {
  const { t } = useTranslation()
  const { data: forms = [] } = useQuery({
    queryKey: ['dosage-forms'], queryFn: dosageFormsApi.list, staleTime: 300_000,
  })
  const { data: patterns = [] } = useQuery({
    queryKey: ['dosage-patterns'], queryFn: dosagePatternsApi.list, staleTime: 300_000,
  })

  const medValue: ComboOption | null = item.medication
    ? { value: item.medication, label: item.medication_name || item.drug_name }
    : null

  return (
    <div className="medical-rx-item">
      <div className="medical-rx-field--wide">
        <FormField label={t('medical.medication')}>
          {(p) => (
            <AsyncCombobox
              id={p.id}
              value={medValue}
              fetcher={medicationFetcher}
              placeholder={t('medications.searchPlaceholder')}
              disabled={disabled}
              onChange={(opt) =>
                onChange(opt
                  ? { medication: opt.value, medication_name: opt.label, drug_name: opt.label }
                  : { medication: null, medication_name: '', drug_name: '' })
              }
            />
          )}
        </FormField>
        {!item.medication && (
          <input
            className="medication-row__freetext"
            placeholder={t('medications.freeTextHint')}
            value={item.drug_name}
            disabled={disabled}
            onChange={(e) => onChange({ drug_name: e.target.value })}
          />
        )}
      </div>

      <div className="medical-rx-field">
        <FormField label={t('medications.strength')}>
          {(p) => (
            <input
              {...p}
              value={item.dosage_strength ?? ''}
              disabled={disabled}
              onChange={(e) => onChange({ dosage_strength: e.target.value, dosage: e.target.value })}
            />
          )}
        </FormField>
      </div>

      <div className="medical-rx-field--mid">
        <FormField label={t('medications.dosageForm')}>
          {(p) => (
            <Select
              id={p.id}
              disabled={disabled}
              placeholder={t('medications.selectForm')}
              options={forms.map((f) => ({ value: f.id, label: f.name }))}
              value={item.dosage_form ?? ''}
              onChange={(v) => onChange({ dosage_form: Array.isArray(v) ? null : Number(v) || null })}
            />
          )}
        </FormField>
      </div>

      <div className="medical-rx-field--mid">
        <FormField label={t('medications.dosagePattern')}>
          {(p) => (
            <Select
              id={p.id}
              disabled={disabled}
              placeholder={t('medications.selectPattern')}
              options={patterns.map((pt) => ({ value: pt.id, label: pt.name }))}
              value={item.dosage_pattern ?? ''}
              onChange={(v) => {
                const id = Array.isArray(v) ? null : Number(v) || null
                const chosen = patterns.find((pt) => pt.id === id)
                onChange({ dosage_pattern: id, frequency: chosen ? chosen.name : item.frequency })
              }}
            />
          )}
        </FormField>
      </div>

      <div className="medical-rx-field">
        <FormField label={t('medical.duration')}>
          {(p) => (
            <input
              {...p}
              value={item.duration}
              disabled={disabled}
              onChange={(e) => onChange({ duration: e.target.value })}
            />
          )}
        </FormField>
      </div>

      {canRemove && onRemove && (
        <Button variant="secondary" onClick={onRemove} disabled={disabled}>
          {t('medical.removeItem')}
        </Button>
      )}
    </div>
  )
}
