import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '../hooks/useAuth'
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

function availabilityColorClass(date: string | null | undefined) {
  if (!date) return 'text-slate-500'
  const diff = (new Date(date).getTime() - Date.now()) / 86400000
  if (diff <= 3) return 'text-emerald-600'
  if (diff <= 7) return 'text-amber-600'
  return 'text-slate-500'
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
    <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between space-y-4">
      <div className="space-y-4 min-w-0">
        <div className="flex items-start gap-4 min-w-0">
          <div className="w-16 h-16 rounded-full bg-teal-50 text-[#0D9488] font-bold text-lg flex items-center justify-center shrink-0 overflow-hidden">
            {doctor.photo ? (
              <img src={doctor.photo} alt={doctor.full_name} className="w-full h-full object-cover" />
            ) : (
              initials
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-slate-900 text-base truncate">{doctor.full_name}</h3>
            {doctor.room_number && (
              <p className="text-slate-500 text-xs mt-0.5">
                {t('doctors.room')} {doctor.room_number}
              </p>
            )}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {doctor.specialties_detail.map((s) => (
                <span
                  key={s.id}
                  className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-teal-50 text-teal-700 border border-teal-200/50"
                >
                  {s.name}
                </span>
              ))}
            </div>
          </div>
        </div>

        {doctor.average_rating != null && (
          <div className="flex items-center gap-2 min-w-0">
            <StarRating value={Math.round(doctor.average_rating)} readOnly />
            <span className="text-xs text-slate-500">
              {doctor.average_rating.toFixed(1)} ({doctor.review_count ?? 0})
            </span>
          </div>
        )}

        {doctor.next_available_date && (
          <p className={`text-xs font-medium ${availabilityColorClass(doctor.next_available_date)}`}>
            {t('doctors.nextAvailable')}: {formatDate(doctor.next_available_date)}
          </p>
        )}

        {doctor.bio && (
          <p className="text-slate-500 text-sm min-w-0">
            {doctor.bio.length > 120 ? doctor.bio.slice(0, 117) + '…' : doctor.bio}
          </p>
        )}
      </div>

      <div className="space-y-2">
        {doctor.is_accepting_patients !== false ? (
          <button
            type="button"
            onClick={handleBook}
            className="public-btn--xs w-full h-10 bg-[#0D9488] hover:bg-[#0B7A70] text-white font-semibold text-xs rounded-xl flex items-center justify-center transition-all"
          >
            {status === 'authed' ? t('doctors.bookAppointment') : t('doctors.viewAndBook')}
          </button>
        ) : (
          <span className="block text-xs font-medium text-red-600">{t('doctors.notAccepting')}</span>
        )}
        {doctor.accepts_walk_ins && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
            {t('doctors.acceptsWalkIns')}
          </span>
        )}
      </div>
    </div>
  )
}
