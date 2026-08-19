import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { PublicLayout } from '../../components/layout/PublicLayout'
import { FormField } from '../../components/primitives/FormField'
import { CenteredSpinner, Spinner } from '../../components/primitives/Spinner'
import { StarRating } from '../../components/primitives/StarRating'
import { useToast } from '../../components/primitives/Toast'
import { useAuth } from '../../hooks/useAuth'
import { useLanguage } from '../../hooks/useLanguage'
import { formatCurrency, formatDate, formatTime } from '../../lib/format'
import { appointmentsApi } from '../../services/appointments.api'
import { errorMessage, publicApi } from '../../services/apiClient'
import type { Paginated, PublicDoctor, Review, TimeSlot } from '../../services/types'

function isoDate(offset = 0) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return date.toISOString().slice(0, 10)
}

function weekFromToday() {
  return Array.from({ length: 7 }, (_, index) => isoDate(index))
}

function getResults<T>(payload: Paginated<T> | T[]): T[] {
  return Array.isArray(payload) ? payload : payload.results
}

function weekdayShort(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(iso))
}

function monthDay(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(iso))
}

function initials(name: string) {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export function DoctorDetailPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { status, user } = useAuth()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { id } = useParams()
  const doctorId = Number(id)
  const [date, setDate] = useState(isoDate())
  const [reason, setReason] = useState('')
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null)

  const { data: doctor, isLoading: doctorLoading } = useQuery({
    queryKey: ['public-doctor', doctorId],
    queryFn: () => publicApi.get<PublicDoctor>(`/public/doctors/${doctorId}/`).then((r) => r.data),
    enabled: Number.isFinite(doctorId),
  })

  const { data: reviews = [] } = useQuery({
    queryKey: ['public-reviews', doctorId],
    queryFn: () =>
      publicApi
        .get<Paginated<Review> | Review[]>('/reviews/', { params: { doctor: doctorId } })
        .then((r) => getResults(r.data)),
    enabled: Number.isFinite(doctorId),
  })

  const { data: slots = [], isLoading: slotsLoading } = useQuery({
    queryKey: ['public-slots', doctorId, date],
    queryFn: () =>
      publicApi
        .get<TimeSlot[]>('/slots/available/', { params: { doctor: doctorId, date } })
        .then((r) => r.data),
    enabled: Number.isFinite(doctorId),
  })

  const booking = useMutation({
    mutationFn: (slotId: number) => appointmentsApi.book(slotId, reason),
    onSuccess: () => {
      showToast(t('booking.booked'), 'success')
      setReason('')
      setSelectedSlotId(null)
      qc.invalidateQueries({ queryKey: ['public-slots', doctorId, date] })
      qc.invalidateQueries({ queryKey: ['appointments'] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const pickDate = (day: string) => {
    setDate(day)
    setSelectedSlotId(null)
  }

  const confirmBooking = () => {
    if (!selectedSlotId) return
    if (status !== 'authed') {
      navigate(`/register?next=${encodeURIComponent(`/doctors/${doctorId}`)}&slot=${selectedSlotId}`)
      return
    }
    if (user?.role !== 'PATIENT') {
      showToast(t('booking.patientOnly'), 'error')
      return
    }
    booking.mutate(selectedSlotId)
  }

  if (doctorLoading) {
    return (
      <PublicLayout>
        <CenteredSpinner />
      </PublicLayout>
    )
  }

  if (!doctor) {
    return (
      <PublicLayout>
        <div className="mx-auto max-w-md px-4 py-20 text-center">
          <h1 className="mb-3 text-xl font-bold text-slate-800">{t('errors.notFoundTitle')}</h1>
          <Link to="/doctors" className="text-sm font-semibold text-[#0D9488] hover:underline">
            {t('common.back')}
          </Link>
        </div>
      </PublicLayout>
    )
  }

  const rating = doctor.average_rating ?? 0
  const CARD = 'rounded-2xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6'

  return (
    <PublicLayout>
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <Link
          to="/doctors"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#0D9488] hover:underline"
        >
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          {t('doctors.backToDoctors')}
        </Link>

        <section className={`${CARD} flex flex-col items-start gap-5 sm:flex-row sm:items-center`}>
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#0D9488]/10 text-xl font-bold text-[#0D9488]">
            {doctor.photo ? (
              <img src={doctor.photo} alt={doctor.full_name} className="h-full w-full object-cover" />
            ) : (
              initials(doctor.full_name)
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="public-title-page font-bold text-slate-900">{doctor.full_name}</h1>
            {doctor.specialties_detail.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {doctor.specialties_detail.map((specialty) => (
                  <span
                    key={specialty.id}
                    className="inline-flex items-center rounded-full bg-[#0D9488]/10 px-2.5 py-1 text-xs font-semibold text-[#0D9488]"
                  >
                    {specialty.name}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-2.5 flex items-center gap-1.5">
              <StarRating value={Math.round(rating)} readOnly />
              <span className="text-sm text-slate-500">
                {doctor.average_rating != null
                  ? t('reviews.averageLabel', { avg: doctor.average_rating.toFixed(1), count: doctor.review_count })
                  : t('reviews.none')}
              </span>
            </div>
          </div>
        </section>

        <section className={CARD}>
          <h2 className="mb-3 text-lg font-bold text-slate-800">{t('doctors.bio')}</h2>
          <p className="mb-4 text-sm leading-relaxed text-slate-600">{doctor.bio || t('doctors.noBio')}</p>
          <dl className="grid grid-cols-2 gap-4 rounded-xl bg-slate-50 p-4 md:grid-cols-4">
            {doctor.room_number && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {t('doctors.room')}
                </dt>
                <dd className="mt-1 text-sm font-bold text-slate-800">{doctor.room_number}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {t('doctors.languages')}
              </dt>
              <dd className="mt-1 text-sm font-bold text-slate-800">
                {doctor.languages_spoken || t('doctors.languagesDefault')}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {t('doctors.consultationDuration')}
              </dt>
              <dd className="mt-1 text-sm font-bold text-slate-800">
                {t('doctors.durationValue', { n: doctor.avg_appointment_duration })}
              </dd>
            </div>
            {doctor.years_experience > 0 && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {t('doctors.experience')}
                </dt>
                <dd className="mt-1 text-sm font-bold text-slate-800">
                  {t('doctors.experienceValue', { n: doctor.years_experience })}
                </dd>
              </div>
            )}
            {doctor.consultation_fee != null && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {t('doctors.consultationFee')}
                </dt>
                <dd className="mt-1 text-sm font-bold text-slate-800">
                  {formatCurrency(doctor.consultation_fee, language)}
                </dd>
              </div>
            )}
          </dl>
        </section>

        <section className={CARD}>
          <h2 className="mb-4 text-lg font-bold text-slate-800">{t('booking.availableTimes')}</h2>

          {!doctor.is_accepting_patients ? (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <p className="text-sm font-medium">
                {t('booking.notAcceptingBanner', { name: doctor.full_name })}
              </p>
            </div>
          ) : (
            <>
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
                {weekFromToday().map((day, index) => {
                  const active = day === date
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={active}
                      onClick={() => pickDate(day)}
                      className={`flex shrink-0 flex-col items-center rounded-xl px-3.5 py-2 transition-colors ${
                        active ? 'bg-teal-600 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
                        {index === 0 ? t('common.today') : weekdayShort(day, language)}
                      </span>
                      <span className="text-sm font-bold">{monthDay(day, language)}</span>
                    </button>
                  )
                })}
              </div>

              {slotsLoading ? (
                <CenteredSpinner />
              ) : slots.length === 0 ? (
                <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">{t('booking.noSlots')}</p>
              ) : (
                <>
                  <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                    {slots.map((slot) => {
                      const selected = slot.id === selectedSlotId
                      return (
                        <button
                          key={slot.id}
                          type="button"
                          aria-pressed={selected}
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

                  {selectedSlotId && (
                    <div className="mt-5 border-t border-slate-100 pt-5">
                      <FormField label={t('booking.reason')}>
                        {(p) => (
                          <textarea
                            {...p}
                            rows={3}
                            className="public-textarea--reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                          />
                        )}
                      </FormField>

                      <button
                        type="button"
                        disabled={booking.isPending}
                        onClick={confirmBooking}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {booking.isPending && <Spinner size={16} />}
                        {t('booking.confirmBook')}
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </section>

        <section className={CARD}>
          <h2 className="mb-4 text-lg font-bold text-slate-800">{t('reviews.title')}</h2>
          {reviews.length === 0 ? (
            <p className="text-sm text-slate-500">{t('reviews.none')}</p>
          ) : (
            <div>
              {reviews.map((review) => {
                const reviewerName = review.patient_name || t('reviews.anonymous')
                return (
                  <article
                    key={review.id}
                    className="mb-3 space-y-2 rounded-xl border border-slate-100 bg-slate-50 p-4 last:mb-0"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0D9488]/10 text-xs font-bold text-[#0D9488]">
                        {initials(reviewerName)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-700">{reviewerName}</p>
                        <p className="text-xs text-slate-500">{formatDate(review.created_at, language)}</p>
                      </div>
                    </div>
                    <StarRating value={review.rating} readOnly />
                    {review.comment && <p className="text-sm text-slate-600">{review.comment}</p>}
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </PublicLayout>
  )
}
