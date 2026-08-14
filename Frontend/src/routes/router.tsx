import { createBrowserRouter } from 'react-router-dom'

import { PortalShell } from '../components/layout/PortalShell'
import { ForbiddenPage, NotFoundPage } from '../pages/public/ErrorPages'
import { KioskQueuePage } from '../pages/public/KioskQueuePage'
import { LoginPage } from '../pages/public/LoginPage'
import { ForgotPasswordPage } from '../pages/public/ForgotPasswordPage'
import { ResetPasswordPage } from '../pages/public/ResetPasswordPage'
import { PublicDoctorsPage } from '../pages/public/PublicDoctorsPage'
import { DoctorDetailPage } from '../pages/public/DoctorDetailPage'
import { RegisterPage } from '../pages/public/RegisterPage'
import { PatientDashboard } from '../pages/patient/PatientDashboard'
import { BookAppointmentPage } from '../pages/patient/BookAppointmentPage'
import { MyAppointmentsPage } from '../pages/patient/MyAppointmentsPage'
import { MyMedicalHistoryPage } from '../pages/patient/MyMedicalHistoryPage'
import { MyScansLabsPage } from '../pages/patient/MyScansLabsPage'
import { MyPrescriptionsPage } from '../pages/patient/MyPrescriptionsPage'
import { PatientVitalSignsTab } from '../pages/patient/PatientVitalSignsTab'
import { PatientTimelinePage } from '../pages/patient/PatientTimelinePage'
import { MyProfilePage as PatientMyProfilePage } from '../pages/patient/MyProfilePage'
import { DoctorDashboard } from '../pages/doctor/DoctorDashboard'
import { DoctorQueuePage } from '../pages/doctor/DoctorQueuePage'
import { ScheduleManagementPage } from '../pages/doctor/ScheduleManagementPage'
import { DoctorAppointmentsPage } from '../pages/doctor/DoctorAppointmentsPage'
import { PatientRecordPage } from '../pages/doctor/PatientRecordPage'
import { DoctorReviewsPage } from '../pages/doctor/DoctorReviewsPage'
import { MyProfilePage } from '../pages/doctor/MyProfilePage'
import { LabOrdersListPage } from '../pages/doctor/LabOrdersListPage'
import { CreateLabOrderPage } from '../pages/doctor/CreateLabOrderPage'
import { LabOrderDetailsPage } from '../pages/doctor/LabOrderDetailsPage'
import { EncounterPage } from '../pages/doctor/EncounterPage'
import { PatientLabResultsPage } from '../pages/patient/PatientLabResultsPage'
import { SampleCollectionPage } from '../pages/secretary/SampleCollectionPage'
import { SecretaryDashboard } from '../pages/secretary/SecretaryDashboard'
import { AppointmentDeskPage } from '../pages/secretary/AppointmentDeskPage'
import { BookAppointmentPage as SecretaryBookAppointmentPage } from '../pages/secretary/BookAppointmentPage'
import { DoctorsPage } from '../pages/secretary/DoctorsPage'
import { QueueBoardPage } from '../pages/secretary/QueueBoardPage'
import { DoctorAbsencePage } from '../pages/secretary/DoctorAbsencePage'
import { PrescriptionsDeskPage } from '../pages/secretary/PrescriptionsDeskPage'
import { ManagerDashboard } from '../pages/manager/ManagerDashboard'
import { AuditLogPage } from '../pages/manager/AuditLogPage'
import { ReportsDashboardPage } from '../pages/manager/ReportsDashboardPage'
import { ReviewModerationPage } from '../pages/manager/ReviewModerationPage'
import { UserManagementPage } from '../pages/manager/UserManagementPage'
import { CreateDoctorPage } from '../pages/manager/CreateDoctorPage'
import { PatientDirectoryPage } from '../pages/secretary/PatientDirectoryPage'
import { BillingDeskPage } from '../pages/secretary/BillingDeskPage'
import { MyInvoicesPage } from '../pages/patient/MyInvoicesPage'
import { BillingReportsPage } from '../pages/manager/BillingReportsPage'
import { NotificationPrefsPage } from '../pages/account/NotificationPrefsPage'
import { AccountSettingsPage } from '../pages/account/AccountSettingsPage'
import { PatientNotificationSettingsPage } from '../pages/patient/PatientNotificationSettingsPage'
import { MustChangePasswordPage } from '../pages/account/MustChangePasswordPage'
import { MyReferralsPage } from '../pages/patient/MyReferralsPage'
import { DoctorReferralsPage } from '../pages/doctor/DoctorReferralsPage'
import { SecretaryReferralsPage } from '../pages/secretary/SecretaryReferralsPage'
import { MyRadiologyPage } from '../pages/patient/MyRadiologyPage'
import { RadiologyWorklistPage } from '../pages/secretary/RadiologyWorklistPage'
import { ProtectedRoute } from './ProtectedRoute'
import { RoleRoute } from './RoleRoute'
import { RootRedirect } from './RootRedirect'

export const router = createBrowserRouter([
  { path: '/', element: <RootRedirect /> },

  // Public — no login required.
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/kiosk/:doctorId', element: <KioskQueuePage /> },
  { path: '/doctors', element: <PublicDoctorsPage /> },
  { path: '/doctors/:id', element: <DoctorDetailPage /> },
  { path: '/403', element: <ForbiddenPage /> },

  // Patient
  {
    path: '/patient',
    element: <RoleRoute roles={['PATIENT']}><PortalShell /></RoleRoute>,
    children: [
      { index: true, element: <PatientDashboard /> },
      { path: 'book', element: <BookAppointmentPage /> },
      { path: 'appointments', element: <MyAppointmentsPage /> },
      { path: 'history', element: <MyMedicalHistoryPage /> },
      { path: 'scans', element: <MyScansLabsPage /> },
      { path: 'prescriptions', element: <MyPrescriptionsPage /> },
      { path: 'vitals', element: <PatientVitalSignsTab /> },
      { path: 'lab-results', element: <PatientLabResultsPage /> },
      { path: 'timeline', element: <PatientTimelinePage /> },
      { path: 'invoices', element: <MyInvoicesPage /> },
      { path: 'referrals', element: <MyReferralsPage /> },
      { path: 'radiology', element: <MyRadiologyPage /> },
      { path: 'profile', element: <PatientMyProfilePage /> },
      { path: 'settings', element: <PatientNotificationSettingsPage /> },
    ],
  },

  // Doctor
  {
    path: '/doctor',
    element: <RoleRoute roles={['DOCTOR']}><PortalShell /></RoleRoute>,
    children: [
      { index: true, element: <DoctorDashboard /> },
      { path: 'queue', element: <DoctorQueuePage /> },
      { path: 'schedule', element: <ScheduleManagementPage /> },
      { path: 'appointments', element: <DoctorAppointmentsPage /> },
      { path: 'patients', element: <PatientRecordPage /> },
      { path: 'reviews', element: <DoctorReviewsPage /> },
      { path: 'lab-orders', element: <LabOrdersListPage /> },
      { path: 'lab-orders/new', element: <CreateLabOrderPage /> },
      { path: 'lab-orders/:id', element: <LabOrderDetailsPage /> },
      { path: 'encounters/:appointmentId', element: <EncounterPage /> },
      { path: 'referrals', element: <DoctorReferralsPage /> },
      { path: 'profile', element: <MyProfilePage /> },
    ],
  },

  // Secretary
  {
    path: '/secretary',
    element: <RoleRoute roles={['SECRETARY', 'MANAGER']}><PortalShell /></RoleRoute>,
    children: [
      { index: true, element: <SecretaryDashboard /> },
      { path: 'booking', element: <SecretaryBookAppointmentPage /> },
      { path: 'desk', element: <AppointmentDeskPage /> },
      { path: 'queue', element: <QueueBoardPage /> },
      { path: 'absences', element: <DoctorAbsencePage /> },
      { path: 'doctors', element: <DoctorsPage /> },
      { path: 'patients', element: <PatientDirectoryPage /> },
      { path: 'lab', element: <SampleCollectionPage /> },
      { path: 'lab/:id', element: <LabOrderDetailsPage /> },
      { path: 'prescriptions', element: <PrescriptionsDeskPage /> },
      { path: 'billing', element: <BillingDeskPage /> },
      { path: 'referrals', element: <SecretaryReferralsPage /> },
      { path: 'radiology', element: <RadiologyWorklistPage /> },
    ],
  },

  // Forced password change — available to any authenticated role, no PortalShell.
  {
    path: '/change-password',
    element: <ProtectedRoute><MustChangePasswordPage /></ProtectedRoute>,
  },

  // Account settings — available to every authenticated role.
  {
    path: '/account',
    element: <RoleRoute roles={['PATIENT', 'DOCTOR', 'SECRETARY', 'MANAGER']}><PortalShell /></RoleRoute>,
    children: [
      { path: 'settings', element: <AccountSettingsPage /> },
      { path: 'notifications', element: <NotificationPrefsPage /> },
    ],
  },

  // Manager
  {
    path: '/manager',
    element: <RoleRoute roles={['MANAGER']}><PortalShell /></RoleRoute>,
    children: [
      { index: true, element: <ManagerDashboard /> },
      { path: 'reports', element: <ReportsDashboardPage /> },
      { path: 'billing', element: <BillingReportsPage /> },
      { path: 'reviews', element: <ReviewModerationPage /> },
      { path: 'audit', element: <AuditLogPage /> },
      { path: 'users', element: <UserManagementPage /> },
      { path: 'doctors/new', element: <CreateDoctorPage /> },
    ],
  },

  { path: '*', element: <NotFoundPage /> },
])
