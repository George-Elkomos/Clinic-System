import { api } from './apiClient'
import type {
  ClinicalNote,
  LabResult,
  MedicalRecord,
  Paginated,
  PatientSummary,
  Prescription,
  PrescriptionItem,
  Scan,
} from './types'

export const medicalApi = {
  // Doctor's patient picker
  myPatients: () => api.get<PatientSummary[]>('/medical/patients/').then((r) => r.data),

  // Medical records (append-only versions)
  records: (patient?: number, currentOnly = false) =>
    api
      .get<Paginated<MedicalRecord>>('/medical-records/', {
        params: { patient, current: currentOnly ? 'true' : undefined },
      })
      .then((r) => r.data.results),
  createRecord: (data: Partial<MedicalRecord> & { patient: number }) =>
    api.post<MedicalRecord>('/medical-records/', data).then((r) => r.data),

  // Clinical notes
  notes: (patient?: number) =>
    api.get<Paginated<ClinicalNote>>('/clinical-notes/', { params: { patient } }).then((r) => r.data.results),
  createNote: (data: { patient: number; specialty_category: number; body: string; body_ar?: string }) =>
    api.post<ClinicalNote>('/clinical-notes/', data).then((r) => r.data),

  // Scans
  scans: (patient?: number) =>
    api.get<Paginated<Scan>>('/scans/', { params: { patient } }).then((r) => r.data.results),
  uploadScan: (form: FormData) =>
    api.post<Scan>('/scans/', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  // Authenticated blob download (the Bearer token can't ride a plain <a href>).
  downloadScan: (id: number) =>
    api.get(`/scans/${id}/download/`, { responseType: 'blob' }).then((r) => r.data as Blob),

  // Lab results
  labs: (patient?: number) =>
    api.get<Paginated<LabResult>>('/lab-results/', { params: { patient } }).then((r) => r.data.results),
  uploadLab: (form: FormData) =>
    api.post<LabResult>('/lab-results/', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  downloadLab: (id: number) =>
    api.get(`/lab-results/${id}/download/`, { responseType: 'blob' }).then((r) => r.data as Blob),

  // Prescriptions
  prescriptions: (patient?: number) =>
    api.get<Paginated<Prescription>>('/prescriptions/', { params: { patient } }).then((r) => r.data.results),
  createPrescription: (data: { patient: number; notes?: string; encounter?: number; items: PrescriptionItem[] }) =>
    api.post<Prescription>('/prescriptions/', data).then((r) => r.data),
  // Fetch the rendered PDF as a blob for inline view / download.
  prescriptionPdf: (id: number) =>
    api.get(`/prescriptions/${id}/pdf/`, { responseType: 'blob' }).then((r) => r.data as Blob),
}
