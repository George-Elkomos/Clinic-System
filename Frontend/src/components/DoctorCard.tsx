import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '../hooks/useAuth'
import { Button } from './primitives/Button'
import { StarRating } from './primitives/StarRating'

interface DoctorCardDoctor {
  id: number
  full_name: string
  bio?: string
  photo?: string | null
  room_number?: string
  years_experience?: number
  languages_spoken?: string
  avg_appointment_duration?: number
  accepts_walk_ins?: boolean
  is_accepting_patients?: boolean
  specialties_detail: { id: number; name: string }[]
  average_rating?: number | null
  review_count?: number
  next_available_date?: string | null
}

const TAG_COLORS = ['tag--blue', 'tag--green', 'tag--orange', 'tag--purple', 'tag--teal']

function availabilityClass(date: string | null | undefined) {
  if (!date) return 'doctor-card__availability--later'
  const diff = (new Date(date).getTime() - Date.now()) / 86400000
  if (diff <= 3) return 'doctor-card__availability--soon'
  if (diff <= 7) return 'doctor-card__availability--week'
  return 'doctor-card__availability--later'
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function DoctorCard({ doctor }: { doctor: DoctorCardDoctor }) {
  const { t } = useTranslation()
  const { status } = useAuth()
  const navigate = useNavigate()

  const initials = doctor.full_name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const handleBook = () => {
    navigate(`/doctors/${doctor.id}`)
  }

  return (
    <div className="doctor-card">
      <div className="doctor-card__header">
        <div className="doctor-card__photo">
          {doctor.photo ? (
            <img
              src={doctor.photo}
              alt={doctor.full_name}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            initials
          )}
        </div>
        <div className="doctor-card__info">
          <h3 className="doctor-card__name">{doctor.full_name}</h3>
          {doctor.room_number && (
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-small)', margin: '0 0 var(--space-2)' }}>
              {t('doctors.room')} {doctor.room_number}
            </p>
          )}
          <div className="doctor-card__tags">
            {doctor.specialties_detail.map((s, i) => (
              <span key={s.id} className={`tag ${TAG_COLORS[i % TAG_COLORS.length]}`}>
                {s.name}
              </span>
            ))}
          </div>
        </div>
      </div>

      {doctor.average_rating != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <StarRating value={Math.round(doctor.average_rating)} readOnly />
          <span style={{ fontSize: 'var(--font-small)', color: 'var(--text-muted)' }}>
            {doctor.average_rating.toFixed(1)} ({doctor.review_count ?? 0})
          </span>
        </div>
      )}

      {doctor.next_available_date && (
        <p className={`doctor-card__availability ${availabilityClass(doctor.next_available_date)}`}>
          {t('doctors.nextAvailable')}: {formatDate(doctor.next_available_date)}
        </p>
      )}

      {doctor.bio && (
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-small)', margin: 0 }}>
          {doctor.bio.length > 120 ? doctor.bio.slice(0, 117) + '…' : doctor.bio}
        </p>
      )}

      <div className="doctor-card__footer">
        {doctor.is_accepting_patients !== false ? (
          <Button variant="primary" onClick={handleBook}>
            {status === 'authed' ? t('doctors.bookAppointment') : t('doctors.viewAndBook')}
          </Button>
        ) : (
          <span className="doctor-card__not-accepting">{t('doctors.notAccepting')}</span>
        )}
        {doctor.accepts_walk_ins && (
          <span className="tag tag--muted">{t('doctors.acceptsWalkIns')}</span>
        )}
      </div>
    </div>
  )
}
