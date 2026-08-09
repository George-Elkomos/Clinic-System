import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarCheck, CalendarX, Check, ChevronDown, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CustomDatePicker } from '../../components/primitives/CustomDatePicker'
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

// Closes a popover on outside click, since neither custom control below
// wraps a native element that would give us that for free.
function useOutsideClose(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onClose])
  return ref
}

interface ComboboxOption {
  value: number
  label: string
}

// Custom combobox replacing the native <select> — the OS-rendered native
// dropdown can't be restyled to match the design system.
function DoctorCombobox({
  options,
  value,
  placeholder,
  onChange,
}: {
  options: ComboboxOption[]
  value: number | ''
  placeholder: string
  onChange: (value: number) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useOutsideClose(open, () => setOpen(false))
  const selected = options.find((o) => o.value === value)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-12 w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-800 focus:border-[#3BC9CB] focus:outline-none"
      >
        <span className={`truncate ${selected ? '' : 'text-slate-400'}`}>{selected ? selected.label : placeholder}</span>
        <ChevronDown size={16} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute start-0 z-50 mt-2 max-h-60 w-full overflow-y-auto rounded-2xl border border-slate-100 bg-white p-2 shadow-xl">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
              className="flex w-full items-center justify-between rounded-xl px-4 py-2.5 text-start text-sm text-slate-700 transition-colors hover:bg-slate-50 hover:text-[#0D9488]"
            >
              <span className="truncate">{o.label}</span>
              {value === o.value && <Check size={14} className="shrink-0" style={{ color: '#0D9488' }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function BookAppointmentPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { showToast } = useToast()
  const qc = useQueryClient()

  const [doctorId, setDoctorId] = useState<number | ''>('')
  const [date, setDate] = useState(todayISO())
  const [reason, setReason] = useState('')
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null)

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
      setSelectedSlot(null)
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

  const doctorOptions = (doctors?.results ?? []).map((d) => ({
    value: d.id,
    label: d.full_name + (d.specialties_detail[0] ? ` · ${d.specialties_detail[0].name}` : ''),
  }))

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-6">
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-800">{t('booking.chooseDoctor')}</label>
            <DoctorCombobox
              options={doctorOptions}
              value={doctorId}
              placeholder="—"
              onChange={(id) => {
                setDoctorId(id)
                setSelectedSlot(null)
              }}
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-800">{t('booking.chooseDate')}</label>
            <CustomDatePicker
              value={date}
              min={todayISO()}
              variant="field"
              allowClear={false}
              onChange={(iso) => {
                setDate(iso)
                setSelectedSlot(null)
              }}
            />
          </div>

          <div>
            <label htmlFor="book-reason" className="mb-2 block text-sm font-semibold text-slate-800">
              {t('booking.reason')}
            </label>
            <textarea
              id="book-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="h-28 w-full resize-none rounded-xl border border-slate-200 bg-slate-50/30 p-4 text-sm text-slate-800 transition-all focus:border-[#3BC9CB] focus:bg-white focus:outline-none"
            />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-slate-800">{t('booking.availableTimes')}</h2>

        {doctorId === '' ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-400">
            {t('booking.selectDoctorFirst')}
          </p>
        ) : slotsLoading ? (
          <CenteredSpinner />
        ) : (slots ?? []).length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-8 text-center">
            <CalendarX className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <p className="mb-1 text-sm font-semibold text-slate-700">{t('booking.noSlots')}</p>
            <p className="mb-5 max-w-sm text-xs leading-relaxed text-slate-500">{t('waitlist.joinHint')}</p>
            <button
              type="button"
              disabled={joinWaitlist.isPending}
              onClick={() => joinWaitlist.mutate()}
              className="flex h-10 items-center justify-center gap-2 rounded-xl border border-[#3BC9CB]/40 bg-[#3BC9CB]/10 px-6 text-xs font-semibold text-[#0D9488] shadow-sm transition-all hover:bg-[#3BC9CB] hover:text-white disabled:opacity-60"
            >
              {joinWaitlist.isPending && <Loader2 size={14} className="animate-spin" />}
              {t('waitlist.join')}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {(slots ?? []).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedSlot(s.id)}
                className={`flex h-11 cursor-pointer items-center justify-center rounded-xl border text-sm font-medium transition-all ${
                  selectedSlot === s.id
                    ? 'border-transparent bg-[#3BC9CB] font-semibold text-white shadow-sm'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-[#3BC9CB] hover:text-[#0D9488]'
                }`}
              >
                {formatTime(s.start_datetime, language)}
              </button>
            ))}
          </div>
        )}

        {(slots ?? []).length > 0 && (
          <div className="mt-6 flex justify-end">
            <button
              type="button"
              disabled={selectedSlot === null || booking.isPending}
              onClick={() => selectedSlot !== null && booking.mutate(selectedSlot)}
              className="flex h-12 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#0769AE] to-[#4B9AF0] px-8 font-semibold text-white shadow-sm transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {booking.isPending ? <Loader2 size={18} className="animate-spin" /> : <CalendarCheck size={18} />}
              {t('booking.bookSlot')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
