import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Calendar, CalendarDays, Clock, MoreVertical, Phone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { CenteredSpinner } from '../../components/primitives/Spinner'
import { useAuth } from '../../hooks/useAuth'
import { useLanguage } from '../../hooks/useLanguage'
import { appointmentsApi } from '../../services/appointments.api'
import { medicalApi } from '../../services/medical.api'
import type { AppointmentStatus } from '../../services/types'

const RECENT_LAB_WINDOW_DAYS = 14

// Each status's border is a slightly deeper tint of its own bg, and the text
// is that same hue's "600" shade — the ratio the exact PENDING spec (bg
// #FFF7ED / border #FFEDD5 / text #EA580C) gave us, extended consistently to
// the other five states since only that one had concrete values.
const STATUS_PILL: Record<AppointmentStatus, { bg: string; border: string; text: string }> = {
  PENDING: { bg: '#FFF7ED', border: '#FFEDD5', text: '#EA580C' },
  CONFIRMED: { bg: '#EFF6FF', border: '#BFDBFE', text: '#2563EB' },
  CHECKED_IN: { bg: '#ECFDF5', border: '#A7F3D0', text: '#059669' },
  IN_PROGRESS: { bg: '#EFF6FF', border: '#BFDBFE', text: '#2563EB' },
  COMPLETED: { bg: '#ECFDF5', border: '#A7F3D0', text: '#059669' },
  CANCELLED: { bg: '#F1F5F9', border: '#E2E8F0', text: '#475569' },
  NO_SHOW: { bg: '#F1F5F9', border: '#E2E8F0', text: '#475569' },
}

function avatarUrl(name: string, background = 'E2E8F0', color = '1E293B') {
  return `https://ui-avatars.com/api/?background=${background}&color=${color}&size=80&name=${encodeURIComponent(name)}`
}

// Real exported Welcome Banner illustration (clipboard+heart-ECG, calendar,
// blue shield-with-cross) — replaces the earlier hand-authored stand-in.
function HeroIllustration() {
  return (
    <img
      src="/welcome-illustration.svg"
      alt=""
      className="h-[279.24px] w-[430px] max-w-full shrink-0 object-contain"
    />
  )
}

// Custom solid summary-card icons. Lucide is line-art only — reusing its
// outline paths with fill=currentColor collapsed their detail (a filled
// calendar-check loses its checkmark, a filled flask-conical reads as a
// funnel). These are hand-authored instead: a solid silhouette per icon
// plus explicit light "cutout" details drawn on top, so nothing disappears.
interface SolidIconProps {
  className?: string
  color: string
}

function CalendarCheckSolidIcon({ className = '', color }: SolidIconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" style={{ color }} aria-hidden="true">
      <rect x="3" y="4" width="18" height="17" rx="3" />
      <rect x="7" y="1.5" width="2" height="4" rx="1" />
      <rect x="15" y="1.5" width="2" height="4" rx="1" />
      <path d="M3.5 9h17" stroke="rgba(255,255,255,0.55)" strokeWidth="1.3" fill="none" />
      <path
        d="M8 14.6 L10.6 17.2 L16.4 11.2"
        stroke="white"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

function PrescriptionDocSolidIcon({ className = '', color }: SolidIconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" style={{ color }} aria-hidden="true">
      <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
      <path d="M15 2v4a1 1 0 0 0 1 1h4" fill="rgba(255,255,255,0.4)" />
      <text
        x="11"
        y="16.5"
        textAnchor="middle"
        fontSize="6.5"
        fontWeight="800"
        fill="white"
        style={{ fontFamily: 'system-ui, sans-serif' }}
      >
        Rx
      </text>
    </svg>
  )
}

function FlaskSolidIcon({ className = '', color }: SolidIconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" style={{ color }} aria-hidden="true">
      {/* Long, explicitly narrow parallel-sided neck (y1 to y12, ~46% of the
          icon's height) before the body flares out — the neck length is what
          reads as "flask", not just the flare, which alone looks like a cone. */}
      <path d="M10 1 L10 12 L5 20 A2 2 0 0 0 7 22 L17 22 A2 2 0 0 0 19 20 L14 12 L14 1 Z" />
      <path d="M10 5h4" stroke="rgba(255,255,255,0.6)" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      <path d="M6.5 17.5h11" stroke="rgba(255,255,255,0.55)" strokeWidth="1.4" fill="none" />
      <circle cx="10.5" cy="19.5" r="0.9" fill="rgba(255,255,255,0.55)" />
      <circle cx="14" cy="20.6" r="0.6" fill="rgba(255,255,255,0.55)" />
    </svg>
  )
}

// Section - Welcome Banner (Figma spec): 40px padding, 24px radius,
// soft-teal border, teal-tinted gradient + shadow. Illustration pinned to
// the far left edge, greeting text follows after it.
function WelcomeBanner({ name }: { name: string }) {
  const { t } = useTranslation()
  return (
    <section
      className="patient-gradient-hero patient-shadow-banner rounded-banner flex flex-col items-center justify-between border p-10 sm:flex-row"
      style={{ borderColor: 'var(--border-teal-soft)' }}
    >
      <HeroIllustration />
      <div className="flex flex-col justify-center gap-2">
        <h1 className="patient-text-greeting" style={{ color: '#1E293B' }}>
          {t('dashboard.goodMorning', { name })}
        </h1>
        <p className="text-sm" style={{ color: '#64748B' }}>
          {t('dashboard.patientIntro')}
        </p>
      </div>
    </section>
  )
}

// "View My Appointments" quick-action button, built as its own standalone
// component per exact spec:
// fixed height, a right-half glass gloss overlay, and a lighter/larger
// watermark badge than the generic card uses.
function ViewAppointmentsQuickAction({
  to,
  title,
  subtitle,
}: {
  to: string
  title: string
  subtitle: string
}) {
  return (
    <Link
      to={to}
      className="patient-hover-lift relative flex w-full items-center justify-between overflow-hidden rounded-2xl p-6"
      style={{ background: 'linear-gradient(to right, #3BC9CB 0%, #48E5E5 100%)' }}
    >
      {/* Decorative overlay shape, exact Figma dimensions. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-6 -top-6 h-[114.5px] w-[128px] rounded-full bg-white/22"
      />

      <div className="z-10 flex items-center gap-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white shadow-sm">
          <ArrowRight size={18} strokeWidth={2} className="rtl:rotate-180" style={{ color: '#0EA5E9' }} />
        </span>
        <div>
          <div className="text-base font-semibold leading-snug text-white">{title}</div>
          <div className="mt-0.5 text-sm font-normal" style={{ color: 'rgba(255,255,255,0.9)' }}>
            {subtitle}
          </div>
        </div>
      </div>

      <span className="z-10 flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
        <CalendarDays size={22} strokeWidth={1.5} className="text-white" />
      </span>
    </Link>
  )
}

// "Book New Appointment" quick-action button — same standalone treatment as
// ViewAppointmentsQuickAction, blue palette + Clock watermark.
function BookAppointmentQuickAction({ to, title, subtitle }: { to: string; title: string; subtitle: string }) {
  return (
    <Link
      to={to}
      className="patient-hover-lift relative flex w-full items-center overflow-hidden rounded-2xl p-6"
      style={{ background: 'linear-gradient(to right, #0769AE 0%, #4B9AF0 100%)' }}
    >
      {/* Decorative overlay shape, exact Figma dimensions. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-6 -top-6 h-[114.5px] w-[128px] rounded-full bg-white/10"
      />

      <span className="z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white shadow-sm">
        <ArrowRight size={18} strokeWidth={2} className="rtl:rotate-180" style={{ color: '#0284C7' }} />
      </span>
      <div className="z-10 ms-4 me-6 min-w-0 flex-1">
        <div className="text-base font-semibold leading-snug text-white">{title}</div>
        <div className="mt-0.5 text-sm font-normal" style={{ color: 'rgba(255,255,255,0.85)' }}>
          {subtitle}
        </div>
      </div>

      <span className="z-10 ms-auto flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
        <Clock size={22} strokeWidth={1.5} className="text-white" />
      </span>
    </Link>
  )
}

// DESIGN.md §4.F, refined per the summary-card component spec: the two count
// cards show value+unit inline on one baseline; the prescription card stacks
// its action link below a dark (not brand-colored) value on its own line.
function SummaryCard({
  icon: Icon,
  iconBg,
  iconColor,
  title,
  value,
  valueColor,
  layoutVariant,
  subtitle,
  action,
}: {
  icon: (props: SolidIconProps) => React.JSX.Element
  iconBg: string
  iconColor: string
  title: string
  value: string
  valueColor: string
  layoutVariant: 'inline' | 'stacked'
  subtitle?: string
  action?: { to: string; label: string }
}) {
  return (
    <div className="rounded-card flex items-center justify-between border border-[#F3F4F6] bg-white p-6 shadow-sm">
      <div className="min-w-0">
        <div className="patient-text-body-secondary text-[#94A3B8]">{title}</div>
        {layoutVariant === 'inline' ? (
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="truncate font-extrabold" style={{ fontSize: '1.5rem', color: valueColor }}>
              {value}
            </span>
            {subtitle && (
              <span className="patient-text-body-secondary text-[#94A3B8] whitespace-nowrap">{subtitle}</span>
            )}
          </div>
        ) : (
          <>
            <div className="mt-1 truncate font-bold" style={{ fontSize: '1.125rem', color: valueColor }}>
              {value}
            </div>
            {action && (
              <Link
                to={action.to}
                className="patient-text-body-secondary mt-1 inline-block hover:underline"
                style={{ color: '#1E73E8' }}
              >
                {action.label}
              </Link>
            )}
          </>
        )}
      </div>
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full" style={{ background: iconBg }}>
        <Icon className="h-6 w-6" color={iconColor} />
      </span>
    </div>
  )
}

export function PatientDashboard() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { user } = useAuth()

  const { data: apptData, isLoading: apptsLoading } = useQuery({
    queryKey: ['appointments', 'mine'],
    queryFn: () => appointmentsApi.list(),
  })
  const { data: prescriptions = [] } = useQuery({
    queryKey: ['prescriptions', 'mine'],
    queryFn: () => medicalApi.prescriptions(),
  })
  const { data: labs = [] } = useQuery({
    queryKey: ['labs', 'mine'],
    queryFn: () => medicalApi.labs(),
  })

  const upcoming = (apptData?.results ?? []).filter((a) =>
    ['PENDING', 'CONFIRMED', 'CHECKED_IN'].includes(a.status),
  )

  const latestPrescription = [...prescriptions].sort(
    (a, b) => new Date(b.issued_date).getTime() - new Date(a.issued_date).getTime(),
  )[0]

  const recentLabsCount = labs.filter((l) => {
    if (!l.result_date) return false
    const ageDays = (Date.now() - new Date(l.result_date).getTime()) / 86_400_000
    return ageDays <= RECENT_LAB_WINDOW_DAYS
  }).length

  const timeOnly = (iso: string) =>
    new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
  // Widget value only — no weekday, matching DESIGN.md's own "May 12, 2024" example.
  const shortDate = (iso: string) =>
    new Intl.DateTimeFormat(language, { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(iso))
  // Appointment-card date: one inline string ("Wed, Aug 5, 2026") instead of a
  // stacked weekday/date pair — stacking made row height (and thus wrapping)
  // depend on each card's own content, so cards looked inconsistent next to
  // each other.
  const dateWithWeekday = (iso: string) =>
    new Intl.DateTimeFormat(language, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(
      new Date(iso),
    )

  return (
    <div className="mx-auto flex max-w-[1611px] flex-col gap-8 pb-[90px]">
      <WelcomeBanner name={user?.first_name || user?.email || ''} />

      <section>
        <h2 className="patient-text-h2" style={{ color: '#1F2937', marginBottom: '1rem' }}>
          {t('dashboard.quickActionsTitle')}
        </h2>
        {/* Exactly 2 cards — capped at 2 columns rather than opening a 3rd
            empty column at lg+ like a generic 3-card grid would. This section
            sits outside the lg:grid-cols-3 sidebar layout below, so it always
            has the full page width — the sidebar itself doesn't reappear
            until lg (1024px), so a 2-up split from sm (640px) never gets
            squeezed. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <BookAppointmentQuickAction
            to="/patient/book"
            title={t('dashboard.bookApptTitle')}
            subtitle={t('dashboard.bookApptSubtitle')}
          />
          <ViewAppointmentsQuickAction
            to="/patient/appointments"
            title={t('dashboard.viewApptsTitle')}
            subtitle={t('dashboard.viewApptsSubtitle')}
          />
        </div>
      </section>

      {/* Mobile/tablet (<lg) DOM order is the visual order: Upcoming, then
          the summary cards, then Need Help last. At lg+ each item gets an
          explicit grid position instead, restoring the two-column desktop
          layout (Upcoming+NeedHelp stacked on the left, summary cards
          filling the right column) regardless of that DOM order. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:grid-rows-[auto_auto]">
        <section className="flex flex-col gap-4 lg:col-start-1 lg:col-span-2 lg:row-start-1">
          <div className="flex items-center justify-between">
            <h2 className="patient-text-h2" style={{ color: '#1F2937' }}>
              {t('dashboard.upcoming')}
            </h2>
            <Link
              to="/patient/appointments"
              className="patient-text-body-secondary hover:underline"
              style={{ color: 'var(--brand-blue-start)' }}
            >
              {t('dashboard.viewAll')}
            </Link>
          </div>
          {apptsLoading ? (
            <CenteredSpinner />
          ) : upcoming.length === 0 ? (
            <p className="patient-text-body" style={{ color: 'var(--text-secondary)' }}>
              {t('appointments.none')}
            </p>
          ) : (
            upcoming.map((a) => {
              const pill = STATUS_PILL[a.status] ?? STATUS_PILL.CANCELLED
              return (
                <div
                  key={a.id}
                  className="flex w-full flex-col items-start gap-3 overflow-hidden rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm"
                >
                  {/* Header: avatar+name/type vs. status badge — its own row so it
                      never has to compete with the date/time line for width. */}
                  <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex w-full items-center gap-3">
                      <MoreVertical size={16} className="hidden shrink-0 sm:block" style={{ color: 'var(--text-muted)' }} />
                      <img src={avatarUrl(a.doctor_name)} alt="" className="h-10 w-10 shrink-0 rounded-full" />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <div className="patient-text-card-title truncate" style={{ color: 'var(--text-primary)' }}>
                          {a.doctor_name}
                        </div>
                        <div className="truncate text-xs font-medium text-slate-500">{a.type_display}</div>
                      </div>
                    </div>
                    <span
                      className="patient-text-badge shrink-0 self-start whitespace-nowrap rounded-full border px-3 py-1 sm:self-center"
                      style={{ background: pill.bg, borderColor: pill.border, color: pill.text }}
                    >
                      {t(`status.${a.status}`)}
                    </span>
                  </div>

                  {/* Date & time — same two flex items in every card, so the
                      row lines up card-to-card instead of drifting with
                      each card's own content. */}
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                    <div className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-slate-600">
                      <Calendar size={16} className="shrink-0" />
                      {dateWithWeekday(a.scheduled_start)}
                    </div>
                    <div className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-slate-600">
                      <Clock size={16} className="shrink-0" />
                      {timeOnly(a.scheduled_start)}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </section>

        {/* sm/md widen this to 2/3 columns since it has the full page width
            up to lg — at lg (1024px) this column narrows to 1/3 of the page
            (sidebar reappears), so it drops back to grid-cols-1 there rather
            than cramming 3 cards into that space. Spans both explicit rows at
            lg so it runs the full height of the Upcoming+NeedHelp column
            next to it. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:col-start-3 lg:col-span-1 lg:row-start-1 lg:row-span-2 lg:grid-cols-1">
          <SummaryCard
            icon={CalendarCheckSolidIcon}
            iconBg="#E6F7F7"
            iconColor="var(--brand-teal-start)"
            title={t('dashboard.upcomingWidget')}
            layoutVariant="inline"
            value={String(upcoming.length)}
            valueColor="var(--brand-teal-start)"
            subtitle={t('dashboard.appointmentsUnit')}
          />
          <SummaryCard
            icon={PrescriptionDocSolidIcon}
            iconBg="var(--status-info-bg)"
            iconColor="var(--btn-blue)"
            title={t('dashboard.latestPrescription')}
            layoutVariant="stacked"
            value={latestPrescription ? shortDate(latestPrescription.issued_date) : t('medical.noPrescriptions')}
            valueColor="var(--text-primary)"
            action={
              latestPrescription
                ? { to: '/patient/prescriptions', label: t('dashboard.viewPrescription') }
                : undefined
            }
          />
          <SummaryCard
            icon={FlaskSolidIcon}
            iconBg="var(--brand-purple-bg)"
            iconColor="#7C3AED"
            title={t('dashboard.newLabResults')}
            layoutVariant="inline"
            value={String(recentLabsCount)}
            valueColor="#7C3AED"
            subtitle={t('dashboard.resultsUnit')}
          />
        </div>

        {/* Last in the mobile/tablet flow — Quick Actions, Upcoming, summary
            cards, then this. At lg it moves back under Upcoming Appointments,
            in the same left column. Row layout needs ~470px+ of container
            width (fixed illustration + button leave little slack for the
            text): available at sm through just-under-lg (full page width
            here, sidebar not shown yet) and again from xl (this column is
            wide enough again by then) — but NOT at lg itself, where the
            sidebar reappears and the column narrows to ~1/3 of the page,
            squeezing the row down to one word per line. */}
        <section
          className="flex flex-col items-center justify-between gap-4 rounded-2xl border p-6 sm:flex-row lg:col-start-1 lg:col-span-2 lg:row-start-2 lg:flex-col xl:flex-row"
          style={{ background: '#F1F5F9', borderColor: '#E2E8F0' }}
        >
          <div className="flex items-center gap-6">
            <img src="/SupportTeam.svg" alt="" className="h-[56px] w-[89.84px] shrink-0 object-contain" />
            <div className="flex flex-col gap-1">
              <h3 className="patient-text-card-title" style={{ color: 'var(--text-primary)' }}>
                {t('dashboard.needHelp')}
              </h3>
              <p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>
                {t('dashboard.needHelpBody')}
              </p>
            </div>
          </div>
          <a
            href="mailto:support@clinic.example"
            className="patient-text-body flex shrink-0 items-center gap-2 rounded-xl px-6 py-3 font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, #0769AE 0%, #4B9AF0 100%)' }}
          >
            <Phone size={16} />
            {t('dashboard.contactSupport')}
          </a>
        </section>
      </div>
    </div>
  )
}
