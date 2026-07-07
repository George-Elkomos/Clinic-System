// Shared DTOs mirroring the Django/DRF API.

export type Role = 'PATIENT' | 'DOCTOR' | 'SECRETARY' | 'MANAGER'
export type Language = 'en' | 'ar'

export interface PatientProfile {
  id: number
  national_id: string | null
  date_of_birth: string | null
  gender: string
  blood_type: string
  address: string
  emergency_contact_name: string
  emergency_contact_phone: string
  allergies_summary: string
  chronic_conditions: string
  previous_surgeries: string
  current_medications: string
}

export interface NotificationPreference {
  email_enabled: boolean
  sms_enabled: boolean
  whatsapp_enabled: boolean
  in_app_enabled: boolean
  reminder_24h: boolean
  reminder_1h: boolean
}

export interface User {
  id: number
  email: string
  role: Role
  first_name: string
  last_name: string
  full_name: string
  phone: string
  preferred_language: Language
  patient_profile?: PatientProfile | null
  notification_preference?: NotificationPreference | null
  doctor_profile?: { id: number; specialties_detail: Specialty[] } | null
}

export interface Specialty {
  id: number
  name: string
  name_ar: string
  category: number
  category_name: string
}

export interface Doctor {
  id: number
  full_name: string
  email: string
  phone: string
  bio: string
  bio_ar: string
  room_number: string
  years_experience: number
  avg_appointment_duration: number
  is_accepting_patients: boolean
  accepts_walk_ins: boolean
  specialties: number[]
  specialties_detail: Specialty[]
  photo: string | null
}

export interface PublicDoctor {
  id: number
  full_name: string
  bio: string
  bio_ar: string
  photo: string | null
  room_number: string
  years_experience: number
  languages_spoken: string
  avg_appointment_duration: number
  accepts_walk_ins: boolean
  is_accepting_patients: boolean
  specialties_detail: Specialty[]
  average_rating: number | null
  review_count: number
  next_available_date: string | null
}

export interface TimeSlot {
  id: number
  doctor: number
  date: string
  start_datetime: string
  end_datetime: string
  status: string
  is_walk_in_reserved: boolean
}

export type AppointmentStatus =
  | 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'IN_PROGRESS'
  | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW'

export interface Appointment {
  id: number
  patient: number
  patient_name: string
  doctor: number
  doctor_name: string
  time_slot: number | null
  scheduled_start: string
  scheduled_end: string
  status: AppointmentStatus
  status_display: string
  appointment_type: string
  type_display: string
  priority: number
  reason: string
  cancellation_reason: string
  checked_in_at: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export interface QueueAppointment extends Appointment {
  patient_profile_id: number
  patient_phone: string
  patient_dob: string | null
  patient_gender: string
  patient_blood_type: string
  patient_allergies: string
  patient_chronic_conditions: string
  patient_current_medications: string
}

export interface DoctorQueue {
  previous: QueueAppointment | null
  current: QueueAppointment | null
  next: QueueAppointment | null
  waiting_count: number
}

export interface QueuePosition {
  position: number
  total_waiting: number
  status: AppointmentStatus
  estimated_wait_minutes: number
  in_progress: boolean
}

export type WaitlistStatus = 'WAITING' | 'NOTIFIED' | 'CONVERTED' | 'EXPIRED' | 'CANCELLED'

export interface WaitlistEntry {
  id: number
  patient: number
  patient_name: string
  doctor: number
  doctor_name: string
  desired_date_from: string
  desired_date_to: string
  status: WaitlistStatus
  position: number
  created_at: string
}

export interface DoctorAbsence {
  id: number
  doctor: number
  start_date: string
  end_date: string
  reason: string
  absence_type: string
  notify_patients: boolean
  created_by_name: string
  created_at: string
}

export interface WorkingSchedule {
  id: number
  doctor: number
  weekday: number
  weekday_display: string
  start_time: string
  end_time: string
  slot_duration: number | null
  break_start: string | null
  break_end: string | null
  valid_from: string
  valid_until: string | null
  is_active: boolean
}

export interface AppNotification {
  id: number
  verb: string
  title: string
  title_ar: string
  body: string
  body_ar: string
  is_read: boolean
  created_at: string
}

export interface KioskRow {
  position: number
  display_name: string
  status: string
  scheduled_start: string
  is_emergency: boolean
  is_walk_in: boolean
}

export interface KioskQueue {
  doctor: { id: number; name: string; room_number: string }
  now_serving: KioskRow | null
  queue: KioskRow[]
  waiting_count: number
  generated_at: string
}

export interface Paginated<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

// --- Medical (Phase 2) ---

export interface PatientSummary {
  id: number
  full_name: string
  email: string | null
  phone: string
  date_of_birth: string | null
  blood_type: string
}

export interface MedicalRecord {
  id: number
  patient: number
  doctor: number | null
  doctor_name: string
  version: number
  is_current: boolean
  supersedes: number | null
  chief_complaint: string
  diagnosis: string
  diagnosis_ref: number | null
  treatment_plan: string
  vitals: Record<string, string>
  appointment: number | null
  created_at: string
}

export interface ClinicalNote {
  id: number
  patient: number
  doctor: number | null
  doctor_name: string
  specialty_category: number
  specialty_category_name: string
  medical_record: number | null
  body: string
  body_ar: string
  appointment: number | null
  created_at: string
}

export type ScanCategory = 'XRAY' | 'MRI' | 'CT' | 'ULTRASOUND' | 'DICOM' | 'OTHER'

export interface Scan {
  id: number
  patient: number
  uploaded_by: number | null
  uploaded_by_name: string
  category: ScanCategory
  file: string
  original_filename: string
  content_type: string
  file_size: number
  description: string
  taken_at: string | null
  created_at: string
}

export type LabCategory = 'BLOOD' | 'URINE' | 'IMAGING' | 'PATHOLOGY' | 'OTHER'

export interface LabResult {
  id: number
  patient: number
  uploaded_by: number | null
  uploaded_by_name: string
  test_name: string
  category: LabCategory
  result_value: string
  reference_range: string
  unit: string
  file: string | null
  result_date: string | null
  is_abnormal: boolean
  created_at: string
}

export interface PrescriptionItem {
  id?: number
  medication?: number | null
  medication_name?: string
  drug_name: string
  dosage_strength?: string
  dosage_form?: number | null
  dosage_pattern?: number | null
  dosage: string
  frequency: string
  duration: string
  instructions: string
  quantity?: number | null
}

export interface Prescription {
  id: number
  patient: number
  patient_name: string
  doctor: number | null
  doctor_name: string
  appointment: number | null
  encounter: number | null
  issued_date: string
  notes: string
  notes_ar: string
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
  cancelled_at: string | null
  cancelled_by: number | null
  cancelled_by_name: string
  cancellation_reason: string
  items: PrescriptionItem[]
  created_at: string
}

export interface SpecialtyCategoryRef {
  id: number
  name: string
}

// --- Intelligence (Phase 4) ---

export interface Review {
  id: number
  patient: number
  patient_name: string
  doctor: number
  doctor_name: string
  appointment: number | null
  rating: number
  comment: string
  is_hidden: boolean
  hidden_reason?: string
  created_at: string
}

export type FollowUpStatus = 'SUGGESTED' | 'SCHEDULED' | 'DISMISSED' | 'COMPLETED'

export interface FollowUp {
  id: number
  origin_appointment: number
  patient: number
  patient_name: string
  doctor: number
  doctor_name: string
  recommended_date: string
  suggested_slot: number | null
  suggested_start: string | null
  resulting_appointment: number | null
  status: FollowUpStatus
  status_display: string
  notes: string
  created_at: string
}

export interface ReportDoctorRow {
  doctor_id: number
  doctor_name: string
  total: number
  completed: number
  no_show: number
  cancelled: number
  no_show_rate: number
}

export interface Report {
  period: string
  generated_at: string
  overall: { total: number; completed: number; no_show: number; cancelled: number }
  avg_wait_minutes: number
  appointments_per_doctor: ReportDoctorRow[]
  ratings: { doctor_name: string; count: number; average: number }[]
  most_reviewed: { doctor_name: string; count: number; average: number } | null
  new_patients_total: number
  attendance: { doctor_name: string; absence_days: number }[]
}

// --- Staff management (new) ---

export interface CreateDoctorPayload {
  first_name: string
  last_name: string
  email: string
  phone?: string
  preferred_language?: string
  password?: string
  license_number: string
  specialties?: number[]
  room_number?: string
  bio?: string
  photo?: File | null
}

export interface CreateDoctorResponse {
  user: User & { is_active: boolean; date_joined: string }
  doctor_profile: Doctor
  temp_password: string | null
}

export interface CreateSecretaryPayload {
  first_name: string
  last_name: string
  email: string
  phone?: string
  preferred_language?: string
  password?: string
}

export interface CreateSecretaryResponse {
  user: User & { is_active: boolean; date_joined: string }
  temp_password: string | null
}

export interface CreatePatientPayload {
  first_name: string
  last_name: string
  phone?: string
  email?: string
  national_id?: string
}

export interface CreatePatientResponse {
  user: User & { is_active: boolean; date_joined: string }
  patient_profile_id: number
  temp_password: string
  email_placeholder: boolean
}

export interface UserManagementEntry {
  id: number
  email: string
  role: Role
  first_name: string
  last_name: string
  full_name: string
  phone: string
  preferred_language: Language
  is_active: boolean
  date_joined: string
}

export interface UserEditPayload {
  first_name?: string
  last_name?: string
  phone?: string
  email?: string
}

// --- Vital Signs (Phase 5) ---

export type VitalAlertLevel = 'normal' | 'warning' | 'danger'

export interface VitalSigns {
  id: number
  patient: number
  appointment: number | null
  recorded_by: number | null
  recorded_by_name: string
  bp_systolic: number
  bp_diastolic: number
  heart_rate: number
  temperature: string        // DecimalField serializes as string — use parseFloat()
  respiratory_rate: number
  oxygen_saturation: number
  weight: string             // DecimalField serializes as string — use parseFloat()
  height: number
  bmi: number | null
  blood_glucose: number | null
  notes: string
  created_at: string
}

export interface CreateVitalSignsPayload {
  patient: number
  appointment?: number | null
  bp_systolic: number
  bp_diastolic: number
  heart_rate: number
  temperature: number
  respiratory_rate: number
  oxygen_saturation: number
  weight: number
  height: number
  blood_glucose?: number | null
  notes?: string
}

export interface UpdateVitalSignsPayload extends Partial<CreateVitalSignsPayload> {}

// --- Lab Orders (Phase 6 + Phase 11) ---

export type LabOrderStatus =
  | 'DRAFT' | 'ORDERED' | 'SAMPLE_COLLECTED' | 'PROCESSING' | 'COMPLETED' | 'REVIEWED'

export type LabOrderPriority = 'ROUTINE' | 'URGENT' | 'STAT'

export type SampleType = 'SERUM' | 'WHOLE_BLOOD' | 'URINE' | 'CSF' | 'SWAB' | 'STOOL' | 'OTHER'

export interface SampleCollection {
  id: number
  lab_order: number
  sample_type: SampleType
  sample_id: string
  collected_by: number
  collected_by_name: string
  collected_at: string
  sent_to_lab_at: string | null
  received_at_lab: string | null
  notes: string
}

export interface LabOrderItem {
  id?: number
  test_name: string
  test_code: string
  notes: string
}

export interface LabOrderResult {
  id: number
  order: number
  order_item: number | null
  test_name: string
  result_value: string
  unit: string
  reference_range: string
  is_abnormal: boolean
  is_critical: boolean
  result_date: string
  entered_by: number | null
  entered_by_name: string
  file: string | null
  interpretation: string
}

export interface LabOrder {
  id: number
  order_number: string
  patient: number
  patient_name: string
  doctor: number
  doctor_name: string
  appointment: number | null
  status: LabOrderStatus
  priority: LabOrderPriority
  clinical_notes: string
  ordered_at: string | null
  sample_collected_at: string | null
  completed_at: string | null
  reviewed_at: string | null
  items: LabOrderItem[]
  results: LabOrderResult[]
  has_critical: boolean
  sample_collection: SampleCollection | null
  created_at: string
}

export interface LabOrderSummary {
  id: number
  order_number: string
  patient: number
  patient_name: string
  doctor: number
  doctor_name: string
  appointment: number | null
  status: LabOrderStatus
  priority: LabOrderPriority
  clinical_notes: string
  ordered_at: string | null
  completed_at: string | null
  reviewed_at: string | null
  item_count: number
  sample_collection: SampleCollection | null
  created_at: string
}

export interface CreateLabOrderPayload {
  patient: number
  appointment?: number | null
  encounter?: number | null
  priority: LabOrderPriority
  clinical_notes?: string
  items: Omit<LabOrderItem, 'id'>[]
}

export interface CreateLabOrderResultPayload {
  order_item?: number | null
  test_name: string
  result_value: string
  unit?: string
  reference_range?: string
  is_abnormal: boolean
  is_critical: boolean
  result_date: string
  interpretation?: string
  file?: File | null
}

// --- Patient History Timeline (Phase 7) ---

export type TimelineEventType =
  | 'VITAL_SIGNS' | 'LAB_ORDER' | 'PRESCRIPTION'
  | 'CLINICAL_NOTE' | 'MEDICAL_RECORD' | 'APPOINTMENT_COMPLETED'

export interface TimelineEvent {
  id: string
  event_type: TimelineEventType
  event_date: string | null
  title: string
  summary: string
  detail: Record<string, unknown>
}

export interface TimelineFilters {
  types?: string
  date_from?: string
  date_to?: string
}

// --- Structured Clinical Encounter (Phase 8) ---

export type EncounterStatus = 'DRAFT' | 'SUBMITTED' | 'AMENDED'

export type ComplaintCategory =
  | 'CARDIAC' | 'RESPIRATORY' | 'GI' | 'MUSCULOSKELETAL' | 'NEUROLOGICAL' | 'OTHER'

export interface Complaint {
  id: number
  name: string
  name_ar: string
  category: ComplaintCategory
  is_active: boolean
}

export interface Diagnosis {
  id: number
  name: string
  name_ar: string
  category: ComplaintCategory
  icd10_code?: string | null
  is_chronic?: boolean
  category_ref?: number | null
  category_ref_name?: string
  is_active: boolean
}

export interface DiagnosisCategory {
  id: number
  name: string
  name_ar: string
  is_active: boolean
}

export interface DiagnosisDistribution {
  period: string
  generated_at: string
  diagnoses: { name: string; name_ar: string; icd10_code: string | null; count: number }[]
}

// --- Medications (Phase 9) ---

export interface MedicationClass {
  id: number
  name: string
  name_ar: string
  is_active: boolean
}

export interface DosageForm {
  id: number
  name: string
  name_ar: string
  is_active: boolean
}

export interface DosagePattern {
  id: number
  name: string
  name_ar: string
  code: string
  is_active: boolean
}

export interface Medication {
  id: number
  name: string
  name_ar: string
  brand_names: string[]
  drug_class: number | null
  drug_class_name: string
  dosage_forms: number[]
  requires_prescription: boolean
  is_active: boolean
}

export type AllergySeverity = 'MILD' | 'MODERATE' | 'SEVERE' | 'CONTRAINDICATED'

export interface AllergyInteractionWarning {
  medication_id: number
  medication_name: string
  allergy_keyword: string
  drug_class: string
  severity: AllergySeverity
  message: string
  message_ar: string
}

export interface Encounter {
  id: number
  patient: number
  patient_name: string
  doctor: number | null
  doctor_name: string
  appointment: number | null
  encounter_date: string
  status: EncounterStatus
  chief_complaint: string
  chief_complaint_ar: string
  symptoms: string[]
  examination_findings: string
  examination_findings_ar: string
  diagnosis: number | null
  diagnosis_detail: Diagnosis | null
  diagnosis_notes: string
  treatment_plan: string
  treatment_plan_ar: string
  vitals: number | null
  vitals_detail: VitalSigns | null
  version: number
  is_current: boolean
  supersedes: number | null
  prescriptions: Prescription[]
  lab_orders: LabOrderSummary[]
  created_at: string
}

export interface UpdateEncounterPayload {
  chief_complaint?: string
  chief_complaint_ar?: string
  symptoms?: string[]
  examination_findings?: string
  examination_findings_ar?: string
  diagnosis?: number | null
  diagnosis_notes?: string
  treatment_plan?: string
  treatment_plan_ar?: string
  vitals?: number | null
}
