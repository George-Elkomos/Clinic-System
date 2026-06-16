import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Button } from '../../components/primitives/Button'
import { Card } from '../../components/primitives/Card'
import { FormField } from '../../components/primitives/FormField'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { useLanguage } from '../../hooks/useLanguage'
import { formatTime } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { appointmentsApi } from '../../services/appointments.api'
import { doctorsApi } from '../../services/doctors.api'
import { waitlistApi } from '../../services/waitlist.api'

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export function BookAppointmentPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { showToast } = useToast()
  const qc = useQueryClient()

  const [doctorId, setDoctorId] = useState<number | ''>('')
  const [date, setDate] = useState(todayISO())
  const [reason, setReason] = useState('')

  const { data: doctors } = useQuery({
    queryKey: ['doctors'],
    queryFn: () => doctorsApi.list(),
  })

  const { data: slots, isLoading: slotsLoading } = useQuery({
    queryKey: ['slots', doctorId, date],
    queryFn: () => doctorsApi.availableSlots(Number(doctorId), date),
    enabled: doctorId !== '',
  })

  const booking = useMutation({
    mutationFn: (slot: number) => appointmentsApi.book(slot, reason),
    onSuccess: () => {
      showToast(t('booking.booked'), 'success')
      setReason('')
      qc.invalidateQueries({ queryKey: ['slots', doctorId, date] })
      qc.invalidateQueries({ queryKey: ['appointments'] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const joinWaitlist = useMutation({
    mutationFn: () => waitlistApi.join(Number(doctorId), date, date),
    onSuccess: () => {
      showToast(t('waitlist.joined'), 'success')
      qc.invalidateQueries({ queryKey: ['waitlist'] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('booking.title') }]} />
      <h1>{t('booking.title')}</h1>

      <Card>
        <div className="book-appt-form">
          <FormField label={t('booking.chooseDoctor')}>
            {(p) => (
              <Select
                id={p.id}
                options={(doctors?.results ?? []).map((d) => ({
                  value: d.id,
                  label: d.full_name + (d.specialties_detail[0] ? ` · ${d.specialties_detail[0].name}` : ''),
                }))}
                value={doctorId}
                onChange={(v) => setDoctorId(Array.isArray(v) || v === '' ? '' : Number(v))}
                placeholder="—"
                searchable
              />
            )}
          </FormField>

          <FormField label={t('booking.chooseDate')}>
            {(p) => (
              <input {...p} type="date" min={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
            )}
          </FormField>

          <FormField label={t('booking.reason')}>
            {(p) => <textarea {...p} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </FormField>
        </div>
      </Card>

      <Card title={t('booking.availableTimes')}>
        {doctorId === '' ? (
          <p>{t('booking.selectDoctorFirst')}</p>
        ) : slotsLoading ? (
          <CenteredSpinner />
        ) : (slots ?? []).length === 0 ? (
          <div>
            <p>{t('booking.noSlots')}</p>
            <p className="book-hint">{t('waitlist.joinHint')}</p>
            <Button variant="secondary" loading={joinWaitlist.isPending} onClick={() => joinWaitlist.mutate()}>
              {t('waitlist.join')}
            </Button>
          </div>
        ) : (
          <div className="book-slots-grid">
            {(slots ?? []).map((s) => (
              <Button
                key={s.id}
                variant="secondary"
                loading={booking.isPending && booking.variables === s.id}
                onClick={() => booking.mutate(s.id)}
              >
                {formatTime(s.start_datetime, language)}
              </Button>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
