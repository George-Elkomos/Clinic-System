import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { PublicLayout } from '../../components/layout/PublicLayout'
import { Button } from '../../components/primitives/Button'
import { FormField } from '../../components/primitives/FormField'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { StarRating } from '../../components/primitives/StarRating'
import { useToast } from '../../components/primitives/Toast'
import { useAuth } from '../../hooks/useAuth'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate, formatTime } from '../../lib/format'
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
      qc.invalidateQueries({ queryKey: ['public-slots', doctorId, date] })
      qc.invalidateQueries({ queryKey: ['appointments'] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const bookSlot = (slot: TimeSlot) => {
    if (status !== 'authed') {
      navigate(`/register?next=${encodeURIComponent(`/doctors/${doctorId}`)}&slot=${slot.id}`)
      return
    }
    if (user?.role !== 'PATIENT') {
      showToast(t('booking.patientOnly'), 'error')
      return
    }
    booking.mutate(slot.id)
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
        <main className="pub-main">
          <h1>{t('errors.notFoundTitle')}</h1>
          <Link to="/doctors">{t('common.back')}</Link>
        </main>
      </PublicLayout>
    )
  }

  const rating = doctor.average_rating ?? 0

  return (
    <PublicLayout>
      <main className="pub-main">
        <Link to="/doctors" style={{ color: 'var(--primary)', fontWeight: 600 }}>
          {t('doctors.backToDoctors')}
        </Link>

        <section className="profile-hero">
          <div className="doctor-card__photo profile-hero__photo">
            {doctor.photo ? <img src={doctor.photo} alt={doctor.full_name} /> : doctor.full_name.slice(0, 2)}
          </div>
          <div>
            <h1 style={{ marginBottom: 'var(--space-2)' }}>{doctor.full_name}</h1>
            <div className="doctor-card__tags">
              {doctor.specialties_detail.map((specialty, index) => (
                <span
                  key={specialty.id}
                  className={`tag ${['tag--blue', 'tag--green', 'tag--orange', 'tag--purple'][index % 4]}`}
                >
                  {specialty.name}
                </span>
              ))}
            </div>
            <div style={{ marginTop: 'var(--space-3)' }}>
              <StarRating value={Math.round(rating)} readOnly />
              <span style={{ marginInlineStart: 8, color: 'var(--text-muted)' }}>
                {doctor.average_rating != null
                  ? t('reviews.averageLabel', { avg: doctor.average_rating.toFixed(1), count: doctor.review_count })
                  : t('reviews.none')}
              </span>
            </div>
          </div>
        </section>

        <div className="detail-grid">
          <section className="card">
            <h2>{t('doctors.bio')}</h2>
            <p>{doctor.bio || t('common.none')}</p>
            <dl className="info-list">
              <div>
                <dt>{t('doctors.room')}</dt>
                <dd>{doctor.room_number || t('common.none')}</dd>
              </div>
              <div>
                <dt>{t('doctors.languages')}</dt>
                <dd>{doctor.languages_spoken || t('common.none')}</dd>
              </div>
              <div>
                <dt>{t('doctors.appointmentLength')}</dt>
                <dd>{doctor.avg_appointment_duration} {t('common.minutes')}</dd>
              </div>
              <div>
                <dt>{t('doctors.experience')}</dt>
                <dd>{doctor.years_experience} {t('common.years')}</dd>
              </div>
            </dl>
          </section>

          <section className="card">
            <h2>{t('booking.availableTimes')}</h2>
            <div className="date-strip">
              {weekFromToday().map((day) => (
                <button
                  key={day}
                  type="button"
                  className={`date-chip${day === date ? ' date-chip--active' : ''}`}
                  onClick={() => setDate(day)}
                >
                  {formatDate(day, language)}
                </button>
              ))}
            </div>

            <FormField label={t('booking.reason')}>
              {(p) => (
                <textarea
                  {...p}
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              )}
            </FormField>

            {slotsLoading ? (
              <CenteredSpinner />
            ) : slots.length === 0 ? (
              <p>{t('booking.noSlots')}</p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
                {slots.map((slot) => (
                  <Button
                    key={slot.id}
                    variant="secondary"
                    loading={booking.isPending && booking.variables === slot.id}
                    onClick={() => bookSlot(slot)}
                  >
                    {formatTime(slot.start_datetime, language)}
                  </Button>
                ))}
              </div>
            )}
          </section>
        </div>

        <section className="card">
          <h2>{t('reviews.title')}</h2>
          {reviews.length === 0 ? (
            <p>{t('reviews.none')}</p>
          ) : (
            reviews.map((review) => (
              <article key={review.id} className="review-row">
                <StarRating value={review.rating} readOnly />
                <p style={{ margin: 'var(--space-2) 0' }}>{review.comment || t('common.none')}</p>
                <small style={{ color: 'var(--text-muted)' }}>
                  {review.patient_name || t('reviews.anonymous')} - {formatDate(review.created_at, language)}
                </small>
              </article>
            ))
          )}
        </section>
      </main>
    </PublicLayout>
  )
}
