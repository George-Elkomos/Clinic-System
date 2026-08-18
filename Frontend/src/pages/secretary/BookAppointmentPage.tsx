import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { OverrideWarningModal } from '../../components/OverrideWarningModal'
import { HighRiskWarningBanner, ReliabilityBadge } from '../../components/ReliabilityBadge'
import { AsyncCombobox, type ComboOption } from '../../components/primitives/AsyncCombobox'
import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { CustomDatePicker } from '../../components/primitives/CustomDatePicker'
import { FormField } from '../../components/primitives/FormField'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner, Spinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { useLanguage } from '../../hooks/useLanguage'
import { formatTime } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { appointmentsApi } from '../../services/appointments.api'
import { doctorsApi } from '../../services/doctors.api'
import { RegisterPatientModal } from './RegisterPatientModal'

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all disabled:opacity-60 sm:text-sm'

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

const patientFetcher = (query: string): Promise<ComboOption[]> =>
  appointmentsApi.patients(query || undefined).then((results) =>
    results.map((pt) => ({
      value: pt.id,
      label: pt.full_name || pt.email || String(pt.id),
      reliability: pt.reliability,
    })),
  )

export function BookAppointmentPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { showToast } = useToast()
  const qc = useQueryClient()

  const [patientOption, setPatientOption] = useState<ComboOption | null>(null)
  const [registeringPatient, setRegisteringPatient] = useState(false)
  const [doctorId, setDoctorId] = useState<number | ''>('')
  const [date, setDate] = useState(todayISO())
  const [reason, setReason] = useState('')
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null)
  const [pendingWarning, setPendingWarning] = useState(false)
  const patientId = patientOption?.value ?? ''

  const { data: doctors } = useQuery({ queryKey: ['doctors'], queryFn: () => doctorsApi.list() })
  const selectedDoctor = (doctors?.results ?? []).find((d) => d.id === Number(doctorId))

  const { data: slots = [], isLoading: slotsLoading } = useQuery({
    queryKey: ['secretary-book-slots', doctorId, date],
    queryFn: () => doctorsApi.availableSlots(Number(doctorId), date),
    enabled: doctorId !== '',
  })

  const booking = useMutation({
    mutationFn: (overrideReason?: string) =>
      appointmentsApi.book(
        selectedSlotId!,
        reason,
        Number(patientId),
        overrideReason !== undefined,
        overrideReason,
      ),
    onSuccess: () => {
      showToast(t('booking.booked'), 'success')
      setReason('')
      setSelectedSlotId(null)
      setPendingWarning(false)
      qc.invalidateQueries({ queryKey: ['secretary-book-slots', doctorId, date] })
      qc.invalidateQueries({ queryKey: ['appointments'] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const pickDoctor = (value: number | '') => {
    setDoctorId(value)
    setSelectedSlotId(null)
  }

  const pickDate = (value: string) => {
    setDate(value)
    setSelectedSlotId(null)
  }

  const handleConfirm = () => {
    if (!selectedSlotId || !patientId) return
    if (selectedDoctor && !selectedDoctor.is_accepting_patients) {
      setPendingWarning(true)
      return
    }
    booking.mutate(undefined)
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[{ label: t('nav.bookAppointment') }]} />
        <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>
          {t('nav.bookAppointment')}
        </h1>
      </div>

      <div className={CARD}>
        <div className="mb-4">
          <label htmlFor="book-patient" className="mb-2 block text-sm font-semibold text-slate-800">
            {t('appointments.patient')}
          </label>
          <AsyncCombobox
            id="book-patient"
            value={patientOption}
            placeholder={t('queue.searchPatient')}
            fetcher={patientFetcher}
            onChange={setPatientOption}
            onCreateNew={() => setRegisteringPatient(true)}
            createNewLabel={t('patients.register')}
          />
          {patientOption?.reliability && (
            <div className="mt-2 flex items-center gap-2">
              <span className="patient-text-overline" style={{ color: 'var(--text-muted)' }}>{t('reliability.title')}</span>
              <ReliabilityBadge reliability={patientOption.reliability} />
            </div>
          )}
        </div>

        {patientOption?.reliability && <HighRiskWarningBanner reliability={patientOption.reliability} />}

        <FormField label={t('booking.chooseDoctor')}>
          {(p) => (
            <Select
              id={p.id}
              options={(doctors?.results ?? []).map((d) => ({ value: d.id, label: d.full_name }))}
              value={doctorId}
              onChange={(v) => pickDoctor(Array.isArray(v) || v === '' ? '' : Number(v))}
              searchable
            />
          )}
        </FormField>

        {selectedDoctor && !selectedDoctor.is_accepting_patients && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
            <p className="text-sm font-medium text-amber-800">
              {t('overrideModal.bookingWarning', { name: selectedDoctor.full_name })}
            </p>
          </div>
        )}

        <FormField label={t('booking.chooseDate')}>
          {() => (
            <CustomDatePicker
              value={date}
              min={todayISO()}
              variant="field"
              allowClear={false}
              onChange={pickDate}
            />
          )}
        </FormField>

        <FormField label={t('booking.reason')}>
          {(p) => (
            <textarea
              {...p}
              rows={3}
              className="patient-field"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </FormField>
      </div>

      {doctorId !== '' && (
        <div className={CARD}>
          <h2 className="patient-text-card-title mb-3" style={{ color: 'var(--text-primary)' }}>
            {t('booking.availableTimes')}
          </h2>
          {slotsLoading ? (
            <CenteredSpinner />
          ) : slots.length === 0 ? (
            <p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>
              {t('booking.noSlots')}
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
              {slots.map((slot) => {
                const selected = slot.id === selectedSlotId
                return (
                  <button
                    key={slot.id}
                    type="button"
                    onClick={() => setSelectedSlotId(slot.id)}
                    className={`rounded-xl border px-2 py-2.5 text-sm font-semibold transition-colors ${
                      selected
                        ? 'border-teal-600 bg-teal-600 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-teal-600 hover:text-teal-700'
                    }`}
                  >
                    {formatTime(slot.start_datetime, language)}
                  </button>
                )
              })}
            </div>
          )}

          {selectedSlotId && (
            <button
              type="button"
              disabled={!patientId || booking.isPending}
              onClick={handleConfirm}
              className={`${BTN_PRIMARY} mt-5 w-full sm:w-auto`}
            >
              {booking.isPending && <Spinner size={14} />}
              {t('booking.confirmBook')}
            </button>
          )}
        </div>
      )}

      {pendingWarning && selectedDoctor && (
        <OverrideWarningModal
          title={t('nav.bookAppointment')}
          message={t('overrideModal.bookingWarning', { name: selectedDoctor.full_name })}
          loading={booking.isPending}
          onCancel={() => setPendingWarning(false)}
          onConfirm={(reason) => booking.mutate(reason)}
        />
      )}

      {registeringPatient && (
        <RegisterPatientModal
          onClose={() => setRegisteringPatient(false)}
          onCreated={(profileId, fullName) => {
            setRegisteringPatient(false)
            setPatientOption({ value: profileId, label: fullName })
          }}
        />
      )}
    </div>
  )
}
