# Clinic System — Implementation Plan
**Based on:** ERPNext Healthcare Gap Analysis  
**Scope:** Outpatient clinic management only  
**Date:** June 2026  

---

## Guiding Principles

- Every module must integrate with existing RBAC (`DoctorPatient` link, role permissions)
- Every new model inherits `TimeStampedModel` + `SoftDeleteModel` from `apps/core`
- Every new feature emits notifications and audit events
- Frontend follows existing React Query + Axios + i18next + RTL patterns
- Quality over speed: each phase includes tests, Arabic translations, and accessibility
- No half-finished modules — each phase ships as a complete usable unit

---

## Phase Overview

| Phase | Name | Duration | Description |
|---|---|---|---|
| **Phase 5** | Vital Signs | 1 week | Structured vitals per appointment |
| **Phase 6** | Lab Orders System | 3 weeks | Full lab order → result → notify flow |
| **Phase 7** | Patient History Timeline | 1 week | Unified chronological patient view |
| **Phase 8** | Clinical Encounter | 2 weeks | Structured encounter as visit hub |
| **Phase 9** | Medication Master | 2 weeks | Drug DB + interaction checking |
| **Phase 10** | Structured Diagnosis | 1 week | Diagnosis master + ICD codes |
| **Phase 11** | Sample Collection | 1 week | Specimen chain-of-custody |
| **Phase 12** | Basic Billing | 3 weeks | Consultation + lab invoicing |
| **Phase 13** | Referrals + Complaints | 1 week | Referral management + complaint master |
| **Phase 14** | Clinical Procedures | 2 weeks | Minor procedure templates + execution |
| **Phase 15** | Radiology Orders | 1 week | Structured imaging orders |
| **Phase 16** | Advanced Analytics | 1 week | Specialty-level appointment analytics |
| **Total** | | **~19 weeks** | All 12 modules |

---

## Phase 5 — Vital Signs Module
**Duration: 1 week**  
**Priority: P1 (Most Impactful Clinical Addition)**

### Goal
Replace the current `MedicalRecord.vitals` JSON field with a structured, time-series vital signs model that auto-flags abnormal values and enables trend charts.

### Deliverables

#### Backend — New App: `apps/vitals`

**Model: `VitalSigns`**
```
patient          FK → User (patient role)
doctor           FK → User (doctor role)
appointment      FK → Appointment (nullable)
recorded_at      DateTimeField (default=now)
recorded_by      FK → User (who took vitals — nurse/doctor/secretary)

# Measurements (all nullable to allow partial recording)
temperature_c    DecimalField(3,1, null=True)   # °C
bp_systolic      PositiveIntegerField(null=True) # mmHg
bp_diastolic     PositiveIntegerField(null=True) # mmHg
pulse_rate       PositiveIntegerField(null=True) # bpm
respiratory_rate PositiveIntegerField(null=True) # breaths/min
spo2             DecimalField(4,1, null=True)    # % oxygen saturation
weight_kg        DecimalField(5,2, null=True)    # kg
height_cm        DecimalField(5,1, null=True)    # cm
bmi              DecimalField(4,1, null=True)    # auto-computed on save

# Auto-flagging
has_abnormal     BooleanField(default=False)     # auto-set on save
abnormal_flags   JSONField(default=list)         # ['bp_systolic', 'spo2', ...]

notes            TextField(blank=True)
```

**Auto-flag logic on save:**
- `bp_systolic` > 140 or < 90 → flag
- `bp_diastolic` > 90 or < 60 → flag
- `pulse_rate` > 100 or < 60 → flag
- `respiratory_rate` > 20 or < 12 → flag
- `spo2` < 95 → flag
- `temperature_c` > 37.5 or < 36.0 → flag
- BMI auto-computed from weight + height

**API Endpoints:**
- `GET /api/vitals/?patient=<id>&date_from=&date_to=` — list vitals (doctors: treated patients, patients: own)
- `POST /api/vitals/` — record vitals (doctor/secretary/manager)
- `GET /api/vitals/{id}/` — single record
- `GET /api/vitals/trends/?patient=<id>&metric=bp_systolic&months=6` — time-series data for charts
- `GET /api/appointments/{id}/vitals/` — vitals recorded for a specific appointment

**Permissions:**
- Patients: read own only
- Doctors: read/write for treated patients (DoctorPatient link)
- Secretary: write only (take vitals at check-in), no read
- Manager: full read/write

**Notification:** If `has_abnormal=True` on a new VitalSigns record, send in-app notification to the appointment's doctor.

#### Frontend — New Views

**Doctor pages:**
- `PatientRecordPage` — add Vitals tab showing time-series table + sparkline charts for BP, pulse, weight
- `DoctorQueuePage` — "Record Vitals" button when appointment is CHECKED_IN (secretary takes vitals before doctor sees patient)

**Secretary pages:**
- `AppointmentDeskPage` — "Record Vitals" modal when checking in a patient (quick vitals form)

**Patient pages:**
- `MyMedicalHistoryPage` — add Vitals tab showing own vital history with trend charts

**Components:**
- `VitalsForm` — compact grid of vital fields with unit labels
- `VitalsTrendChart` — sparkline or line chart per metric (using recharts or similar)
- `AbnormalBadge` — red indicator on abnormal values

#### Tests
- Record vitals with all fields populated → verify BMI auto-computed
- Record with only BP → verify partial record saved
- Abnormal systolic 160 → verify `has_abnormal=True`, `abnormal_flags` contains 'bp_systolic'
- Doctor receives notification on abnormal vitals
- Patient cannot read another patient's vitals
- Doctor without DoctorPatient link cannot read vitals

#### Migrations
1. Create `apps/vitals` migrations
2. Optionally migrate existing `MedicalRecord.vitals` JSON values to `VitalSigns` records (data migration script)

#### i18n Keys (en + ar)
- `vitals.temperature`, `vitals.blood_pressure`, `vitals.pulse`, `vitals.respiratory_rate`, `vitals.spo2`, `vitals.weight`, `vitals.height`, `vitals.bmi`
- `vitals.abnormal`, `vitals.normal_range`, `vitals.trend`

---

## Phase 6 — Lab Orders System
**Duration: 3 weeks**  
**Priority: P1 (Closes the Lab ↔ Doctor ↔ Patient Gap)**

### Goal
Replace the upload-only `LabResult` model with a full lab order workflow: doctor orders a test → lab tech executes using a template with normal ranges → doctor notified of results → patient views structured results.

### Deliverables

#### Week 1 — Models + Templates

**New App: `apps/lab`** (replace/extend current `apps/medical_records` lab functionality)

**Model: `LabTestTemplate`**
```
name             CharField (e.g., "Complete Blood Count")
name_ar          CharField
abbreviation     CharField (e.g., "CBC")
category         ForeignKey → LabCategory (BLOOD/URINE/IMAGING/PATHOLOGY/OTHER)
sample_type      CharField (Serum, Whole Blood, Urine, CSF, Swab, etc.)
sample_type_ar   CharField
is_group         BooleanField  # is this a panel (group of tests)?
group_tests      M2M → LabTestTemplate (self, for panels)
instructions     TextField (for lab tech — preparation notes)
instructions_ar  TextField
normal_ranges    JSONField  # list of {metric, unit, min_value, max_value, condition}
is_active        BooleanField(default=True)
```

**Model: `LabOrder`** (the doctor's request)
```
patient          FK → User (patient role)
ordering_doctor  FK → User (doctor role)
appointment      FK → Appointment (nullable)
template         FK → LabTestTemplate
clinical_reason  TextField (why the test is ordered)
priority         CharField (ROUTINE/URGENT/STAT)
status           CharField (ORDERED/SAMPLE_COLLECTED/IN_PROGRESS/COMPLETED/APPROVED/CANCELLED)
ordered_at       DateTimeField(auto)
completed_at     DateTimeField(null=True)
notes            TextField(blank=True)
```

**Model: `LabTestResult`** (the executed result)
```
lab_order        OneToOne → LabOrder
performed_by     FK → User (lab tech / secretary / doctor)
result_date      DateField
result_items     (inline via LabResultItem)
conclusion       TextField(blank=True)
conclusion_ar    TextField(blank=True)
is_approved      BooleanField(default=False)
approved_by      FK → User(null=True)
approved_at      DateTimeField(null=True)
file             FileField(null=True)  # optional scanned report upload
```

**Model: `LabResultItem`** (one row per metric in the result)
```
lab_result       FK → LabTestResult
metric_name      CharField (e.g., "Hemoglobin")
metric_name_ar   CharField
value            CharField  # flexible: "13.5" or "Negative" or "E. coli"
unit             CharField (e.g., "g/dL")
reference_min    DecimalField(null=True)
reference_max    DecimalField(null=True)
reference_text   CharField (e.g., "Negative" for qualitative)
is_abnormal      BooleanField(default=False)  # auto-set if value < min or > max
```

#### Week 2 — Order Flow + APIs

**New enum values in `apps/core/enums.py`:**
```python
class LabOrderStatus(TextChoices):
    ORDERED = 'ORDERED'
    SAMPLE_COLLECTED = 'SAMPLE_COLLECTED'
    IN_PROGRESS = 'IN_PROGRESS'
    COMPLETED = 'COMPLETED'
    APPROVED = 'APPROVED'
    CANCELLED = 'CANCELLED'

class LabPriority(TextChoices):
    ROUTINE = 'ROUTINE'
    URGENT = 'URGENT'
    STAT = 'STAT'
```

**New notification verbs:**
- `LAB_ORDER_CREATED` — notifies doctor when lab tech creates result
- `LAB_RESULT_READY` — notifies doctor when result completed
- `LAB_RESULT_APPROVED` — notifies patient when result approved

**API Endpoints:**
```
# Lab Templates (manager/doctor read, manager create/edit)
GET  /api/lab-templates/                         — list all templates
POST /api/lab-templates/                         — create (manager)
GET  /api/lab-templates/{id}/                    — detail
PATCH /api/lab-templates/{id}/                   — edit (manager)

# Lab Orders (doctor orders, secretary/lab tech executes)
GET  /api/lab-orders/                            — list (scoped by role)
POST /api/lab-orders/                            — create order (doctor/secretary)
GET  /api/lab-orders/{id}/                       — detail
POST /api/lab-orders/{id}/cancel/                — cancel (ordering doctor/manager)
POST /api/lab-orders/{id}/collect-sample/        — mark sample collected (secretary)
GET  /api/lab-orders/pending/                    — orders not yet resulted (lab queue)

# Lab Results (lab tech enters, doctor approves)
GET  /api/lab-results-v2/                        — list results (scoped)
POST /api/lab-results-v2/                        — enter result for an order (lab tech/secretary/doctor)
GET  /api/lab-results-v2/{id}/                   — detail
PATCH /api/lab-results-v2/{id}/                  — edit result (before approval)
POST /api/lab-results-v2/{id}/approve/           — approve result (doctor/manager)
GET  /api/lab-results-v2/{id}/pdf/               — generate result PDF

# Patient lab history
GET  /api/patients/{id}/lab-orders/              — all orders for patient
GET  /api/patients/{id}/lab-results/             — all results for patient
```

**Permissions:**
- Patients: read own approved results only
- Doctors: create orders for their patients; read/approve results for treated patients
- Secretary: create orders; collect samples; enter results; cannot approve
- Manager: full access

#### Week 3 — Frontend

**Doctor pages:**
- `PatientRecordPage` — replace current "Lab Results" tab with "Lab Orders" tab showing:
  - "Order New Lab Test" button (select template, enter reason, set priority)
  - List of all orders with status badges (ORDERED → COMPLETED → APPROVED)
  - Click result to see structured result items with normal range comparison (green/red)
  - Trend view: same metric (e.g., HbA1c) across multiple orders on a sparkline
  - "Approve Result" action button on completed results

**Secretary pages:**
- `AppointmentDeskPage` — "Lab Queue" section:
  - List of pending lab orders across all patients
  - "Collect Sample" action → marks order as SAMPLE_COLLECTED
  - "Enter Results" action → opens result entry form with template pre-filled
  - Priority badges (URGENT/STAT highlighted)

**Patient pages:**
- `MyScansLabsPage` — update Labs tab to show:
  - All approved lab results
  - Structured items with value, unit, normal range, abnormal flag
  - Order history (can see "ORDERED" and "IN_PROGRESS" states as "Pending")

**Manager pages:**
- `ManagerDashboard` — add lab metrics: pending orders count, average turnaround time

**Components:**
- `LabOrderForm` — template selector + reason + priority
- `LabResultEntryForm` — dynamic form auto-generated from template's normal_ranges
- `LabResultViewer` — structured display with color-coded normal/abnormal per item
- `LabTrendChart` — multi-visit trend for a specific metric

#### Tests
- Doctor orders CBC → verify LabOrder created with status ORDERED
- Secretary collects sample → verify status SAMPLE_COLLECTED
- Secretary enters results with HbA1c=8.5 (above max 6.4) → verify is_abnormal=True on item
- Doctor approves result → verify patient notified
- Patient cannot see unapproved results
- Doctor without treatment link cannot see order

---

## Phase 7 — Patient History Timeline
**Duration: 1 week**  
**Priority: P1**

### Goal
A single scrollable timeline showing ALL clinical events for a patient in chronological order, replacing the need to navigate 5+ separate pages.

### Deliverables

#### Backend

**New endpoint: `GET /api/patients/{id}/timeline/`**

Query parameters:
- `?types=vitals,labs,prescriptions,notes,records,scans,appointments` (comma-separated filter)
- `?date_from=` / `?date_to=`
- `?page=` / `?page_size=`

Response: paginated list of timeline events, each shaped as:
```json
{
  "id": "...",
  "event_type": "VITAL_SIGNS",        
  "event_date": "2026-03-15T09:30:00",
  "doctor": { "id": "...", "name": "..." },
  "summary": "BP 130/85 · Pulse 78 · Temp 36.8°C",
  "has_abnormal": false,
  "detail_url": "/api/vitals/42/",
  "appointment_id": "..."
}
```

Event types: `VITAL_SIGNS`, `LAB_ORDER`, `PRESCRIPTION`, `CLINICAL_NOTE`, `MEDICAL_RECORD`, `SCAN`, `APPOINTMENT_COMPLETED`

Service layer: `build_patient_timeline(patient_id, types, date_from, date_to)` — queries each model, merges and sorts by date.

Permissions: patients see own; doctors see treated patients; manager sees all; secretary cannot access.

#### Frontend

**Doctor pages:**
- `PatientRecordPage` — new "Timeline" tab (default tab when opening a patient record)
- Timeline renders as a vertical feed:
  - Date group headers ("March 2026")
  - Each event as a card with icon, type label, date, doctor name, summary
  - Colored left border per type (vitals=purple, labs=blue, prescription=green, note=gray)
  - Click card → expands inline detail OR navigates to detail page
  - Type filter chips at top (All / Vitals / Labs / Prescriptions / Notes / Scans)
  - Date range picker
  - Infinite scroll (pagination)

**Patient pages:**
- `MyMedicalHistoryPage` — same Timeline component adapted for patient's own view

**Components:**
- `PatientTimeline` — reusable timeline component
- `TimelineEvent` — single event card with type-specific icon and summary renderer

#### Tests
- Patient with 10 events across 4 types → verify timeline returns all 10 sorted by date desc
- Doctor without treatment link cannot access timeline
- Type filter `?types=vitals,labs` returns only those types
- Pagination: page 2 returns next set of events

---

## Phase 8 — Structured Clinical Encounter
**Duration: 2 weeks**  
**Priority: P2**

### Goal
Replace the separate MedicalRecord + ClinicalNote workflow with a unified `Encounter` document per visit from which prescriptions and lab orders are spawned atomically.

### Deliverables

#### Week 1 — Model + API

**New App: `apps/encounters`**

**Model: `Encounter`**
```
patient          FK → User (patient)
doctor           FK → User (doctor)
appointment      OneToOne → Appointment (nullable)
encounter_date   DateField
status           CharField (DRAFT/SUBMITTED/AMENDED)

# Clinical content
chief_complaint  CharField
chief_complaint_ar CharField
symptoms         JSONField (list of strings, from Complaint master)
examination_findings TextField
examination_findings_ar TextField
diagnosis        FK → Diagnosis (null) — from Phase 10
diagnosis_notes  TextField
treatment_plan   TextField
treatment_plan_ar TextField
vitals           FK → VitalSigns (null) — linked from Phase 5

# Downstream documents (read via reverse FK)
# prescriptions → Prescription.encounter FK
# lab_orders → LabOrder.encounter FK (add encounter FK to LabOrder in Phase 6)

follow_up_recommended BooleanField(default=False)
follow_up_in_days IntegerField(null=True)
notes            TextField(blank=True)
version          PositiveIntegerField(default=1)
is_current       BooleanField(default=True)
supersedes       FK → self (null, for amendments)
```

**Model: `Complaint`** (master data)
```
name      CharField (e.g., "Chest Pain")
name_ar   CharField
category  CharField (CARDIAC/RESPIRATORY/GI/MUSCULOSKELETAL/NEUROLOGICAL/OTHER)
is_active BooleanField(default=True)
```

**API Endpoints:**
```
GET  /api/encounters/              — list (scoped by role)
POST /api/encounters/              — create (doctor only)
GET  /api/encounters/{id}/         — detail with nested prescriptions + lab orders
PATCH /api/encounters/{id}/        — edit (DRAFT state only)
POST /api/encounters/{id}/submit/  — finalize (DRAFT → SUBMITTED)
POST /api/encounters/{id}/amend/   — create amendment (SUBMITTED → creates new version)
GET  /api/encounters/{id}/summary/ — encounter summary for printing

GET  /api/complaints/              — list complaint master (for autocomplete)
POST /api/complaints/              — create (manager)
```

#### Week 2 — Frontend Integration

**Doctor pages:**
- `DoctorQueuePage` — when appointment is IN_PROGRESS, show "Open Encounter" button
- New `EncounterPage` (`/doctor/encounters/:appointmentId`):
  - Auto-creates draft encounter linked to appointment
  - Sections: Chief Complaint (autocomplete from Complaint master) → Symptoms → Examination → Diagnosis → Treatment Plan
  - "Add Prescription" inline button → opens existing prescription form prefilled with encounter link
  - "Order Lab Test" inline button → opens lab order form prefilled with encounter + patient
  - "Record Vitals" section or link to vitals form
  - "Submit Encounter" button → marks SUBMITTED, completes appointment
  - Shows linked prescriptions and lab orders in sidebar

**Patient pages:**
- `MyMedicalHistoryPage` — Encounters tab showing list of submitted encounters (read-only, chief complaint + diagnosis + date)

**Manager pages:**
- Add encounter count to dashboard stats

#### Tests
- Create encounter → verify it is in DRAFT state
- Add prescription from encounter → verify prescription has encounter FK
- Submit encounter → verify it moves to SUBMITTED; further PATCH returns 403
- Amend encounter → verify new version created, old is_current=False
- Patient cannot see DRAFT encounters
- Doctor without treatment link cannot see encounter

---

## Phase 9 — Medication Master + Drug Interactions
**Duration: 2 weeks**  
**Priority: P2**

### Goal
Replace free-text drug names in prescriptions with a structured medication master, and add basic drug-allergy interaction alerts at prescription time.

### Deliverables

#### Week 1 — Models + Seed Data

**New App: `apps/medications`**

**Model: `Medication`**
```
name             CharField (generic name, e.g., "Amoxicillin")
name_ar          CharField
brand_names      JSONField (list of brand names)
drug_class       CharField (FK to MedicationClass, null=True)
dosage_forms     M2M → DosageForm
is_active        BooleanField(default=True)
requires_prescription BooleanField(default=True)
notes            TextField(blank=True)
```

**Model: `MedicationClass`**
```
name          CharField (e.g., "Beta-Lactam Antibiotics")
name_ar       CharField
interactions  M2M → self (symmetric=True)  # which classes interact with which
```

**Model: `DosageForm`**
```
name     CharField (Tablet, Capsule, Syrup, Injection, Cream, Drops, Inhaler, Patch, Suppository)
name_ar  CharField
```

**Model: `DosagePattern`**
```
name     CharField (e.g., "Once Daily", "Twice Daily", "Three Times Daily", "As Needed")
name_ar  CharField
code     CharField (e.g., "OD", "BID", "TID", "PRN")
```

**Model: `AllergyAlert`** (drug-allergy interaction)
```
allergy_keyword  CharField (e.g., "penicillin", "sulfa", "aspirin")
drug_class       FK → MedicationClass
severity         CharField (MILD/MODERATE/SEVERE/CONTRAINDICATED)
message          TextField
message_ar       TextField
```

**Update `PrescriptionItem` model:**
```
medication       FK → Medication (null=True, blank=True)  # new
drug_name        CharField (keep for free-text fallback / backwards compat)
dosage_strength  CharField (e.g., "500mg")
dosage_form      FK → DosageForm (null=True)
dosage_pattern   FK → DosagePattern (null=True)
# keep: frequency, duration, instructions
```

**Seed data management command:** `python manage.py seed_medications` — loads ~200 common drugs, dosage forms, dosage patterns, common allergies.

#### Week 2 — Interaction Checking + Frontend

**New API Endpoint:**
```
POST /api/prescriptions/check-interactions/
Body: { patient_id, medications: [medication_id, ...] }
Response: { warnings: [{ medication, allergy, severity, message }, ...] }
```

Logic: check patient's `allergies_summary` text against `AllergyAlert.allergy_keyword` values for each medication's drug class.

**Updated APIs:**
```
GET /api/medications/         — list (with search by name/brand)
POST /api/medications/        — create (manager)
GET /api/dosage-forms/        — list
GET /api/dosage-patterns/     — list
```

**Frontend — Prescription form changes:**
- Drug name field → typeahead search against `/api/medications/` (still accepts free text for unlisted drugs)
- Dosage form → dropdown from `/api/dosage-forms/`
- Frequency → dropdown from `/api/dosage-patterns/` (with free-text override)
- On prescription save → call `/api/prescriptions/check-interactions/`
- If warnings returned → show modal: "Warning: Patient may have allergy to [drug class]. Severity: MODERATE. Proceed?"
- Doctor can acknowledge and proceed, or cancel

#### Tests
- Create medication "Amoxicillin" in class "Beta-Lactam Antibiotics"
- Create allergy alert: keyword "penicillin", class "Beta-Lactam Antibiotics", SEVERE
- Patient has allergies_summary containing "penicillin allergy"
- Check interactions → verify warning returned
- Prescription item with medication FK → verify drug_name auto-populated on save
- Medication search "amox" → returns Amoxicillin

---

## Phase 10 — Structured Diagnosis + ICD Codes
**Duration: 1 week**  
**Priority: P2**

### Goal
Replace free-text diagnosis in MedicalRecord/Encounter with a searchable Diagnosis master that supports optional ICD-10 coding.

### Deliverables

**New App: `apps/diagnosis`**

**Model: `DiagnosisCategory`**
```
name     CharField (e.g., "Cardiovascular", "Endocrine", "Respiratory")
name_ar  CharField
```

**Model: `Diagnosis`**
```
name      CharField (e.g., "Type 2 Diabetes Mellitus")
name_ar   CharField
icd10_code CharField(null=True) (e.g., "E11")
category  FK → DiagnosisCategory
is_chronic BooleanField (flag for chronic disease tracking)
is_active  BooleanField(default=True)
```

**Seed data:** ~150 most common outpatient diagnoses loaded via management command.

**Update `MedicalRecord`:**
- Add `diagnosis_ref FK → Diagnosis (null=True)` alongside existing `diagnosis` text field

**Update `Encounter` (Phase 8):**
- `diagnosis` field already points to Diagnosis FK

**API Endpoints:**
```
GET  /api/diagnoses/?search=diabetes      — list with typeahead search
POST /api/diagnoses/                      — create (manager/doctor)
GET  /api/diagnosis-categories/           — list categories

GET  /api/reports/diagnosis-distribution/ — manager report: count of diagnoses this period
```

**Frontend:**
- Encounter page diagnosis field → typeahead search showing name + ICD10 code
- Patient profile page → list of chronic diagnoses across all encounters
- Manager reports → new "Top Diagnoses" chart

**Tests:**
- Search "diabetes" → returns results including "Type 2 Diabetes Mellitus (E11)"
- Encounter with diagnosis FK → verify icd10_code accessible in summary
- Diagnosis distribution report → returns correct counts

---

## Phase 11 — Sample Collection Tracking
**Duration: 1 week**  
**Priority: P3**

### Goal
Track specimen lifecycle from collection to lab result for external lab workflows.

### Deliverables

**Add to `apps/lab` (from Phase 6):**

**Model: `SampleCollection`**
```
lab_order         FK → LabOrder (OneToOne)
sample_type       CharField (Serum, Whole Blood, Urine, CSF, Swab, Stool, etc.)
sample_id         CharField (barcode/label ID, auto-generated)
collected_by      FK → User
collected_at      DateTimeField
sent_to_lab_at    DateTimeField(null=True)
received_at_lab   DateTimeField(null=True)
notes             TextField(blank=True)
```

**Auto-generate `sample_id`:** format `LAB-YYYYMMDD-XXXX` (sequential per day)

**API Endpoints:**
```
POST /api/lab-orders/{id}/collect-sample/   — create SampleCollection (secretary)
PATCH /api/lab-orders/{id}/send-to-lab/     — mark sent_to_lab_at (secretary)
PATCH /api/lab-orders/{id}/receive-at-lab/  — mark received_at_lab (secretary/lab tech)
GET  /api/lab-orders/{id}/sample/           — get collection details
GET  /api/lab-orders/{id}/sample/label/     — printable sample label (HTML/PDF)
```

**Frontend:**
- Secretary lab queue → each row shows collection status with timestamps
- "Print Sample Label" button → opens printable label with patient name, DOB, test name, sample_id, barcode

**Tests:**
- Collect sample → verify sample_id auto-generated in correct format
- Track through all 3 stages (collected → sent → received)
- Print label API returns correct patient info

---

## Phase 12 — Basic Billing Module
**Duration: 3 weeks**  
**Priority: P3**

### Goal
Generate invoices for consultations and lab tests, track payment status, and enable fee validity (free follow-ups).

### Deliverables

#### Week 1 — Models

**New App: `apps/billing`**

**Model: `ServiceItem`**
```
name           CharField (e.g., "General Consultation", "CBC Test")
name_ar        CharField
item_type      CharField (CONSULTATION/LAB_TEST/PROCEDURE/OTHER)
default_price  DecimalField(10,2)
is_active      BooleanField(default=True)
```

**Model: `Invoice`**
```
patient        FK → User (patient)
doctor         FK → User (doctor, null=True)
invoice_date   DateField(auto_now_add=True)
due_date       DateField
status         CharField (DRAFT/ISSUED/PAID/PARTIALLY_PAID/CANCELLED/VOID)
subtotal       DecimalField(10,2)
discount       DecimalField(10,2, default=0)
total          DecimalField(10,2)
paid_amount    DecimalField(10,2, default=0)
balance        DecimalField(10,2)  # total - paid_amount
currency       CharField(default='USD')
notes          TextField(blank=True)
```

**Model: `InvoiceItem`**
```
invoice        FK → Invoice
description    CharField
service_item   FK → ServiceItem(null=True)
quantity       PositiveIntegerField(default=1)
unit_price     DecimalField(10,2)
line_total     DecimalField(10,2)  # auto-computed
source_type    CharField (APPOINTMENT/LAB_ORDER/PROCEDURE)
source_id      PositiveIntegerField(null=True)
```

**Model: `Payment`**
```
invoice        FK → Invoice
paid_at        DateTimeField(auto)
amount         DecimalField(10,2)
payment_method CharField (CASH/CARD/BANK_TRANSFER/OTHER)
reference      CharField(blank=True)  # cheque no / card last 4
received_by    FK → User (secretary/manager)
notes          TextField(blank=True)
```

**Model: `FeeValidity`**
```
patient        FK → User (patient)
doctor         FK → User (doctor)
valid_from     DateField
valid_until    DateField  # valid_from + fee_validity_days from settings
used_count     PositiveIntegerField(default=0)
max_free_visits PositiveIntegerField(default=1)
invoice        FK → Invoice  # the original paid consultation
```

#### Week 2 — Billing Logic + APIs

**Auto-generate invoice on appointment completion:**
- `complete_appointment()` service → if no FeeValidity exists → create Invoice with consultation fee
- If FeeValidity exists and `used_count < max_free_visits` → increment used_count, no invoice

**API Endpoints:**
```
GET  /api/invoices/                  — list (patients: own, manager/secretary: all)
POST /api/invoices/                  — create (secretary/manager)
GET  /api/invoices/{id}/             — detail with items
PATCH /api/invoices/{id}/            — edit (DRAFT only)
POST /api/invoices/{id}/issue/       — DRAFT → ISSUED
POST /api/invoices/{id}/cancel/      — cancel
GET  /api/invoices/{id}/pdf/         — generate invoice PDF

POST /api/payments/                  — record payment (secretary/manager)
GET  /api/payments/?invoice=<id>     — list payments for invoice

GET  /api/service-items/             — list service items
POST /api/service-items/             — create (manager)

GET  /api/billing/outstanding/       — list unpaid invoices (manager/secretary)
GET  /api/reports/billing/?period=   — billing summary (total billed, collected, outstanding)
```

#### Week 3 — Frontend

**Secretary pages:**
- `AppointmentDeskPage` → on appointment completion, show "Generate Invoice" prompt
- New `BillingDeskPage` — list of outstanding invoices with "Record Payment" action

**Patient pages:**
- New `MyInvoicesPage` — list of own invoices with status, view PDF

**Manager pages:**
- `ReportsDashboardPage` → add billing section: total billed, collected, outstanding, per-doctor revenue
- `ManagerDashboard` → billing KPIs widget

**Components:**
- `InvoiceViewer` — invoice detail with items and payment history
- `PaymentForm` — amount, method, reference
- `InvoicePDFButton` — triggers PDF download

#### Tests
- Complete appointment → verify invoice auto-created with correct consultation fee
- FeeValidity active → complete appointment → verify no invoice created, used_count incremented
- Record payment → verify invoice balance updated
- Invoice status changes correctly (DRAFT → ISSUED → PAID)
- Patient cannot see another patient's invoice

---

## Phase 13 — Referrals + Complaints Master
**Duration: 1 week**  
**Priority: P3**

### Deliverables

#### Patient Referral

**New App: `apps/referrals`**

**Model: `Referral`**
```
patient               FK → User (patient)
referring_doctor      FK → User (doctor)
referred_to_doctor    FK → User (doctor, null=True, for internal referrals)
referred_to_specialty FK → Specialty (null=True)
referred_to_external  CharField(blank=True)  # external facility name
reason                TextField
referral_date         DateField(auto_now_add=True)
status                CharField (PENDING/ACCEPTED/COMPLETED/CANCELLED)
encounter             FK → Encounter(null=True)  # from Phase 8
notes                 TextField(blank=True)
```

**API Endpoints:**
```
GET  /api/referrals/           — list (doctors: own referrals, patients: own)
POST /api/referrals/           — create (doctor)
GET  /api/referrals/{id}/      — detail
PATCH /api/referrals/{id}/     — update status
```

**Frontend:** Doctor encounter page → "Add Referral" action. Patient page → "My Referrals" section.

#### Complaint Master

**Model: `Complaint`** (already defined in Phase 8 — implement here if Phase 8 not done yet)

**API:** `GET /api/complaints/?search=chest` — autocomplete for encounter chief complaint field.

**Seed data:** ~80 common outpatient complaints in English and Arabic.

---

## Phase 14 — Clinical Procedures Module
**Duration: 2 weeks**  
**Priority: P4**

### Goal
Enable documentation of minor clinic procedures (sutures, injections, biopsies, dressing changes).

### Deliverables

**New App: `apps/procedures`**

**Model: `ProcedureTemplate`**
```
name          CharField (e.g., "Wound Suturing", "Intradermal Injection")
name_ar       CharField
category      CharField (MINOR_SURGERY/INJECTION/DRESSING/BIOPSY/OTHER)
description   TextField
estimated_duration_minutes PositiveIntegerField
checklist     JSONField  # list of {step, required}
is_active     BooleanField(default=True)
```

**Model: `ClinicalProcedure`**
```
patient           FK → User (patient)
doctor            FK → User (doctor)
appointment       FK → Appointment(null=True)
encounter         FK → Encounter(null=True)
template          FK → ProcedureTemplate(null=True)
procedure_name    CharField  # free text if no template
status            CharField (SCHEDULED/IN_PROGRESS/COMPLETED/CANCELLED)
start_time        DateTimeField(null=True)
end_time          DateTimeField(null=True)
checklist_state   JSONField  # per-item completion status
pre_procedure_notes TextField
post_procedure_notes TextField
complications     TextField(blank=True)
```

**API Endpoints:**
```
GET  /api/procedure-templates/      — list templates
POST /api/procedure-templates/      — create (manager/doctor)
GET  /api/procedures/               — list (scoped)
POST /api/procedures/               — schedule/create
GET  /api/procedures/{id}/          — detail
PATCH /api/procedures/{id}/         — update (pre-notes, checklist state)
POST /api/procedures/{id}/start/    — SCHEDULED → IN_PROGRESS
POST /api/procedures/{id}/complete/ — IN_PROGRESS → COMPLETED (requires post-notes)
```

**Frontend:**
- Doctor encounter page → "Add Procedure" button
- `PatientRecordPage` → Procedures tab
- Procedure detail page with checklist (checkbox per step)

---

## Phase 15 — Radiology Order Templates
**Duration: 1 week**  
**Priority: P4**

### Goal
Replace the upload-only Scan model with structured radiology orders from encounters.

### Deliverables

**Extend `apps/lab` (or create `apps/radiology`):**

**Model: `RadiologyTemplate`**
```
name          CharField (e.g., "Chest X-Ray PA", "Abdominal Ultrasound")
name_ar       CharField
modality      CharField (XRAY/MRI/CT/ULTRASOUND/PET/OTHER)
body_part     CharField
instructions  TextField  # for patient preparation
is_active     BooleanField(default=True)
```

**Model: `RadiologyOrder`**
```
patient            FK → User (patient)
ordering_doctor    FK → User (doctor)
appointment        FK → Appointment(null=True)
encounter          FK → Encounter(null=True)
template           FK → RadiologyTemplate(null=True)
study_name         CharField  # free text if no template
clinical_reason    TextField
priority           CharField (ROUTINE/URGENT)
status             CharField (ORDERED/COMPLETED/REPORTED/CANCELLED)
ordered_at         DateTimeField(auto)
```

**Extend existing `Scan` model:**
- Add `radiology_order FK → RadiologyOrder(null=True)` — links uploaded scan file to a structured order

**API Endpoints:** CRUD for templates and orders; `POST /api/radiology-orders/{id}/complete/` to link uploaded scan file.

---

## Phase 16 — Advanced Analytics
**Duration: 1 week**  
**Priority: P4**

### Goal
Add specialty-level and diagnosis-level analytics to the manager reports dashboard.

### Deliverables

**Extend `apps/reports`:**

**New report endpoints:**
```
GET /api/reports/specialty-analytics/?period=month
  → appointments per specialty, completion rate per specialty, avg wait per specialty

GET /api/reports/diagnosis-distribution/?period=month
  → top 20 diagnoses by encounter count (requires Phase 10)

GET /api/reports/lab-analytics/?period=month
  → orders by category, avg turnaround time, abnormal rate

GET /api/reports/billing-summary/?period=month  (if Phase 12 done)
  → total billed, collected, outstanding, per-doctor revenue
```

**Frontend:**
- `ReportsDashboardPage` → new charts:
  - Bar chart: appointments by specialty
  - Pie chart: top diagnosis distribution
  - Line chart: monthly growth per specialty
  - Table: lab test turnaround times

---

## Testing Standards (All Phases)

Every phase must ship with:

1. **Unit tests** — model logic, auto-calculations, validation
2. **API tests** — all endpoints for all roles (patient/doctor/secretary/manager)
3. **Permission tests** — verify unauthorized access returns 403/404
4. **Notification tests** — verify correct notifications are sent
5. **Arabic content** — all new models have `*_ar` fields populated in seed data
6. **Accessibility** — new frontend components meet ≥18px text, 48px tap, AA contrast
7. **Audit coverage** — `record_event()` called for all CREATE/UPDATE/DELETE actions on new models

---

## Summary Timeline

```
Week 1    ████░░░░░░░░░░░░░░░░  Phase 5  — Vital Signs
Week 2    ░░░░████░░░░░░░░░░░░  Phase 6  — Lab Orders (Week 1: Models)
Week 3    ░░░░░░░░████░░░░░░░░  Phase 6  — Lab Orders (Week 2: APIs)
Week 4    ░░░░░░░░░░░░████░░░░  Phase 6  — Lab Orders (Week 3: Frontend)
Week 5    ░░░░░░░░░░░░░░░░████  Phase 7  — Patient History Timeline
Week 6    ████████░░░░░░░░░░░░  Phase 8  — Clinical Encounter (Week 1)
Week 7    ░░░░░░░░████████░░░░  Phase 8  — Clinical Encounter (Week 2)
Week 8    ░░░░░░░░░░░░░░░░████  Phase 9  — Medication Master (Week 1)
Week 9    ████░░░░░░░░░░░░░░░░  Phase 9  — Medication Master (Week 2)
Week 10   ░░░░████░░░░░░░░░░░░  Phase 10 — Diagnosis + ICD
Week 11   ░░░░░░░░████░░░░░░░░  Phase 11 — Sample Collection
Week 12   ░░░░░░░░░░░░████████  Phase 12 — Billing (Week 1: Models)
Week 13   ████████░░░░░░░░░░░░  Phase 12 — Billing (Week 2: APIs)
Week 14   ░░░░░░░░████████░░░░  Phase 12 — Billing (Week 3: Frontend)
Week 15   ░░░░░░░░░░░░░░░░████  Phase 13 — Referrals + Complaints
Week 16   ████████████░░░░░░░░  Phase 14 — Procedures (Week 1)
Week 17   ░░░░░░░░░░░░████░░░░  Phase 14 — Procedures (Week 2)
Week 18   ░░░░░░░░░░░░░░░░████  Phase 15 — Radiology Orders
Week 19   ████░░░░░░░░░░░░░░░░  Phase 16 — Advanced Analytics
```

**Total: ~19 weeks for all 12 modules (P1 through P4)**

If only doing P1 + P2 (the most impactful clinical features): **7 weeks**

---

## Recommended Start Order

If working alone (one developer at a time):

1. **Phase 5** (Vital Signs) — small, high value, zero dependencies. Good warm-up.
2. **Phase 7** (Patient History Timeline) — no new models, just API aggregation. Fast win.
3. **Phase 10** (Structured Diagnosis) — small model, needed by Phase 8.
4. **Phase 6** (Lab Orders) — highest clinical value, largest effort. Core of this plan.
5. **Phase 8** (Clinical Encounter) — depends on Phases 5, 6, 10 being done.
6. **Phase 9** (Medication Master) — extends Prescription model, standalone.
7. Continue P3 phases (11, 12, 13) then P4 phases (14, 15, 16).
