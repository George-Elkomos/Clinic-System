import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useLanguage } from '../../hooks/useLanguage'
import { localizedName } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { doctorsApi } from '../../services/doctors.api'
import { referralsApi } from '../../services/referrals.api'
import type { ReferralType } from '../../services/types'
import { Button } from '../primitives/Button'
import { FormField } from '../primitives/FormField'
import { Modal } from '../primitives/Modal'
import { Select } from '../primitives/Select'
import { useToast } from '../primitives/Toast'

interface CreateReferralModalProps {
  encounterId: number
  onClose: () => void
}

/** "Refer Patient" modal opened from the encounter workspace. */
export function CreateReferralModal({ encounterId, onClose }: CreateReferralModalProps) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { showToast } = useToast()
  const qc = useQueryClient()

  const [type, setType] = useState<ReferralType>('INTERNAL')
  const [specialty, setSpecialty] = useState<number | ''>('')
  const [targetDoctor, setTargetDoctor] = useState<number | ''>('')
  const [facility, setFacility] = useState('')
  const [reason, setReason] = useState('')
  const [reasonAr, setReasonAr] = useState('')
  const [notes, setNotes] = useState('')
  const [notesAr, setNotesAr] = useState('')

  const { data: specialties = [] } = useQuery({
    queryKey: ['specialties'],
    queryFn: () => doctorsApi.specialties(),
    staleTime: 300_000,
  })

  const { data: doctorsInSpecialty = [] } = useQuery({
    queryKey: ['doctors', 'by-specialty', specialty],
    queryFn: () => doctorsApi.list({ specialties: specialty as number }).then((r) => r.results),
    enabled: type === 'INTERNAL' && specialty !== '',
  })

  const create = useMutation({
    mutationFn: () =>
      referralsApi.create({
        encounter: encounterId,
        referral_type: type,
        specialty: type === 'INTERNAL' && specialty !== '' ? specialty : undefined,
        target_doctor: type === 'INTERNAL' && targetDoctor !== '' ? targetDoctor : undefined,
        external_facility_name: type === 'EXTERNAL' ? facility : undefined,
        reason,
        reason_ar: reasonAr,
        notes,
        notes_ar: notesAr,
      }),
    onSuccess: () => {
      showToast(t('referrals.created'), 'success')
      qc.invalidateQueries({ queryKey: ['referrals'] })
      onClose()
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const switchType = (next: ReferralType) => {
    setType(next)
    setSpecialty('')
    setTargetDoctor('')
    setFacility('')
  }

  return (
    <Modal title={t('referrals.createTitle')} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <FormField label={t('referrals.typeLabel')}>
          {(p) => (
            <Select
              id={p.id}
              options={[
                { value: 'INTERNAL', label: t('referrals.internal') },
                { value: 'EXTERNAL', label: t('referrals.external') },
              ]}
              value={type}
              onChange={(v) => switchType((Array.isArray(v) ? 'INTERNAL' : String(v)) as ReferralType)}
            />
          )}
        </FormField>

        {type === 'INTERNAL' ? (
          <>
            <FormField label={t('referrals.specialty')}>
              {(p) => (
                <Select
                  id={p.id}
                  searchable
                  options={specialties.map((s) => ({ value: s.id, label: localizedName(s, language) }))}
                  value={specialty}
                  onChange={(v) => {
                    setSpecialty(Array.isArray(v) ? '' : (v as number))
                    setTargetDoctor('')
                  }}
                  placeholder={t('referrals.specialtyPlaceholder')}
                />
              )}
            </FormField>
            <FormField label={t('referrals.targetDoctor')} hint={t('referrals.targetDoctorHint')}>
              {(p) => (
                <Select
                  id={p.id}
                  searchable
                  disabled={specialty === ''}
                  options={doctorsInSpecialty.map((d) => ({ value: d.id, label: d.full_name }))}
                  value={targetDoctor}
                  onChange={(v) => setTargetDoctor(Array.isArray(v) ? '' : (v as number))}
                  placeholder={t('referrals.targetDoctorPlaceholder')}
                />
              )}
            </FormField>
          </>
        ) : (
          <FormField label={t('referrals.facilityName')}>
            {(p) => (
              <input {...p} value={facility} onChange={(e) => setFacility(e.target.value)} required />
            )}
          </FormField>
        )}

        <FormField label={t('referrals.reason')}>
          {(p) => (
            <textarea {...p} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} required />
          )}
        </FormField>
        <FormField label={t('referrals.reasonAr')}>
          {(p) => (
            <textarea {...p} dir="rtl" rows={3} value={reasonAr} onChange={(e) => setReasonAr(e.target.value)} />
          )}
        </FormField>
        <FormField label={t('referrals.notes')}>
          {(p) => (
            <textarea {...p} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          )}
        </FormField>
        <FormField label={t('referrals.notesAr')}>
          {(p) => (
            <textarea {...p} dir="rtl" rows={2} value={notesAr} onChange={(e) => setNotesAr(e.target.value)} />
          )}
        </FormField>

        <div className="modal__actions">
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" loading={create.isPending}>{t('referrals.submit')}</Button>
        </div>
      </form>
    </Modal>
  )
}
