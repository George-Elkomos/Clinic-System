import { createBrowserRouter } from 'react-router-dom'

import { AppShell } from '../components/layout/AppShell'
import { ForbiddenPage, NotFoundPage } from '../pages/public/ErrorPages'
import { KioskQueuePage } from '../pages/public/KioskQueuePage'
import { LoginPage } from '../pages/public/LoginPage'
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
import { DoctorDashboard } from '../pages/doctor/DoctorDashboard'
import { DoctorQueuePage } from '../pages/doctor/DoctorQueuePage'
import { ScheduleManagementPage } from '../pages/doctor/ScheduleManagementPage'
import { DoctorAppointmentsPage } from '../pages/doctor/DoctorAppointmentsPage'
import { PatientRecordPage } from '../pages/doctor/PatientRecordPage'
import { DoctorReviewsPage } from '../pages/doctor/DoctorReviewsPage'
import { LabOrdersListPage } from '../pages/doctor/LabOrdersListPage'
import { CreateLabOrderPage } from '../pages/doctor/CreateLabOrderPage'
import { LabOrderDetailsPage } from '../pages/doctor/LabOrderDetailsPage'
import { PatientLabResultsPage } from '../pages/patient/PatientLabResultsPage'
import { SampleCollectionPage } from '../pages/secretary/SampleCollectionPage'
import { SecretaryDashboard } from '../pages/secretary/SecretaryDashboard'
import { AppointmentDeskPage } from '../pages/secretary/AppointmentDeskPage'
import { DoctorsPage } from '../pages/secretary/DoctorsPage'
import { QueueBoardPage } from '../pages/secretary/QueueBoardPage'
import { DoctorAbsencePage } from '../pages/secretary/DoctorAbsencePage'
import { ManagerDashboard } from '../pages/manager/ManagerDashboard'
import { AuditLogPage } from '../pages/manager/AuditLogPage'
import { ReportsDashboardPage } from '../pages/manager/ReportsDashboardPage'
import { ReviewModerationPage } from '../pages/manager/ReviewModerationPage'
import { UserManagementPage } from '../pages/manager/UserManagementPage'
import { CreateDoctorPage } from '../pages/manager/CreateDoctorPage'
import { PatientDirectoryPage } from '../pages/secretary/PatientDirectoryPage'
import { NotificationPrefsPage } from '../pages/account/NotificationPrefsPage'
import { RoleRoute } from './RoleRoute'
import { RootRedirect } from './RootRedirect'

export const router = createBrowserRouter([
  { path: '/', element: <RootRedirect /> },

  // Public — no login required.
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/kiosk/:doctorId', element: <KioskQueuePage /> },
  { path: '/doctors', element: <PublicDoctorsPage /> },
  { path: '/doctors/:id', element: <DoctorDetailPage /> },
  { path: '/403', element: <ForbiddenPage /> },

  // Patient
  {
    path: '/patient',
    element: <RoleRoute roles={['PATIENT']}><AppShell /></RoleRoute>,
    children: [
      { index: true, element: <PatientDashboard /> },
      { path: 'book', element: <BookAppointmentPage /> },
      { path: 'appointments', element: <MyAppointmentsPage /> },
      { path: 'history', element: <MyMedicalHistoryPage /> },
      { path: 'scans', element: <MyScansLabsPage /> },
      { path: 'prescriptions', element: <MyPrescriptionsPage /> },
      { path: 'vitals', element: <PatientVitalSignsTab /> },
      { path: 'lab-results', element: <PatientLabResultsPage /> },
    ],
  },

  // Doctor
  {
    path: '/doctor',
    element: <RoleRoute roles={['DOCTOR']}><AppShell /></RoleRoute>,
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
    ],
  },

  // Secretary
  {
    path: '/secretary',
    element: <RoleRoute roles={['SECRETARY', 'MANAGER']}><AppShell /></RoleRoute>,
    children: [
      { index: true, element: <SecretaryDashboard /> },
      { path: 'desk', element: <AppointmentDeskPage /> },
      { path: 'queue', element: <QueueBoardPage /> },
      { path: 'absences', element: <DoctorAbsencePage /> },
      { path: 'doctors', element: <DoctorsPage /> },
      { path: 'patients', element: <PatientDirectoryPage /> },
      { path: 'lab', element: <SampleCollectionPage /> },
      { path: 'lab/:id', element: <LabOrderDetailsPage /> },
    ],
  },

  // Account settings — available to every authenticated role.
  {
    path: '/account',
    element: <RoleRoute roles={['PATIENT', 'DOCTOR', 'SECRETARY', 'MANAGER']}><AppShell /></RoleRoute>,
    children: [
      { path: 'notifications', element: <NotificationPrefsPage /> },
    ],
  },

  // Manager
  {
    path: '/manager',
    element: <RoleRoute roles={['MANAGER']}><AppShell /></RoleRoute>,
    children: [
      { index: true, element: <ManagerDashboard /> },
      { path: 'reports', element: <ReportsDashboardPage /> },
      { path: 'reviews', element: <ReviewModerationPage /> },
      { path: 'audit', element: <AuditLogPage /> },
      { path: 'users', element: <UserManagementPage /> },
      { path: 'doctors/new', element: <CreateDoctorPage /> },
    ],
  },

  { path: '*', element: <NotFoundPage /> },
])
