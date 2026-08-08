import { Star } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '../hooks/useAuth'

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

  const avgRating = doctor.average_rating ?? null

  const handleBook = () => {
    navigate(`/doctors/${doctor.id}`)
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between">
      <div className="flex flex-col gap-4 min-w-0">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-12 h-12 rounded-full bg-[#0D9488]/10 text-[#0D9488] font-bold flex items-center justify-center shrink-0 overflow-hidden">
            {doctor.photo ? (
              <img src={doctor.photo} alt={doctor.full_name} className="w-full h-full object-cover" />
            ) : (
              initials
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="public-title-doctor-name font-bold text-slate-800 truncate">{doctor.full_name}</h3>
            {doctor.room_number && (
              <span className="block text-xs text-slate-400">
                {t('doctors.room')} {doctor.room_number}
              </span>
            )}
          </div>
        </div>

        {doctor.specialties_detail.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {doctor.specialties_detail.map((s) => (
              <span
                key={s.id}
                className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-[#0D9488]/10 text-[#0D9488]"
              >
                {s.name}
              </span>
            ))}
          </div>
        )}

        {(avgRating != null || doctor.next_available_date) && (
          <div className="flex flex-col gap-1.5">
            {avgRating != null && (
              <div className="flex items-center gap-1.5 min-w-0">
                <div className="flex items-center gap-0.5">
                  {Array.from({ length: 5 }, (_, i) => (
                    <Star
                      key={i}
                      className={
                        i < Math.round(avgRating)
                          ? 'h-3.5 w-3.5 text-amber-400 fill-amber-400'
                          : 'h-3.5 w-3.5 text-slate-200 fill-slate-200'
                      }
                      aria-hidden="true"
                    />
                  ))}
                </div>
                <span className="text-xs text-slate-500">
                  {avgRating.toFixed(1)} ({doctor.review_count ?? 0})
                </span>
              </div>
            )}

            {doctor.next_available_date && (
              <span className="text-xs text-[#0D9488] font-medium">
                {t('doctors.nextAvailable')}: {formatDate(doctor.next_available_date)}
              </span>
            )}
          </div>
        )}

        {doctor.bio && (
          <p className="text-slate-500 text-sm min-w-0">
            {doctor.bio.length > 120 ? doctor.bio.slice(0, 117) + '…' : doctor.bio}
          </p>
        )}
      </div>

      <div>
        {doctor.is_accepting_patients !== false ? (
          <button
            type="button"
            onClick={handleBook}
            className="w-full h-10 bg-[#0D9488] hover:bg-[#0B7A70] text-white font-semibold rounded-xl shadow-sm transition-all mt-4 flex items-center justify-center"
          >
            {status === 'authed' ? t('doctors.bookAppointment') : t('doctors.viewAndBook')}
          </button>
        ) : (
          <span className="block text-center text-xs font-medium text-red-500 mt-4">
            {t('doctors.notAccepting')}
          </span>
        )}
        {doctor.accepts_walk_ins && (
          <span className="block mt-2 text-center text-xs text-slate-400 font-medium">
            {t('doctors.acceptsWalkIns')}
          </span>
        )}
      </div>
    </div>
  )
}
