import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'

import type { Role } from '../../services/types'

interface NavItem { to: string; key: string }

const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  PATIENT: [
    { to: '/patient', key: 'nav.dashboard' },
    { to: '/patient/book', key: 'nav.bookAppointment' },
    { to: '/patient/appointments', key: 'nav.myAppointments' },
    { to: '/patient/history', key: 'nav.medicalHistory' },
    { to: '/patient/scans', key: 'nav.scansLabs' },
    { to: '/patient/prescriptions', key: 'nav.prescriptions' },
    { to: '/patient/vitals', key: 'nav.vitals' },
    { to: '/patient/lab-results', key: 'nav.labResults' },
    { to: '/patient/timeline', key: 'nav.timeline' },
    { to: '/patient/invoices', key: 'nav.myInvoices' },
    { to: '/patient/referrals', key: 'nav.myReferrals' },
  ],
  DOCTOR: [
    { to: '/doctor', key: 'nav.dashboard' },
    { to: '/doctor/queue', key: 'nav.liveQueue' },
    { to: '/doctor/schedule', key: 'nav.schedule' },
    { to: '/doctor/appointments', key: 'nav.appointments' },
    { to: '/doctor/patients', key: 'nav.patients' },
    { to: '/doctor/reviews', key: 'nav.reviews' },
    { to: '/doctor/lab-orders', key: 'nav.labOrders' },
    { to: '/doctor/referrals', key: 'nav.referrals' },
  ],
  SECRETARY: [
    { to: '/secretary', key: 'nav.dashboard' },
    { to: '/secretary/desk', key: 'nav.appointmentDesk' },
    { to: '/secretary/queue', key: 'nav.queueBoard' },
    { to: '/secretary/patients', key: 'nav.allPatients' },
    { to: '/secretary/absences', key: 'nav.absences' },
    { to: '/secretary/doctors', key: 'nav.doctors' },
    { to: '/secretary/lab', key: 'nav.labOrders' },
    { to: '/secretary/billing', key: 'nav.billing' },
    { to: '/secretary/referrals', key: 'nav.referrals' },
  ],
  MANAGER: [
    { to: '/manager', key: 'nav.dashboard' },
    { to: '/manager/users', key: 'nav.users' },
    { to: '/secretary/doctors', key: 'nav.doctors' },
    { to: '/manager/reports', key: 'nav.reports' },
    { to: '/manager/billing', key: 'nav.billingReports' },
    { to: '/manager/reviews', key: 'nav.reviews' },
    { to: '/manager/audit', key: 'nav.auditLog' },
  ],
}

const NAV_ICONS: Record<string, string> = {
  'nav.dashboard':       '🏠',
  'nav.bookAppointment': '📅',
  'nav.myAppointments':  '📋',
  'nav.medicalHistory':  '🩺',
  'nav.scansLabs':       '🔬',
  'nav.prescriptions':   '💊',
  'nav.liveQueue':       '⚡',
  'nav.schedule':        '🗓',
  'nav.appointments':    '📋',
  'nav.patients':        '👤',
  'nav.reviews':         '⭐',
  'nav.appointmentDesk': '📥',
  'nav.queueBoard':      '📊',
  'nav.allPatients':     '👥',
  'nav.absences':        '🚫',
  'nav.doctors':         '🩺',
  'nav.users':           '👥',
  'nav.reports':         '📈',
  'nav.auditLog':        '📜',
  'nav.vitals':          '❤️',
  'nav.labOrders':       '🧪',
  'nav.labResults':      '🧪',
  'nav.timeline':        '🕑',
  'nav.encounter':       '🩻',
  'nav.billing':         '💵',
  'nav.myInvoices':      '🧾',
  'nav.billingReports':  '💰',
  'nav.myReferrals':     '↪️',
  'nav.referrals':       '↪️',
}

export function RoleNav({ role }: { role: Role }) {
  const { t } = useTranslation()
  return (
    <nav className="shell__nav" aria-label={t('nav.dashboard')}>
      {/* Close button visible only on mobile */}
      <label htmlFor="nav-open" className="nav-close-btn" aria-label={t('nav.close')}>✕</label>

      {NAV_BY_ROLE[role].map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to.split('/').length <= 2}
          className={({ isActive }) => `navlink ${isActive ? 'navlink--active' : ''}`}
        >
          <span className="navlink__icon" aria-hidden="true">{NAV_ICONS[item.key] ?? '•'}</span>
          <span>{t(item.key)}</span>
        </NavLink>
      ))}
    </nav>
  )
}
