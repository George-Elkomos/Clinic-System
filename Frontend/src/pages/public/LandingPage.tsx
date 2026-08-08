import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CalendarCheck, Search, UserCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { DoctorCard } from '../../components/DoctorCard'
import { PublicLayout } from '../../components/layout/PublicLayout'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { publicApi } from '../../services/apiClient'
import type { Paginated, PublicDoctor } from '../../services/types'

const STEPS = [
  { Icon: Search, titleKey: 'landing.step1Title', descKey: 'landing.step1Desc' },
  { Icon: CalendarCheck, titleKey: 'landing.step2Title', descKey: 'landing.step2Desc' },
  { Icon: UserCheck, titleKey: 'landing.step3Title', descKey: 'landing.step3Desc' },
]

export function LandingPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const { data, isLoading } = useQuery({
    queryKey: ['public-doctors-landing'],
    queryFn: () =>
      publicApi
        .get<Paginated<PublicDoctor>>('/public/doctors/?ordering=-average_rating')
        .then((r) => r.data.results.slice(0, 4)),
  })

  return (
    <PublicLayout>
      {/* Hero */}
      <section className="bg-gradient-to-r from-[#0D9488] via-[#0B7A70] to-[#085C54] text-white rounded-3xl mx-4 sm:mx-8 my-6 p-10 sm:p-16 text-center relative overflow-hidden shadow-xl shadow-[#0D9488]/10">
        <div className="flex flex-col items-center">
          <h1 className="public-title-hero font-black tracking-tight text-white leading-tight max-w-3xl mx-auto">
            {t('landing.heroTitle')}
          </h1>
          {/* div, not p — globals.css unlayered-resets `p { margin: 0 }`, which
              blocks a Tailwind margin utility on the <p> itself; the gap is
              applied here instead, on the wrapping div. */}
          <div className="mt-4 max-w-2xl">
            <p className="text-slate-100/90 text-base sm:text-lg font-normal">{t('landing.heroSub')}</p>
          </div>
          <div className="mt-6">
            <button
              type="button"
              onClick={() => navigate('/doctors')}
              className="public-btn--hero-cta border-none bg-white text-[#0D9488] hover:bg-slate-50 font-bold px-8 py-3.5 rounded-xl shadow-md hover:shadow-lg transition-all inline-flex items-center gap-2"
            >
              {t('landing.findDoctor')}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-5xl mx-auto px-4 py-6 sm:py-10">
        <h2 className="public-title-section font-extrabold text-slate-800 text-center">
          {t('landing.howItWorks')}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8 mt-10">
          {STEPS.map(({ Icon, titleKey, descKey }) => (
            <div
              key={titleKey}
              className="p-6 rounded-2xl bg-slate-50/60 border border-slate-100 hover:bg-white hover:shadow-lg transition-all text-center flex flex-col items-center gap-4"
            >
              <div className="w-14 h-14 rounded-2xl bg-[#0D9488]/10 text-[#0D9488] flex items-center justify-center">
                <Icon className="h-6 w-6" aria-hidden="true" />
              </div>
              <div className="flex flex-col gap-2">
                <h3 className="public-title-step font-bold text-slate-800">{t(titleKey)}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{t(descKey)}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Top doctors */}
      <section className="max-w-7xl mx-auto px-4 sm:px-8 py-6 sm:py-10">
        <h2 className="public-title-section font-extrabold text-slate-800 text-center">
          {t('landing.topDoctors')}
        </h2>
        <div className="mt-10">
          {isLoading ? (
            <CenteredSpinner />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {(data ?? []).map((d) => (
                <DoctorCard key={d.id} doctor={d} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Register CTA */}
      <section className="bg-slate-50 border border-slate-100 rounded-3xl p-8 my-12 mx-4 sm:mx-auto max-w-3xl text-center flex flex-col items-center gap-2">
        <h2 className="public-title-callout font-bold text-slate-800">{t('landing.registerCta')}</h2>
        <p className="text-slate-500 text-sm">{t('landing.registerCtaSub')}</p>
        <button
          type="button"
          onClick={() => navigate('/register')}
          className="mt-4 inline-flex items-center justify-center border-none bg-[#0D9488] hover:bg-[#0B7A70] text-white font-semibold px-8 py-3 rounded-xl shadow-md transition-all"
        >
          {t('auth.createAccount')}
        </button>
      </section>
    </PublicLayout>
  )
}
