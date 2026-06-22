# Phase 7 & Phase 8 — Implementation Notes

> **Audience:** Development team members onboarding to these features.  
> **Scope:** Patient History Timeline (Phase 7) and Structured Clinical Encounter (Phase 8).  
> **Status:** Both phases fully implemented, migration-verified, TypeScript-clean, and API smoke-tested.

---

## 📂 1. File Changes Summary

### New Files

| Layer | Path | Purpose |
|---|---|---|
| **Backend** | `apps/encounters/__init__.py` | New Django app: Structured Clinical Encounter |
| **Backend** | `apps/encounters/apps.py` | `EncountersConfig` (BigAutoField) |
| **Backend** | `apps/encounters/admin.py` | Admin registrations for Encounter, Complaint, Diagnosis |
| **Backend** | `apps/encounters/models.py` | `Complaint`, `Diagnosis`, `Encounter` models + `EncounterStatus` choices |
| **Backend** | `apps/encounters/services.py` | `get_or_create_draft`, `submit_encounter`, `amend_encounter` |
| **Backend** | `apps/encounters/permissions.py` | `EncounterPermission` — role-based object/action guard |
| **Backend** | `apps/encounters/serializers.py` | `EncounterReadSerializer`, `EncounterWriteSerializer`, `ComplaintSerializer`, `DiagnosisSerializer` |
| **Backend** | `apps/encounters/views.py` | `EncounterViewSet`, `ComplaintViewSet`, `DiagnosisViewSet` |
| **Backend** | `apps/encounters/urls.py` | Router registrations → `/api/encounters/`, `/api/complaints/`, `/api/diagnoses/` |
| **Backend** | `apps/encounters/migrations/0001_initial.py` | Creates Encounter, Complaint, Diagnosis tables |
| **Backend** | `apps/encounters/migrations/0002_seed_complaints_diagnoses.py` | Seeds 12 Complaints + 12 Diagnoses per category |
| **Backend** | `apps/encounters/migrations/0003_alter_encounter_encounter_date.py` | Bugfix: `encounter_date` default → `timezone.localdate` |
| **Backend** | `apps/medical_records/migrations/0005_laborder_encounter_prescription_encounter.py` | Adds `encounter` FK to `LabOrder` and `Prescription` |
| **Backend** | `apps/medical_records/services/timeline.py` | `build_patient_timeline()` — unified event aggregator |
| **Frontend** | `src/services/timeline.api.ts` | `timelineApi.list()` — paginated timeline endpoint client |
| **Frontend** | `src/services/encounters.api.ts` | `encountersApi`, `complaintsApi`, `diagnosesApi` |
| **Frontend** | `src/components/primitives/AsyncCombobox.tsx` | Debounced async search combobox primitive |
| **Frontend** | `src/components/primitives/Modal.tsx` | Reusable modal overlay primitive |
| **Frontend** | `src/components/timeline/PatientTimeline.tsx` | Infinite-scroll timeline component |
| **Frontend** | `src/pages/doctor/EncounterPage.tsx` | Full clinical encounter form at `/doctor/encounters/:appointmentId` |
| **Frontend** | `src/pages/patient/PatientTimelinePage.tsx` | Patient-facing wrapper for `<PatientTimeline />` |

### Modified Files

| Layer | Path | What Changed |
|---|---|---|
| **Backend** | `apps/medical_records/models.py` | Added `encounter` FK to `Prescription` and `LabOrder` |
| **Backend** | `apps/medical_records/serializers.py` | Surfaced `encounter` field in both serializers |
| **Backend** | `apps/medical_records/urls.py` | Added `patients/<int:pk>/timeline/` route |
| **Backend** | `apps/medical_records/views.py` | Added `PatientTimelineView` + RBAC guard |
| **Backend** | `clinic_project/settings/base.py` | Registered `apps.encounters` in `LOCAL_APPS` |
| **Backend** | `clinic_project/urls.py` | Included `apps.encounters.urls` |
| **Frontend** | `src/services/types.ts` | Added `TimelineEvent`, `TimelineEventType`, `Encounter`, `EncounterStatus`, `UpdateEncounterPayload`, `CreateLabOrderPayload` |
| **Frontend** | `src/components/layout/RoleNav.tsx` | Added `nav.timeline` to patient nav; `nav.encounter` icon map entry |
| **Frontend** | `src/components/primitives/primitives.css` | Appended timeline + encounter layout CSS blocks |
| **Frontend** | `src/components/vitals/VitalSignsCard.tsx` | Added `editLocked` prop with greyed-out Edit button + tooltip |
| **Frontend** | `src/components/vitals/VitalSignsForm.tsx` | Extended `onSuccess` to pass the created `VitalSigns` object |
| **Frontend** | `src/components/vitals/VitalSignsHistory.tsx` | Passes `editLocked` when record is older than 24 h (non-manager) |
| **Frontend** | `src/pages/doctor/DoctorQueuePage.tsx` | "Open Clinical Encounter" button on `IN_PROGRESS` appointments |
| **Frontend** | `src/pages/doctor/DoctorAppointmentsPage.tsx` | Same "Open Clinical Encounter" button in appointment cards |
| **Frontend** | `src/pages/doctor/PatientRecordPage.tsx` | Added `<PatientTimeline />` section below Scans/Labs |
| **Frontend** | `src/routes/router.tsx` | Added `timeline` (patient) and `encounters/:appointmentId` (doctor) routes |
| **Frontend** | `src/i18n/en.json` | +~50 `timeline.*` keys + +~40 `encounters.*` keys (666 total) |
| **Frontend** | `src/i18n/ar.json` | Same additions in Arabic (666 total — exact parity with EN) |
| **Docs** | `qa-testing-guide.md` | Parts 3–5 added (AI Scribe, Patient, Manager role testing) |

---

## 📅 2. Phase 7 — Patient History Timeline

### Back-end Architecture

#### Service: `build_patient_timeline()`

**File:** `Backend/apps/medical_records/services/timeline.py`

This function is the single source of truth for the merged timeline feed. It queries six model sources independently — scoped to the requesting `PatientProfile` — maps each result to a canonical **event dict**, then sorts and filters the combined list in Python before pagination.

| Source Model | Event Type | `event_date` used | Summary Pattern |
|---|---|---|---|
| `VitalSigns` | `VITAL_SIGNS` | `created_at` | `BP: {systolic}/{diastolic} mmHg · HR: {heart_rate} bpm · Temp: {temp}°C` |
| `LabOrder` | `LAB_ORDER` | `created_at` | `Order #{number} ({priority}) · Status: {status}` |
| `Prescription` | `PRESCRIPTION` | `created_at` | `{item_count} items prescribed` |
| `ClinicalNote` | `CLINICAL_NOTE` | `created_at` | Truncated note body (~120 chars) |
| `MedicalRecord` (is_current=True) | `MEDICAL_RECORD` | `created_at` | Chief complaint + diagnosis snippet |
| `Appointment` (status=COMPLETED) | `APPOINTMENT_COMPLETED` | `completed_at` | `Completed consultation with Dr. {name}` |

Each event dict carries a `detail` key — a small serializable dict of the most relevant fields from the source object. This allows the frontend to expand any card **inline without a second API request**.

**Filtering** is applied in Python after the list is assembled:

```python
if types:    events = [e for e in events if e["event_type"] in wanted]
if date_from: events = [e for e in events if e["event_date"][:10] >= date_from]
if date_to:   events = [e for e in events if e["event_date"][:10] <= date_to]
events.sort(key=lambda e: e["event_date"] or "", reverse=True)
```

#### View + Endpoint

**File:** `Backend/apps/medical_records/views.py` → `PatientTimelineView(APIView)`  
**Endpoint:** `GET /api/patients/{id}/timeline/`

**RBAC matrix:**

| Role | Access |
|---|---|
| `MANAGER` | Full access to any patient's timeline |
| `DOCTOR` | Access only if `doctor_treats(request.user, patient)` returns True |
| `PATIENT` | Access only if `patient.user_id == request.user.id` (own timeline) |
| `SECRETARY` | **Always 403** — secretaries have no clinical read access |

**Pagination:** `DefaultPagination` (`PageNumberPagination`, `page_size=20`) is applied to the Python list via `paginator.paginate_queryset(events, request, view=self)`. Django REST Framework's paginator works on plain lists, not just querysets.

**Query parameters:**

| Param | Type | Description |
|---|---|---|
| `types` | comma-separated string | Filter to specific event types, e.g. `VITAL_SIGNS,LAB_ORDER` |
| `date_from` | `YYYY-MM-DD` | Inclusive lower bound on `event_date` |
| `date_to` | `YYYY-MM-DD` | Inclusive upper bound on `event_date` |
| `page` | integer | Page number (default 1) |
| `page_size` | integer | Results per page (default 20) |

---

### Front-end Implementation

#### Component: `<PatientTimeline patientId={number} />`

**File:** `Frontend/src/components/timeline/PatientTimeline.tsx`

**Data fetching — infinite scroll:**

Uses React Query v5 `useInfiniteQuery` with `initialPageParam: 1`. `getNextPageParam` reads the `next` URL from each page response; when `next` is `null`, the query is considered exhausted.

```ts
useInfiniteQuery({
  queryKey: ['timeline', patientId, filters],
  queryFn: ({ pageParam }) => timelineApi.list(patientId, filters, pageParam),
  initialPageParam: 1,
  getNextPageParam: (lastPage, _, lastPageParam) =>
    lastPage.next ? lastPageParam + 1 : undefined,
})
```

An `IntersectionObserver` is attached to a sentinel `<div>` at the bottom of the list (with `rootMargin: '200px'`). When the sentinel scrolls into the viewport, `fetchNextPage()` is called automatically.

**Visual layout:**

- Events are grouped by `Month YYYY` after flattening all pages.
- Each group header uses `position: sticky; top: 0` so it remains visible while scrolling within its month.
- Each event card has a `4px` left border colored by event type:

| Event Type | Border Color |
|---|---|
| `VITAL_SIGNS` | `#8B5CF6` (purple) |
| `LAB_ORDER` | `#3B82F6` (blue) |
| `PRESCRIPTION` | `#10B981` (green) |
| `CLINICAL_NOTE` | `#6B7280` (gray) |
| `MEDICAL_RECORD` | `#6B7280` (gray) |
| `APPOINTMENT_COMPLETED` | `#6B7280` (gray) |

- Clicking a card toggles inline expansion. The `detail` dict from the API response is rendered as a `<dl>` key/value table — no secondary fetch required.

**Filters toolbar:**

- 7 chip buttons: `All`, `Vitals`, `Labs`, `Prescriptions`, `Notes`, `Records`, `Appointments`. Selecting a chip sets the `types` filter query param.
- Two native `<input type="date" />` fields for `date_from` / `date_to`.
- Any filter change resets to page 1 by invalidating the infinite query.

**Routing:**

| Path | Component | Role |
|---|---|---|
| `/patient/timeline` | `PatientTimelinePage` (wraps `<PatientTimeline>` with `user.patient_profile.id`) | `PATIENT` |
| `/doctor/patients` (existing PatientRecordPage) | `<PatientTimeline patientId={selectedPatient.id} />` inline section | `DOCTOR` |

---

## 🩺 3. Phase 8 — Structured Clinical Encounter

### Back-end Architecture

#### Database Schema

**App:** `Backend/apps/encounters/`

##### `Complaint` (master lookup)

| Field | Type | Notes |
|---|---|---|
| `id` | BigAutoField | PK |
| `name` | CharField(200) | English display name |
| `name_ar` | CharField(200, blank) | Arabic display name |
| `category` | CharField(20, choices) | `CARDIAC / RESPIRATORY / GI / MUSCULOSKELETAL / NEUROLOGICAL / OTHER` |
| `is_active` | BooleanField | Soft-enables/disables items in the combobox |
| `created_at`, `updated_at` | DateTimeField | From `TimeStampedModel` |

##### `Diagnosis` (master lookup)

Identical structure to `Complaint`. Stored separately to allow independent naming and categorization of diagnoses vs. complaints.

Both tables are seeded via `0002_seed_complaints_diagnoses.py` (12 entries per category, 72 total each). The seed migration uses `RunPython` so it is idempotent via `get_or_create`.

##### `Encounter`

| Field | Type | FK Target | Notes |
|---|---|---|---|
| `patient` | FK CASCADE | `PatientProfile` | Profile-level FK (not `User`) |
| `doctor` | FK SET_NULL, nullable | `DoctorProfile` | Profile-level FK; null if doctor account deleted |
| `appointment` | OneToOneField SET_NULL, nullable | `Appointment` | Optional but standard link; one encounter per appointment |
| `encounter_date` | DateField | — | Default: `timezone.localdate` (returns `date`, **not** `datetime`) |
| `status` | CharField(12, choices) | — | `DRAFT / SUBMITTED / AMENDED` — db_indexed |
| `chief_complaint` | CharField(255, blank) | — | English |
| `chief_complaint_ar` | CharField(255, blank) | — | Arabic |
| `symptoms` | JSONField(default=list) | — | Array of symptom strings |
| `examination_findings` | TextField(blank) | — | English |
| `examination_findings_ar` | TextField(blank) | — | Arabic |
| `diagnosis` | FK SET_NULL, nullable | `Diagnosis` | Selected from master table |
| `diagnosis_notes` | TextField(blank) | — | Free-text annotation on chosen diagnosis |
| `treatment_plan` | TextField(blank) | — | English |
| `treatment_plan_ar` | TextField(blank) | — | Arabic |
| `vitals` | FK SET_NULL, nullable | `VitalSigns` | Linked vitals captured during this encounter |
| `version` | PositiveIntegerField(default=1) | — | Increments on amendment |
| `is_current` | BooleanField(default=True) | — | Only the latest version is `True` |
| `supersedes` | FK self SET_NULL, nullable | `Encounter` | Points to the previous version |
| `created_at`, `updated_at`, `deleted_at` | DateTimeField | — | From `SoftDeleteModel` + `TimeStampedModel` |

**Why Profile FKs (not User FKs)?**  
Every other clinical model in this system (`Prescription`, `LabOrder`, `MedicalRecord`, `VitalSigns`) uses `PatientProfile` and `DoctorProfile` as foreign keys. Using the same convention allows the existing `doctor_treats(user, patient)` helper and `scope_to_user(qs, user)` queryset scoper to work on encounters without modification.

**Prescription & LabOrder — encounter linkage:**

An `encounter` FK (`SET_NULL, nullable`) was added to both `Prescription` and `LabOrder` in `apps/medical_records`. This allows prescriptions and lab orders created *during* an encounter to be retrieved as `encounter.prescriptions.all()` and `encounter.lab_orders.all()` without duplicating data. The FK is nullable to preserve backwards compatibility with all existing records.

---

#### State Machine

```
┌─────────┐       submit_encounter()      ┌───────────┐
│  DRAFT  │  ─────────────────────────►  │ SUBMITTED │
└─────────┘                              └───────────┘
                                               │
                                amend_encounter()
                                               │
                                               ▼
                                         ┌─────────┐        submit_encounter()      ┌───────────┐
                                         │  DRAFT  │  ─────────────────────────►  │ SUBMITTED │
                                         │  (v2)   │                              │   (v2)    │
                                         └─────────┘                              └───────────┘
                                    (original marked AMENDED + is_current=False)
```

**`get_or_create_draft(appointment, doctor)`**

- Queries `Encounter.objects.filter(appointment=appointment).first()`.
- If one exists (any status), returns it — making the action **idempotent**.
- If none exists, creates a new `DRAFT` linked to the appointment's `patient` and the requesting `doctor`.

**`submit_encounter(encounter)` — `@transaction.atomic`**

1. Asserts `encounter.status == DRAFT`; raises `ValidationError` otherwise.
2. Sets `status = SUBMITTED`, saves with `update_fields`.
3. If the linked `appointment` is not yet `COMPLETED`, calls `complete_appointment(appointment)` (the existing service from `apps/appointments/services.py`).
4. Calls `create_record_version(patient, doctor, data)` (from `apps/medical_records/services/records.py`) with the encounter's `chief_complaint`, `diagnosis.name`, and `treatment_plan`. This mirrors the encounter content into the append-only `MedicalRecord` table, ensuring all existing history views and the AI Scribe context remain consistent with encounter data.

**`amend_encounter(encounter)` — `@transaction.atomic`**

1. Asserts `encounter.status == SUBMITTED`; raises `ValidationError` otherwise.
2. Marks the **original** encounter: `is_current = False`, `status = AMENDED`.
3. Creates a **twin** encounter with all clinical fields copied from the original, plus `version = original.version + 1`, `is_current = True`, `status = DRAFT`, `supersedes = original`.
4. Critically, the `appointment` field is **not** copied to the twin — the `OneToOneField` constraint would raise an `IntegrityError` if two encounters referenced the same appointment.
5. Returns the twin. The frontend should redirect to the twin's ID for continued editing.

---

#### API Endpoints

| Method | URL | Description |
|---|---|---|
| `GET` | `/api/encounters/` | List encounters (scoped by role) |
| `POST` | `/api/encounters/` | Create a freeform encounter (DOCTOR only) |
| `GET` | `/api/encounters/{id}/` | Retrieve encounter detail |
| `PATCH` | `/api/encounters/{id}/` | Update a DRAFT encounter (DOCTOR owner only) |
| `POST` | `/api/encounters/{id}/submit/` | Transition DRAFT → SUBMITTED |
| `POST` | `/api/encounters/{id}/amend/` | Transition SUBMITTED → AMENDED + return new DRAFT twin |
| `POST` | `/api/encounters/draft-for-appointment/` | Get or create a DRAFT encounter for a given appointment ID |
| `GET` | `/api/complaints/?search=` | Search complaint master lookup |
| `GET` | `/api/diagnoses/?search=` | Search diagnosis master lookup |

**Permission matrix:**

| Action | PATIENT | DOCTOR | SECRETARY | MANAGER |
|---|---|---|---|---|
| `list` | Own encounters | Own encounters | **403** | All |
| `retrieve` | Own only | Owning doctor only | **403** | All |
| `create` | ✗ | ✓ | **403** | ✓ |
| `update` (PATCH) | ✗ | DRAFT + owning doctor only | **403** | DRAFT only |
| `submit` | ✗ | Owning doctor only | **403** | ✓ |
| `amend` | ✗ | Owning doctor only | **403** | ✓ |
| `draft-for-appointment` | ✗ | ✓ (own appointment only) | **403** | ✓ |

---

#### Serializers

`EncounterReadSerializer` (GET responses):
- Includes nested `diagnosis_detail` (full `Diagnosis` object), `vitals_detail` (full `VitalSigns` object), `prescriptions` (lightweight list), `lab_orders` (lightweight list).
- Computed fields: `patient_name`, `doctor_name`.

`EncounterWriteSerializer` (POST/PATCH payloads):
- Accepts `chief_complaint(_ar)`, `symptoms`, `examination_findings(_ar)`, `diagnosis` (integer ID), `diagnosis_notes`, `treatment_plan(_ar)`, `vitals` (integer ID).
- `symptoms` is validated to be a list of non-empty strings.
- `doctor` is injected from `request.user.doctor_profile` in `perform_create` — not writable by the client.

---

### Front-end Implementation

#### Route

`/doctor/encounters/:appointmentId`  
**File:** `Frontend/src/pages/doctor/EncounterPage.tsx`

#### Mount Sequence

1. Read `appointmentId` from URL params.
2. Call `encountersApi.draftForAppointment(appointmentId)` — creates or retrieves the DRAFT encounter. This is idempotent: navigating away and back returns the same encounter.
3. Hydrate local form state **once** from the returned encounter data (guarded by a `hydratedRef` flag to prevent overwriting user edits on subsequent re-renders).
4. Display the encounter form with a status badge (DRAFT/SUBMITTED/AMENDED).

#### Form Layout — 4 Sequential Blocks

| Block | Fields | Mechanism |
|---|---|---|
| **1. Chief Complaint** | `chief_complaint` (EN + AR) | `AsyncCombobox` → `complaintsApi.search(q)` |
| **2. Symptoms & Vitals** | `symptoms[]` (multi-select tags), vitals capture | Symptom tags from complaint list; `VitalSignsForm` with `onSuccess` passing created ID → auto-PATCHes `encounter.vitals` |
| **3. Examination** | `examination_findings` (EN + AR) | Plain bilingual textareas |
| **4. Diagnosis & Treatment** | `diagnosis` FK, `diagnosis_notes`, `treatment_plan` (EN + AR) | `AsyncCombobox` → `diagnosesApi.search(q)` + textareas |

#### Debounced Autosave

All form field changes trigger a **600ms debounced PATCH** to `/api/encounters/{id}/` while `status === 'DRAFT'`. Before the Submit action fires, the debounce is flushed synchronously to ensure the final field values are persisted before the `submit` mutation runs.

#### `AsyncCombobox` Primitive

**File:** `Frontend/src/components/primitives/AsyncCombobox.tsx`

Props:

```ts
interface AsyncComboboxProps {
  value: number | null
  onChange: (id: number | null) => void
  fetcher: (q: string) => Promise<{ value: number; label: string }[]>
  placeholder?: string
  disabled?: boolean
  id?: string
}
```

Debounces the `fetcher` call by 300ms. Shows a spinner while fetching. Reuses `.select__control` / `.select__menu` CSS classes so it inherits the design system appearance. Used for both chief-complaint and diagnosis comboboxes.

#### Dynamic Action Sidebar

A sticky right-hand panel (via CSS grid: `1fr 320px`) contains:

- **"Add Prescription"** — opens `<Modal>` containing the existing prescription item form, pre-populating `encounter={encounter.id}`. On success, invalidates the `['encounter', id]` query so the sidebar list refreshes immediately.
- **"Order Labs"** — opens `<Modal>` containing the lab order form (test item rows), pre-populating `encounter={encounter.id}`. Same invalidation on success.
- Live lists of `encounter.prescriptions` and `encounter.lab_orders` are rendered below each button, derived from the encounter's cached read data.

#### Submit & Amend Flows

**Submit:**
1. Flush debounce.
2. Show confirm dialog.
3. Call `encountersApi.submit(encounter.id)`.
4. On success: navigate to `/doctor/queue`.

**Amend** (shown for `SUBMITTED` encounters):
1. Call `encountersApi.amend(encounter.id)`.
2. On success: the API returns the new DRAFT twin. The page reloads with the twin's data (twin ID replaces the URL param).

**Ownership guard:** The Amend and Submit buttons are only rendered if `user.doctor_profile.id === encounter.doctor`. The PATCH and Submit API calls will also return `403` server-side if this check fails — the UI guard is defence-in-depth only.

#### Entry Points

| Location | File | Trigger |
|---|---|---|
| Doctor Queue (`/doctor/queue`) | `DoctorQueuePage.tsx` | `"🩻 Open Clinical Encounter"` button appears when `appointment.status === 'IN_PROGRESS'` |
| Doctor Appointments (`/doctor/appointments`) | `DoctorAppointmentsPage.tsx` | Same button in each appointment card |

---

## 🧪 4. Verification & Stability

### Type Identity Guard — Profile IDs

All ownership comparisons in the frontend use the profile ID, never the raw `user.id`:

```ts
// Correct — compares doctor profile IDs
const isOwner = user.doctor_profile?.id === encounter.doctor

// Correct — compares patient profile IDs
const isOwnTimeline = user.patient_profile?.id === patientId
```

This matches the backend, where `Encounter.doctor` is a FK to `DoctorProfile` (not `User`). Using `user.id` against a profile FK would cause silently incorrect permission results in the UI.

### i18n Completeness

Both `Frontend/src/i18n/en.json` and `Frontend/src/i18n/ar.json` contain exactly **666 keys** after the Phase 7 + Phase 8 additions. Added key namespaces:

| Namespace | Key count | Notes |
|---|---|---|
| `timeline.*` | ~50 keys | Title, filter chip labels, date pickers, empty state, load-more, event-type labels |
| `encounters.*` | ~40 keys | Block titles, field labels, status labels (`DRAFT`/`SUBMITTED`/`AMENDED`), submit/amend dialog text, sidebar labels |
| `nav.timeline` | 1 key | Patient nav item |
| `nav.encounter` | 1 key | Icon map entry |

Parity is verified by running `Object.keys(en).length === Object.keys(ar).length` in a Node REPL against the two JSON files.

### DateField Bug — Migration `0003`

**Symptom:** `POST /api/encounters/draft-for-appointment/` returned:  
`AssertionError: Expected a 'date', but got a 'datetime'.`

**Root cause:** The original `Encounter.encounter_date` field used:
```python
encounter_date = models.DateField(default=timezone.now)
```
`timezone.now` returns a `datetime` object. Django's `DateField` serializer rejects this with the above assertion.

**Fix:**
```python
encounter_date = models.DateField(default=timezone.localdate)
```
`timezone.localdate()` returns a `datetime.date` object, which is the correct type.

Migration `0003_alter_encounter_encounter_date.py` was generated and applied to update the column default in the database.

### TypeScript Verification

`npx tsc --noEmit` ran clean after all Phase 7 and Phase 8 changes. The only issue caught during development was an unused `useMemo` import in `EncounterPage.tsx` (removed before final build).

### API Smoke Test Results

All tests passed. Summary:

```
Timeline RBAC
  GET /api/patients/1/timeline/ as treating doctor     → 200
  GET /api/patients/1/timeline/ as manager             → 200
  GET /api/patients/1/timeline/ as secretary           → 403  ✓
  GET /api/patients/1/timeline/ as owning patient      → 200
  GET /api/patients/1/timeline/?types=VITAL_SIGNS      → 200 (filtered)

Complaints / Diagnoses search
  GET /api/complaints/?search=chest    → "Chest pain" (1 result)
  GET /api/diagnoses/?search=hyper     → "Hypertension" (1 result)

Encounter lifecycle
  POST /api/encounters/draft-for-appointment/ {appointment:1}  → id=4 (DRAFT)
  POST /api/encounters/draft-for-appointment/ {appointment:1}  → id=4 (same — idempotent)
  PATCH /api/encounters/4/  {chief_complaint:"Chest pain"}     → 200
  POST /api/encounters/4/submit/                               → 200 (SUBMITTED)
  PATCH /api/encounters/4/  {chief_complaint:"..."}            → 403 (not DRAFT)
  POST /api/encounters/4/amend/                                → twin id=5 v2 DRAFT supersedes=4
    original: is_current=False, status=AMENDED
    twin:     is_current=True,  status=DRAFT

Secretary create attempt
  POST /api/encounters/  (as secretary)                        → 403  ✓
```

### Production Build

```
npm run build
  ✓ Built in 930ms
  Bundle: 659.77 kB (gzip: ~195 kB)
  No warnings
```

---

*Generated: Phase 7 + Phase 8 implementation — Clinic System v2.0*
