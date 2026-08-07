import { ArrowRightLeft, Bell, ChevronDown, Clock, Folder, LogOut, Menu, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '../../hooks/useAuth'
import { useLanguage } from '../../hooks/useLanguage'
import { authApi } from '../../services/auth.api'
import type { Language } from '../../services/types'
import { Logo } from './Logo'
import { PatientHeaderBell } from './PatientHeaderBell'

type NavIcon = (props: { className?: string }) => React.JSX.Element

interface NavItem {
  to: string
  labelKey: string
  icon: NavIcon
  end?: boolean
}

// Hardcoded solid (Heroicons-sourced) icons for the sidebar nav, per exact
// spec — lucide has no solid variant, so these are separate from the rest
// of the app's line icons. Kept prop-less on color: each is rendered inside
// a NavLink that already sets `color` via style/text-white, and
// fill="currentColor" inherits that the normal CSS way.
function HomeSolidIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M11.47 3.84a.75.75 0 011.06 0l8.69 8.69a.75.75 0 101.06-1.06l-8.689-8.69a2.25 2.25 0 00-3.182 0l-8.69 8.69a.75.75 0 001.06 1.06l8.69-8.69z" />
      <path d="M12 5.432l8.159 8.159c.03.03.06.058.091.086v6.198c0 1.035-.84 1.875-1.875 1.875H15a.75.75 0 01-.75-.75v-4.5a.75.75 0 00-.75-.75h-3a.75.75 0 00-.75.75V21a.75.75 0 01-.75.75H5.625a1.875 1.875 0 01-1.875-1.875v-6.198a2.29 2.29 0 00.091-.086L12 5.43z" />
    </svg>
  )
}

function BookAppointmentSolidIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12.75 12.75a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM7.5 15.75a.75.75 0 100-1.5.75.75 0 000 1.5zM8.25 17.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM9.75 15.75a.75.75 0 100-1.5.75.75 0 000 1.5zM10.5 17.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12 15.75a.75.75 0 100-1.5.75.75 0 000 1.5zM12.75 17.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM14.25 15.75a.75.75 0 100-1.5.75.75 0 000 1.5zM15 17.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM16.5 15.75a.75.75 0 100-1.5.75.75 0 000 1.5zM15 12.75a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM16.5 13.5a.75.75 0 100-1.5.75.75 0 000 1.5z" />
      <path
        fillRule="evenodd"
        d="M6.75 2.25A.75.75 0 017.5 3v1.5h9V3A.75.75 0 0118 3v1.5h.75a3 3 0 013 3v11.25a3 3 0 01-3 3H5.25a3 3 0 01-3-3V7.5a3 3 0 013-3H6V3a.75.75 0 01.75-.75zm13.5 9a1.5 1.5 0 00-1.5-1.5H5.25a1.5 1.5 0 00-1.5 1.5v7.5a1.5 1.5 0 001.5 1.5h13.5a1.5 1.5 0 001.5-1.5v-7.5z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function PrescriptionsSolidIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 9a.75.75 0 00-1.5 0v2.25H9a.75.75 0 000 1.5h2.25V15a.75.75 0 001.5 0v-2.25H15a.75.75 0 000-1.5h-2.25V9z"
        clipRule="evenodd"
      />
    </svg>
  )
}

// Outline, not solid — Heroicons has no solid Beaker variant, and this is
// the one item where the outline shape (narrow neck, wide angled base) is
// what actually reads as a lab flask.
function LabResultsBeakerIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="1.5"
      stroke="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 4.206c.32 1.06-.472 2.144-1.584 2.144H4.382c-1.112 0-1.904-1.084-1.584-2.144l1.402-4.206"
      />
    </svg>
  )
}

function TimelineNodesSolidIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M6 3a3 3 0 10-3 3 3 3 0 003-3zM18 9a3 3 0 10-3 3 3 3 0 003-3zM6 21a3 3 0 10-3 3 3 3 0 003-3z" />
      <path d="M14.586 10.414a2 2 0 00-2.828 0l-5.758 5.758a3 3 0 101.414 1.414l5.758-5.758a2 2 0 000-2.828z" />
    </svg>
  )
}

function ScansLabsSolidIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M1.5 6a2.25 2.25 0 012.25-2.25h16.5A2.25 2.25 0 0122.5 6v12a2.25 2.25 0 01-2.25 2.25H3.75A2.25 2.25 0 011.5 18V6zM3 16.06V18c0 .414.336.75.75.75h16.5A.75.75 0 0021 18v-1.94l-2.69-2.689a1.5 1.5 0 00-2.12 0l-.88.879.97.97a.75.75 0 11-1.06 1.06l-5.16-5.159a1.5 1.5 0 00-2.12 0L3 16.061zm10.125-7.81a1.125 1.125 0 112.25 0 1.125 1.125 0 01-2.25 0z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function VitalsSolidIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
    </svg>
  )
}

function InvoicesSolidIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0016.5 9h-1.875a1.875 1.875 0 01-1.875-1.875V5.25A3.75 3.75 0 009 1.5H5.625zM7.5 15a.75.75 0 01.75-.75h7.5a.75.75 0 010 1.5h-7.5A.75.75 0 017.5 15zm.75 2.25a.75.75 0 000 1.5H12a.75.75 0 000-1.5H8.25z"
        clipRule="evenodd"
      />
      <path d="M12.971 1.816A5.23 5.23 0 0114.25 5.25v1.875c0 .207.168.375.375.375H16.5a5.23 5.23 0 013.434 1.279 9.768 9.768 0 00-6.963-6.963z" />
    </svg>
  )
}

// Wraps a lucide component to the same {className} call signature as the
// hand-authored solids above, so NAV_GROUPS can mix both uniformly.
function fromLucide(LucideComp: React.ComponentType<{ className?: string }>): NavIcon {
  return ({ className }) => <LucideComp className={className} />
}

// Radiology intentionally has no sidebar entry (not in the target nav), but
// the route itself is left in router.tsx so the page stays reachable directly
// rather than deleting a working feature over a nav-only request.
const NAV_GROUPS: { headerKey: string; items: NavItem[] }[] = [
  {
    headerKey: 'nav.sectionMain',
    items: [
      { to: '/patient', labelKey: 'nav.patientDashboard', icon: HomeSolidIcon, end: true },
      { to: '/patient/book', labelKey: 'nav.bookAppointment', icon: BookAppointmentSolidIcon },
      { to: '/patient/appointments', labelKey: 'nav.myAppointments', icon: fromLucide(Clock) },
    ],
  },
  {
    headerKey: 'nav.sectionRecords',
    items: [
      { to: '/patient/history', labelKey: 'nav.medicalHistory', icon: fromLucide(Folder) },
      { to: '/patient/prescriptions', labelKey: 'nav.prescriptions', icon: PrescriptionsSolidIcon },
      { to: '/patient/scans', labelKey: 'nav.scansLabs', icon: ScansLabsSolidIcon },
      { to: '/patient/lab-results', labelKey: 'nav.labResults', icon: LabResultsBeakerIcon },
      { to: '/patient/vitals', labelKey: 'nav.vitals', icon: VitalsSolidIcon },
      { to: '/patient/timeline', labelKey: 'nav.timeline', icon: TimelineNodesSolidIcon },
    ],
  },
  {
    headerKey: 'nav.sectionServices',
    items: [
      { to: '/patient/invoices', labelKey: 'nav.myInvoices', icon: InvoicesSolidIcon },
      { to: '/patient/referrals', labelKey: 'nav.myReferrals', icon: fromLucide(ArrowRightLeft) },
    ],
  },
  {
    headerKey: 'nav.sectionSettings',
    items: [{ to: '/patient/settings', labelKey: 'notifications.title', icon: fromLucide(Bell) }],
  },
]

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items)

function avatarUrl(name: string, size: number) {
  return `https://ui-avatars.com/api/?background=1AB5B3&color=fff&size=${size}&name=${encodeURIComponent(name)}`
}

// Plain-text "AR | EN": inactive is gray with a hover step, active is sky-blue
// and underlined. Buttons need an explicit border-0 bg-transparent reset —
// .patient-shell skips Tailwind preflight, so unstyled <button>s otherwise
// keep native browser chrome (a visible box), not just the className's look.
function PatientLanguageToggle() {
  const { language, setLanguage } = useLanguage()
  const { user } = useAuth()

  const change = (lng: Language) => {
    setLanguage(lng)
    if (user) void authApi.updateMe({ preferred_language: lng }).catch(() => {})
  }

  const option = (lng: Language, label: string) => {
    const active = language === lng
    return (
      <button
        type="button"
        onClick={() => change(lng)}
        className={
          active
            ? 'border-0 bg-transparent p-0 text-cyan-500 underline underline-offset-4'
            : 'cursor-pointer border-0 bg-transparent p-0 text-gray-400 hover:text-gray-600'
        }
      >
        {label}
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1.5 text-xs font-semibold">
      {option('ar', 'AR')}
      <span aria-hidden="true" className="text-gray-300">
        |
      </span>
      {option('en', 'EN')}
    </div>
  )
}

// DESIGN.md §4.A/B — sidebar + header shell for the Patient role only.
export function PatientShell() {
  const { t } = useTranslation()
  const { user, logout } = useAuth()
  const location = useLocation()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  if (!user) return null

  const displayName = user.full_name || user.email
  const currentItem = ALL_ITEMS.find((item) =>
    item.end ? location.pathname === item.to : location.pathname.startsWith(item.to),
  )

  return (
    <div className="patient-shell flex min-h-screen">
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm transition-opacity md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`patient-sidebar z-[60] flex h-screen w-[296px] shrink-0 flex-col border-r border-[#E5E7EB] bg-white transition-transform duration-200 ${
          mobileNavOpen ? 'is-open' : ''
        }`}
      >
        {/* Fixed to h-20, same as the page header, so their bottom borders
            align across the sidebar/header boundary at the top of the page. */}
        <div className="flex h-20 shrink-0 items-center justify-between border-b border-[#F3F4F6] px-6">
          <Link to="/patient">
            <Logo className="h-[54px] w-[122px] object-contain" />
          </Link>
          <button
            type="button"
            className="border-0 bg-transparent p-1 md:hidden"
            onClick={() => setMobileNavOpen(false)}
            aria-label={t('nav.close')}
          >
            <X size={20} style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>

        <nav
          className="patient-hide-scrollbar flex flex-1 flex-col space-y-8 overflow-y-auto px-4 py-6"
          aria-label={t('nav.dashboard')}
        >
          {NAV_GROUPS.map((group) => (
            <div key={group.headerKey}>
              <div className="patient-text-overline mb-2" style={{ color: 'var(--text-muted)' }}>
                {t(group.headerKey)}
              </div>
              <div className="flex flex-col gap-3">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setMobileNavOpen(false)}
                    className={({ isActive }) =>
                      `patient-hover-lift rounded-btn patient-text-body flex w-full items-center gap-3 px-3 py-[10px] ${
                        isActive ? 'patient-gradient-active-nav' : 'hover:bg-bg-app'
                      }`
                    }
                    style={({ isActive }) => ({ color: isActive ? '#FFFFFF' : '#334155' })}
                  >
                    <item.icon className="h-5 w-5 shrink-0" />
                    <span>{t(item.labelKey)}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="flex flex-col gap-3 border-t border-[#F3F4F6] p-4">
          <div className="flex items-center justify-between rounded-xl p-3" style={{ background: '#F9FAFB' }}>
            <div className="flex items-center gap-3">
              <img src={avatarUrl(displayName, 72)} alt="" className="h-9 w-9 rounded-full" />
              <div className="min-w-0">
                <div className="patient-text-body truncate font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {displayName}
                </div>
                <div className="patient-text-body-secondary truncate" style={{ color: 'var(--text-secondary)' }}>
                  {t('roles.PATIENT')}
                </div>
              </div>
            </div>
            <ChevronDown size={16} className="shrink-0" style={{ color: 'var(--text-muted)' }} />
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            className="patient-text-body flex w-full items-center justify-center gap-2 rounded-xl border py-[10px] font-semibold"
            style={{ borderColor: '#FEE2E2', color: '#EF4444', background: '#FFFFFF' }}
          >
            {t('nav.logOut')}
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-20 w-full shrink-0 items-center justify-between border-b border-[#E5E7EB] bg-white/80 px-4 backdrop-blur-md sm:px-6 lg:px-10">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="-ms-1 border-0 bg-transparent p-2 md:hidden"
              onClick={() => setMobileNavOpen(true)}
              aria-label={t('nav.menu')}
            >
              <Menu size={22} style={{ color: 'var(--text-secondary)' }} />
            </button>
            <Link to="/patient" className="md:hidden">
              <Logo className="h-8 w-auto object-contain" />
            </Link>
            <h1 className="hidden text-2xl font-bold leading-8 md:block lg:text-3xl" style={{ color: '#1C4879' }}>
              {t(currentItem?.labelKey ?? 'nav.dashboard')}
            </h1>
          </div>
          <div className="flex h-[44px] items-center gap-4 sm:gap-6">
            <img
              src={avatarUrl(displayName, 64)}
              alt=""
              className="h-9 w-9 rounded-full border border-gray-200 object-cover"
            />
            <PatientHeaderBell />
            <div className="hidden h-6 w-px bg-gray-200 md:block" aria-hidden="true" />
            <div className="hidden md:block">
              <PatientLanguageToggle />
            </div>
          </div>
        </header>
        <main className="min-h-screen flex-1 overflow-x-hidden bg-slate-50/50 p-4 transition-all sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
