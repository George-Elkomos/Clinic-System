import { api } from './apiClient'
import type { Paginated } from './types'

export type AISessionStatus =
  | 'PENDING'
  | 'TRANSCRIBING'
  | 'EXTRACTING'
  | 'READY'
  | 'FAILED'
  | 'COMMITTED'

export interface AISegment {
  start: number
  end: number
  text: string
}

export interface AIDraftVitals {
  blood_pressure: string
  heart_rate: string
  temperature: string
  respiratory_rate: string
  oxygen_saturation: string
  weight: string
  height: string
  notes: string
}

export interface AIDraftPrescription {
  drug_name: string
  dosage: string
  frequency: string
  duration: string
  instructions: string
}

export interface AIDraft {
  chief_complaint: string
  diagnosis: string
  treatment_plan: string
  clinical_summary: string
  follow_up: string
  vitals: AIDraftVitals
  prescriptions: AIDraftPrescription[]
}

export interface AISession {
  id: number
  patient: number
  patient_name: string
  doctor: number | null
  doctor_name: string
  appointment: number | null
  language: string
  status: AISessionStatus
  error: string
  transcript: string
  segments: AISegment[]
  extracted: AIDraft
  original_filename: string
  file_size: number
  committed_record: number | null
  committed_prescription: number | null
  created_at: string
  processing_started_at: string | null
  processing_finished_at: string | null
  committed_at: string | null
}

export const aiApi = {
  // Upload a recorded/selected audio file -> creates a session and starts processing.
  uploadSession: (form: FormData) =>
    api
      .post<AISession>('/ai/sessions/', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data),

  // Poll a single session for status / transcript / draft.
  getSession: (id: number) =>
    api.get<AISession>(`/ai/sessions/${id}/`).then((r) => r.data),

  sessions: (patient?: number) =>
    api
      .get<Paginated<AISession>>('/ai/sessions/', { params: { patient } })
      .then((r) => r.data.results),

  // Doctor confirms the reviewed draft -> writes the medical record (+ prescription).
  commit: (id: number, draft: AIDraft, createPrescription = true) =>
    api
      .post<AISession>(`/ai/sessions/${id}/commit/`, {
        draft,
        create_prescription: createPrescription,
      })
      .then((r) => r.data),

  retry: (id: number) =>
    api.post<AISession>(`/ai/sessions/${id}/retry/`, {}).then((r) => r.data),

  remove: (id: number) => api.delete(`/ai/sessions/${id}/`).then((r) => r.data),
}
