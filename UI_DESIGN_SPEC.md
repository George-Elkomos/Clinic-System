# Clinic System — Complete UI Design Specification
### Version 2.0 · Full Codebase Audit · All Phases Included

> **Purpose:** This is the single, authoritative reference for the UI designer. It covers every page, every screen state, every interaction, every modal, every workflow, and every design consideration derived from a complete audit of the frontend source code. Use this document to design the highest-quality user experience for each screen.

---

## Table of Contents

1. [System Overview & Architecture](#system-overview--architecture)
2. [Roles, Routes & Access Matrix](#roles-routes--access-matrix)
3. [Global Design System](#global-design-system)
4. [End-to-End User Workflows](#end-to-end-user-workflows)
5. [Public Pages (7 screens)](#public-pages)
6. [Patient Pages (11 screens)](#patient-pages)
7. [Doctor Pages (11 screens)](#doctor-pages)
8. [Secretary Pages (10 screens)](#secretary-pages)
9. [Manager Pages (7 screens)](#manager-pages)
10. [Account Settings (1 screen)](#account-settings)
11. [All Modals & Overlays](#all-modals--overlays)
12. [Shared Components Reference](#shared-components-reference)
13. [Status Badge & Color System](#status-badge--color-system)
14. [Critical UX Patterns](#critical-ux-patterns)

---

## System Overview & Architecture

A full-stack multi-role **Clinic Management System** with bilingual EN/AR support. Built with React 18 + TypeScript, TanStack Query, React Router v6, and i18next.

### What the System Does

| Domain | Description |
|--------|-------------|
| **Appointments** | Book, confirm, check in, start, complete, cancel appointments |
| **Queue Management** | Live doctor queue with WebSocket real-time updates |
| **Clinical Encounters** | Structured SOAP notes, diagnosis (ICD-10), treatment plans |
| **Prescriptions** | Issue, void, reissue prescriptions with drug interaction checking |
| **Lab Orders** | Full lab workflow: order → collect → process → results |
| **Clinical Procedures** | Schedule, start, complete procedures with step-by-step checklist |
| **Referrals** | Internal (specialty/doctor) and external referrals |
| **Vital Signs** | Record, trend, and chart vital signs |
| **Medical Records** | Versioned records, clinical notes, scans, labs |
| **Billing & Invoicing** | Auto-generated invoices, payment recording, revenue reports |
| **Reviews** | Patient ratings and moderated reviews |
| **Notifications** | In-app, email, SMS preferences |
| **Audit Log** | Compliance trail of all system actions |

### Technology Choices That Affect UI Design
- **TanStack Query** → loading/error/stale states on every data-fetching component
- **WebSocket** → Doctor Queue page updates in real-time (no polling) via `useDoctorQueueSocket`
- **Auto-save** → Encounter form auto-saves 600ms after last keystroke
- **i18next EN/AR** → All text is translated; Arabic = RTL layout flip
- **ICD-10** → Diagnosis combobox shows `Name (ICD-10 code)` to aid coding accuracy

---

## Roles, Routes & Access Matrix

### Route Map (Complete)

| Route | Component | Role(s) |
|-------|-----------|---------|
| `/` | RootRedirect | All → role home |
| `/login` | LoginPage | Public |
| `/register` | RegisterPage | Public |
| `/doctors` | PublicDoctorsPage | Public |
| `/doctors/:id` | DoctorDetailPage | Public |
| `/kiosk/:doctorId` | KioskQueuePage | Public |
| `/403` | ForbiddenPage | Public |
| `*` | NotFoundPage | Public |
| `/patient` | PatientDashboard | PATIENT |
| `/patient/book` | BookAppointmentPage | PATIENT |
| `/patient/appointments` | MyAppointmentsPage | PATIENT |
| `/patient/history` | MyMedicalHistoryPage | PATIENT |
| `/patient/scans` | MyScansLabsPage | PATIENT |
| `/patient/prescriptions` | MyPrescriptionsPage | PATIENT |
| `/patient/vitals` | PatientVitalSignsTab | PATIENT |
| `/patient/lab-results` | PatientLabResultsPage | PATIENT |
| `/patient/timeline` | PatientTimelinePage | PATIENT |
| `/patient/invoices` | MyInvoicesPage | PATIENT |
| `/patient/referrals` | MyReferralsPage | PATIENT |
| `/doctor` | DoctorDashboard | DOCTOR |
| `/doctor/queue` | DoctorQueuePage | DOCTOR |
| `/doctor/schedule` | ScheduleManagementPage | DOCTOR |
| `/doctor/appointments` | DoctorAppointmentsPage | DOCTOR |
| `/doctor/patients` | PatientRecordPage | DOCTOR |
| `/doctor/reviews` | DoctorReviewsPage | DOCTOR |
| `/doctor/lab-orders` | LabOrdersListPage | DOCTOR |
| `/doctor/lab-orders/new` | CreateLabOrderPage | DOCTOR |
| `/doctor/lab-orders/:id` | LabOrderDetailsPage | DOCTOR |
| `/doctor/encounters/:appointmentId` | EncounterPage | DOCTOR |
| `/doctor/referrals` | DoctorReferralsPage | DOCTOR |
| `/secretary` | SecretaryDashboard | SECRETARY, MANAGER |
| `/secretary/desk` | AppointmentDeskPage | SECRETARY, MANAGER |
| `/secretary/queue` | QueueBoardPage | SECRETARY, MANAGER |
| `/secretary/absences` | DoctorAbsencePage | SECRETARY, MANAGER |
| `/secretary/doctors` | DoctorsPage | SECRETARY, MANAGER |
| `/secretary/patients` | PatientDirectoryPage | SECRETARY, MANAGER |
| `/secretary/lab` | SampleCollectionPage | SECRETARY, MANAGER |
| `/secretary/lab/:id` | LabOrderDetailsPage | SECRETARY, MANAGER |
| `/secretary/billing` | BillingDeskPage | SECRETARY, MANAGER |
| `/secretary/referrals` | SecretaryReferralsPage | SECRETARY, MANAGER |
| `/manager` | ManagerDashboard | MANAGER |
| `/manager/reports` | ReportsDashboardPage | MANAGER |
| `/manager/billing` | BillingReportsPage | MANAGER |
| `/manager/reviews` | ReviewModerationPage | MANAGER |
| `/manager/audit` | AuditLogPage | MANAGER |
| `/manager/users` | UserManagementPage | MANAGER |
| `/manager/doctors/new` | CreateDoctorPage | MANAGER |
| `/account/notifications` | NotificationPrefsPage | All authenticated |

### Navigation Menu by Role

**PATIENT sidebar:** Dashboard, Book Appointment, My Appointments, My History, My Prescriptions, Scans & Labs, Lab Results, Vital Signs, My Timeline, My Invoices, My Referrals, Notifications

**DOCTOR sidebar:** Dashboard, Live Queue, Appointments, Patient Records, Lab Orders, Referrals, My Reviews, Schedule, Notifications

**SECRETARY sidebar:** Dashboard, Appointment Desk, Queue Board, Billing Desk, Lab Samples, Referrals, Patient Directory, Doctors, Doctor Absences, Notifications

**MANAGER sidebar:** Dashboard (Manager), Reports, Billing Reports, User Management, Review Moderation, Audit Log, + all Secretary links

---

## Global Design System

### App Shell
Every authenticated page wraps in `<AppShell>`:
- **Sidebar navigation** — role-specific links, collapsible on mobile
- **Top header bar** — contains: hamburger menu (mobile), clinic logo/name, language switcher, notification bell, user avatar
- **Content area** — page-specific content below breadcrumbs

### Breadcrumbs
Every inner page begins with a breadcrumb trail. Design as a subtle single-line path: `Home > Section > Page Name`

### Toast Notifications
- Position: top-right (top-center on mobile)
- Three variants: `success` (green), `error` (red), `info` (neutral/blue)
- Auto-dismiss after ~4 seconds
- Never stack more than 3 at once

### Confirm Dialogs
- Centered modal with overlay
- Title (bold, H2), message paragraph
- Two buttons: Cancel (secondary) + Confirm (primary or danger red)
- Used before ALL destructive/irreversible actions

### Loading States
| Scenario | Visual |
|----------|--------|
| Full page initial load | Centered spinner (full content area) |
| Card/section loading | Skeleton placeholder inside card |
| Button action in progress | Spinner inside button + button disabled |
| Silent background refresh (WebSocket, polling) | No UI interruption |
| Inline form submit | Button loading state only |

### Language & RTL
- Language toggle: EN ↔ AR (always visible in header and on login/register)
- When Arabic active: **entire layout mirrors** (RTL — sidebar on right, text right-aligned)
- Some specific textareas have `dir="rtl"` for Arabic content even in English mode (bilingual documentation)
- Diagnosis combobox: shows `Name (ICD-10)` — Arabic name shown when in AR mode

---

## End-to-End User Workflows

### Workflow 1: Patient Books & Attends Appointment
```
Patient Registers/Logs in
  → Views Doctor Profile (/doctors/:id)
  → Selects date + time slot
  → Books appointment (status: PENDING)
  → Secretary confirms (status: CONFIRMED)
  → Patient arrives → Secretary checks in (status: CHECKED_IN)
  → Doctor calls next → appointment starts (status: IN_PROGRESS)
  → Patient sees queue position in real-time on My Appointments
  → Doctor opens Encounter, documents SOAP notes
  → Doctor submits Encounter → appointment COMPLETED
  → Invoice auto-generated → InvoiceGeneratedModal pops up for doctor
  → Patient can view invoice at /patient/invoices
  → Patient leaves review
```

### Workflow 2: Doctor's Clinical Documentation
```
Doctor opens Queue Page (/doctor/queue)
  → Sees current patient with allergy alert, chronic conditions
  → Clicks "Open Encounter" link
  → Encounter Page auto-creates draft
  → Doctor fills Chief Complaint (bilingual async search)
  → Records Vital Signs (linked to encounter)
  → Fills Examination Findings (EN + AR)
  → Sets Diagnosis (ICD-10 search + code display)
  → Writes Treatment Plan (EN + AR)
  → OPTIONALLY: Orders Lab Test → creates + auto-submits order
  → OPTIONALLY: Issues Prescription → drug interaction check runs
  → OPTIONALLY: Schedules Procedure → checklist-driven
  → OPTIONALLY: Creates Referral (internal or external)
  → Submits Encounter → returns to queue
  → Billing system auto-generates invoice on appointment completion
```

### Workflow 3: Lab Order Lifecycle
```
Doctor orders labs from Encounter or /doctor/lab-orders/new
  → Lab order status: ORDERED
  → Secretary sees order in Sample Collection (Tab 1)
  → Secretary clicks "Collect Sample" → status: SAMPLE_COLLECTED
  → Secretary clicks "Start Processing" → status: PROCESSING
  → Lab tech enters results at /secretary/lab/:id or /doctor/lab-orders/:id
  → Status: COMPLETED
  → Doctor reviews + closes order
  → Patient sees results at /patient/lab-results
```

### Workflow 4: Referral Flow
```
Doctor creates referral from Encounter sidebar ("Refer Patient" button)
  → Chooses INTERNAL (specialty + optional target doctor) or EXTERNAL (facility name)
  → Fills reason (EN + AR) and notes
  → Referral status: PENDING
  → Receiving doctor sees referral on their /doctor/referrals (Received tab)
  → Receiving doctor accepts → status: ACCEPTED
  → Receiving doctor completes → status: COMPLETED
  → Secretary sees all referrals at /secretary/referrals (read-only, for scheduling)
  → Patient sees their referrals at /patient/referrals
```

### Workflow 5: Billing & Payment
```
Appointment COMPLETED
  → System auto-generates invoice
  → InvoiceGeneratedModal shown to doctor on Queue page
  → Invoice status: ISSUED
  → Secretary sees it in Billing Desk (/secretary/billing) under "Outstanding"
  → Secretary clicks "Record Payment" → PaymentFormModal
  → Enters amount (defaults to balance), method (CASH/CARD/BANK_TRANSFER), reference
  → If full payment: invoice status → PAID
  → Patient sees invoice at /patient/invoices
  → Manager sees revenue summary in /manager/billing
```

### Workflow 6: Clinical Procedure
```
Doctor clicks "Add Procedure" in Encounter sidebar
  → ProcedureModal: select from templates OR enter custom name
  → Procedure status: SCHEDULED
  → Doctor opens procedure from encounter sidebar list
  → ProcedureDetailModal: reviews checklist, adds pre-procedure notes
  → Doctor clicks "Start" → status: IN_PROGRESS
  → Doctor ticks checklist steps
  → Doctor adds post-procedure notes + complications (optional)
  → Doctor clicks "Complete" → status: COMPLETED
  → Cancellation available at any non-terminal status (requires reason)
```

---

## PUBLIC PAGES

---

### P-01 · Landing Page
**Route:** `/` (redirects based on login state)  
**Route (actual):** A public home accessible when not logged in  
**Access:** Public

#### Purpose
Marketing/entry point for the clinic. Showcases doctors and directs visitors to register or browse.

#### Layout & Sections

**Hero Section**
- Full-width banner, top of page
- H1: Clinic name + tagline
- Sub-headline: Brief description of services
- Two CTA buttons (side by side):
  - "Browse Doctors" → `/doctors`
  - "Register as Patient" → `/register`
- Background: consider gradient, subtle pattern, or hero illustration

**"How It Works" Section**
- Headline: "How It Works"
- 3 horizontally laid steps (icon + number + title + 1-line description):
  1. Find a Doctor (icon: stethoscope or search)
  2. Book a Slot (icon: calendar)
  3. See Your Doctor (icon: checkmark or person)

**Top Rated Doctors Section**
- Headline: "Our Top Doctors"
- Horizontal scroll or 3-column grid of `DoctorCard` components (top 6 by rating)
- Data source: API fetch, top 6 highest-rated doctors
- Each Doctor Card shows:
  - Circular photo
  - Name (bold)
  - Specialty tags (colored pills)
  - Star rating + review count
  - "Book Now" button → `/doctors/:id`

**Register CTA Banner**
- Full-width accent banner
- "Ready to get started?" headline
- "Register for Free" button → `/register`

#### States
- **Doctors loading** → skeleton cards in the doctor grid
- **No doctors** → section hidden gracefully
- **Logged-in user hits `/`** → immediate redirect to role-specific home

#### Design Notes
- This is the clinic's public face. The design should feel professional and welcoming.
- Doctor cards should show ratings prominently; trust signals matter for bookings.
- Language switcher must be visible on this page.

---

### P-02 · Login Page
**Route:** `/login`  
**Access:** Public (redirects to role home if already authenticated)

#### Purpose
Authenticate existing users (patients, doctors, secretaries, managers).

#### Layout
- Centered single-column card, vertically and horizontally centered
- Clinic logo above the card
- Language switcher in the page header (top-right)

#### Form
| Field | Input Type | Validation |
|-------|-----------|------------|
| Email address | `type="email"` | Required |
| Password | `type="password"` with show/hide toggle | Required |

#### Actions
- **Login button** — primary, full-width; shows loading spinner during request
- **"Don't have an account? Register"** — link below the button → `/register`

#### State Machine
| State | What the UI Shows |
|-------|------------------|
| Idle | Clean form |
| Loading | Button spinner, inputs disabled |
| Error (invalid credentials) | Red inline error: "Invalid email or password" |
| Error (no connectivity) | Red inline error: "Cannot connect to server. Check your connection." |
| Success | Redirect to role home (or `?next=` param URL) |

#### Design Notes
- The `?next=` query param means if a user was redirected to login mid-session, they return to their previous page after login. No extra UI needed — just handle it in the redirect logic.
- Keep the form minimal. No distractions. This is used by clinic staff daily.

---

### P-03 · Register Page
**Route:** `/register`  
**Access:** Public (patient self-registration only)

#### Purpose
New patients create their own account.

#### Layout
- Same centered card layout as login
- Clinic logo above
- Language switcher visible

#### Form
| Field | Input Type | Notes |
|-------|-----------|-------|
| First Name | Text | Required |
| Last Name | Text | Required |
| Phone | `type="tel"` | Required |
| Email | `type="email"` | Required |
| Password | Password with show/hide toggle | Required |

#### Actions
- **Register button** — primary, full-width; shows loading spinner
- **"Already have an account? Login"** — link → `/login`

#### State Machine
| State | UI |
|-------|----|
| Loading | Button spinner, inputs disabled |
| Error (email taken) | Inline error on email field |
| Error (validation) | Per-field error messages |
| Success | Auto-logs in → redirects to `/patient` dashboard |

---

### P-04 · Public Doctors Page
**Route:** `/doctors`  
**Access:** Public

#### Purpose
Browse all available doctors. Entry point for patients choosing who to see.

#### Layout
- Filter bar at top (full width)
- Doctor grid below

#### Filter Bar
| Control | Type | Behavior |
|---------|------|----------|
| Search | Text input with search icon | Filters by doctor name (client or server-side) |
| Specialty | Dropdown | Options populated from API; first option "All Specialties" |

#### Doctor Grid
- Responsive: 3 col (desktop) → 2 col (tablet) → 1 col (mobile)
- Each `DoctorCard`:
  - Circular photo (placeholder if no photo)
  - Doctor name (bold, H3)
  - Specialty tags (colored pills, e.g., Cardiology = red, Dermatology = pink)
  - Star rating (visual stars) + "(X reviews)"
  - "View Profile" button → `/doctors/:id`

#### States
- **Loading** → skeleton cards in grid (match card dimensions)
- **Empty search results** → "No doctors found for your search. Try a different specialty or name."
- **Error** → error message with retry button

---

### P-05 · Doctor Detail Page
**Route:** `/doctors/:id`  
**Access:** Public. Booking requires PATIENT login.

#### Purpose
Full doctor profile + appointment booking. The key patient conversion screen.

#### Layout
Two-column desktop (left: doctor info, right: booking) → single column mobile.

---

**LEFT COLUMN — Doctor Profile**

**Doctor Card Header**
- Large circular photo (or initials fallback)
- H1: Doctor full name
- Specialties: color-coded pills (e.g., "Cardiology", "Internal Medicine")

**Info Row (below name)**
- ⭐ Average rating (e.g., "4.8") + "(42 reviews)"

**Details Grid**
| Label | Value |
|-------|-------|
| Room | e.g., "Room 204" |
| Languages | e.g., "English, Arabic" |
| Appointment Duration | e.g., "30 minutes" |
| Experience | e.g., "12 years" |

**Bio**
- Free text paragraph describing the doctor's background

---

**RIGHT COLUMN — Booking Widget**

**Date Selector**
- 7 day buttons in a horizontal row (today + 6 days ahead)
- Each button: abbreviated day name + date number (e.g., "Mon\n14")
- Selected day: highlighted with primary color
- Horizontally scrollable on mobile

**Time Slots Grid**
- Grid of time buttons for the selected date (e.g., "09:00", "09:30", "10:00")
- Selected slot: highlighted
- Unavailable slots: visually grayed/strikethrough
- Loading state: skeleton buttons while fetching
- "No available slots for this date" message + waitlist option when empty

**Reason for Visit**
- Textarea: "What brings you in today?" (optional or required)

**Book Button**
- Shown only for logged-in PATIENT users
- Disabled until slot selected
- Shows loading state during booking

**Auth Prompt (when not logged in)**
- "Login to book this appointment" button → `/login?next=/doctors/:id`

**Waitlist Banner (when no slots)**
- "This doctor is fully booked for the selected date."
- "Join Waitlist" button

---

**REVIEWS SECTION (below main content, full width)**
- H2: "Patient Reviews"
- Each review card:
  - Star rating (visual, 1-5)
  - Comment text (or "No comment left")
  - Date (formatted, e.g., "March 2025")
- If no reviews: "No reviews yet for this doctor"

#### States
- **Initial load** → full spinner while fetching doctor data
- **Slot fetch** → skeleton in slots area while fetching (doctor + date selected)
- **Booking success** → success toast + redirect to `/patient/appointments`
- **Booking error** → error toast with message

---

### P-06 · Kiosk Queue Page
**Route:** `/kiosk/:doctorId`  
**Access:** Public (no authentication required)

#### Purpose
Large-screen waiting room display showing live queue status for a specific doctor. Designed to be mounted on a TV or kiosk tablet in the waiting area.

#### Design Principles
- **Designed for distance reading** — minimum 48px text for patient names, 24px for secondary info
- **High contrast** — dark or very light backgrounds only
- **No interaction required** — auto-refreshes; no keyboard/mouse needed
- **Auto-refreshes every 30 seconds**

#### Layout
Full-screen, no navigation chrome.

**Header Strip**
- Doctor name (H2)
- Current date/time (live clock optional)

**NOW SERVING Section (dominant center)**
- "NOW SERVING" label (caps, muted, small)
- Patient name in **very large bold text** (60px+)
- Time called (e.g., "Called at 10:32 AM")
- Green/teal left border or background accent

**UP NEXT Section**
- "UP NEXT" label
- List of next 2–3 patients:
  - Patient name (large)
  - Scheduled time
  - EMERGENCY badge (bright red) if emergency
  - WALK-IN badge (orange) if walk-in

**WAITING COUNT**
- "X patients waiting" — large number

**Footer**
- "Last updated: X seconds ago" (auto-updates)

#### States
- **Empty queue** → "No patients currently waiting" in center
- **Connection issue** → show last known state + "Unable to refresh" indicator
- **EMERGENCY in queue** → entire "NOW SERVING" section gets red accent treatment

---

### P-07 · Error Pages (403 / 404)
**Routes:** `/403` and `*` (catch-all)  
**Access:** Public

#### 403 Forbidden Page
- Icon: lock or shield (SVG illustration)
- H1: "Access Denied"
- Message: "You don't have permission to view this page."
- "Go to Home" button → role home or `/login`

#### 404 Not Found Page
- Icon: magnifying glass or empty result (SVG illustration)
- H1: "Page Not Found"
- Message: "The page you're looking for doesn't exist or has been moved."
- "Go to Home" button

#### Design Notes
- These should match the system's visual language (fonts, colors, spacing)
- Friendly and non-alarming tone
- Should work for both logged-in and public users

---

## PATIENT PAGES

---

### PT-01 · Patient Dashboard
**Route:** `/patient`  
**Access:** PATIENT

#### Purpose
Patient's home. Quick overview + primary navigation shortcuts.

#### Layout
- Greeting: "Good morning, [First Name]!" (time-appropriate: morning/afternoon/evening)
- Two cards side by side on desktop, stacked on mobile

**Quick Actions Card**
- Two large buttons, icon + label:
  - 📅 "Book an Appointment" → `/patient/book`
  - 🗓 "My Appointments" → `/patient/appointments`
- These are the most-used patient actions. Make them prominent (full-width buttons in the card).

**Upcoming Appointments Card**
- Title: "Upcoming Appointments"
- Shows appointments with status: PENDING, CONFIRMED, or CHECKED_IN only
- Each item:
  - Doctor name (bold)
  - Formatted date + time
  - Status badge
- If none: "No upcoming appointments. [Book one →]"

#### States
- **Loading** → skeleton in appointments card
- **Empty** → friendly empty state with CTA
- **Data present** → list with max ~5 items visible (overflow scrolls or shows "View all")

---

### PT-02 · Book Appointment Page
**Route:** `/patient/book`  
**Access:** PATIENT

#### Purpose
Patient selects a doctor, date, and time slot to book.

#### Layout
Single-column, step-by-step form.

**Step 1 — Select Doctor**
- Searchable dropdown: "Select a Doctor"
- Each option shows: doctor name + specialty
- Required before steps 2–4 appear

**Step 2 — Select Date**
- Date picker (restricted to today or future only)
- Appears immediately after doctor selection

**Step 3 — Reason for Visit**
- Textarea: "What's the reason for your visit?"
- Can appear alongside date selection

**Step 4 — Available Time Slots**
- Grid of time buttons
- Appears after doctor + date are both selected
- Loading spinner while API fetches slots
- Selected slot: highlighted in primary color
- Unavailable: grayed out

**Waitlist Option** (when no slots available)
- "No available slots for this date."
- "Join Waitlist" button — registers patient for the next available opening

**Book Appointment Button**
- Primary, disabled until doctor + date + slot are selected
- Shows loading during booking
- On success: toast + redirect to `/patient/appointments`

---

### PT-03 · My Appointments Page
**Route:** `/patient/appointments`  
**Access:** PATIENT

#### Purpose
Comprehensive view of all appointments: status tracking, queue position, follow-up confirmation, and review submission.

#### Layout
Multiple stacked sections.

---

**SECTION 1 — Today's Status Card** *(conditional: shown only if there's an appointment today)*
- Blue/teal background card — eye-catching
- Content:
  - Doctor name + specialty
  - Scheduled time
  - Current status badge (large)
  - Queue position: "You are **#3** in queue"
  - Estimated wait: "~**15 minutes**"
  - For IN_PROGRESS appointments: "Open your encounter record" link (styled as a button)
- **Auto-refreshes every 30 seconds** while appointment is active
- Design: this should feel like a live status panel, not a static card

---

**SECTION 2 — Suggested Follow-Ups** *(conditional: shown if doctor recommended follow-up)*
- Title: "Suggested Follow-Up"
- Each suggestion card:
  - "Your doctor recommends a follow-up visit"
  - Recommended date
  - Doctor's notes
  - Two buttons: "Confirm" (books the follow-up) + "Dismiss"

---

**SECTION 3 — All Appointments**
- Full chronological list of all appointments
- Each appointment card:
  - Doctor name + specialty (bold)
  - Date + time (formatted)
  - Reason for visit
  - Status badge
  - **CANCEL button** — shown only for PENDING or CONFIRMED (with confirmation dialog)
  - **LEAVE A REVIEW button** — shown only for COMPLETED, only if not yet reviewed
    - Clicking expands inline review form:
      - ⭐⭐⭐⭐⭐ Star selector (1–5)
      - Textarea: "Share your experience (optional)"
      - "Submit Review" button
    - Form collapses after submission, "Reviewed ✓" label shown

---

**SECTION 4 — Waitlist** *(conditional: shown if on any waitlists)*
- Title: "Your Waitlist Entries"
- Each entry:
  - Doctor name
  - Specialty
  - Date requested
  - "Leave Waitlist" button (with confirmation)

---

### PT-04 · My Medical History Page
**Route:** `/patient/history`  
**Access:** PATIENT

#### Purpose
Patient edits their health background and reads records/notes left by doctors.

#### Layout
Three cards stacked.

**Card 1 — Background Information (Patient-Editable)**
| Field | Type | Description |
|-------|------|-------------|
| Blood Type | Dropdown | A+, A-, B+, B-, O+, O-, AB+, AB- |
| Allergies | Textarea | Free text: drug/food/environmental allergies |
| Chronic Conditions | Textarea | e.g., "Diabetes type 2, Hypertension" |
| Previous Surgeries | Textarea | e.g., "Appendectomy 2019" |
| Current Medications | Textarea | What the patient is currently taking |
- "Save" button — shows loading spinner while saving
- This data appears in the Doctor Queue Page as contextual info

**Card 2 — Medical Records (Read-only)**
- Structured records created by doctors during encounters
- Each record:
  - Version badge: "v1", "v2", "v3" (newest = highest version)
  - "CURRENT" badge on the latest active version
  - Date + doctor name (muted)
  - Diagnosis text
  - Treatment plan text
- Chronological, newest first
- Empty: "No medical records yet"

**Card 3 — Clinical Notes (Read-only)**
- Free-text notes from doctors
- Each note:
  - Specialty category (e.g., "Cardiology")
  - Doctor name + date
  - Note body text
- Empty: "No clinical notes yet"

---

### PT-05 · My Prescriptions Page
**Route:** `/patient/prescriptions`  
**Access:** PATIENT

#### Purpose
Patient views all prescriptions issued to them.

#### Layout
List of prescription cards, newest first.

**Each Prescription Card**
- **Header row:**
  - "Issued on [date]" by [Doctor Name]
  - Status: ACTIVE (green badge) or VOIDED (red badge + strikethrough style)
- **Medications list:**
  - Each medication row:
    - Drug name (bold)
    - Dosage strength + form (e.g., "500mg Tablet")
    - Dosage pattern (e.g., "1-0-1")
    - Frequency (e.g., "Twice daily")
    - Duration (e.g., "7 days")
    - Instructions (e.g., "Take after food")
- **Notes** (if any) — italic, below medications
- **"Open PDF" button** — only for ACTIVE prescriptions; opens printable PDF
- **Void info** (if cancelled):
  - "Voided on [date]" by [name]
  - "Reason: [reason text]"
  - Medications appear with strikethrough or muted styling

#### States
- **Loading** → skeleton cards
- **Empty** → "No prescriptions have been issued to you yet."

---

### PT-06 · My Scans & Labs Page
**Route:** `/patient/scans`  
**Access:** PATIENT

#### Purpose
Patient views imaging scans and lab results, and can upload their own scans.

#### Layout
Three sections in a single card or three separate cards.

**Section 1 — Upload a Scan**
| Field | Type | Notes |
|-------|------|-------|
| Category | Dropdown | XRAY, MRI, CT, ULTRASOUND, DICOM, OTHER |
| File | File input | Accept: .jpg, .jpeg, .png, .pdf, .dcm, .dicom |
- "Upload" button — disabled until file selected; loading spinner during upload
- Success: toast + scan appears in list below

**Section 2 — My Scans**
- List of scans (uploaded by patient or by doctor during visits)
- Each row:
  - **Category** (bold, e.g., "XRAY")
  - Filename
  - Date + uploaded by
  - "Download" button

**Section 3 — My Lab Results**
- Simple result entries from lab orders
- Each row:
  - Test name (bold)
  - Result value + unit
  - "ABNORMAL" badge (orange/red) if flagged

#### States
- **Empty scans** → "No imaging scans uploaded yet."
- **Empty labs** → "No lab results available yet."

---

### PT-07 · Patient Lab Results Page
**Route:** `/patient/lab-results`  
**Access:** PATIENT

#### Purpose
Patient sees the detailed results of all lab orders placed for them.

#### Layout
Expandable accordion list.

**Each Lab Order (Collapsed)**
- Order number (e.g., "LAB-2024-001")
- Date ordered
- Status badge
- Expand arrow (click to expand)

**Each Lab Order (Expanded)**
- **Lab Status Timeline** (visual progress indicator):
  - Steps: Ordered → Sample Collected → Processing → Completed
  - Current step highlighted; completed steps filled/checked
- **Results Table** (if COMPLETED):
  | Column | Notes |
  |--------|-------|
  | Test Name | |
  | Result Value | Bold if abnormal |
  | Unit | e.g., "mg/dL" |
  | Reference Range | e.g., "70-100" |
  | Result Date | |
  | Status | CRITICAL (red) / ABNORMAL (orange) badge |
  - Critical result rows: red background
  - Abnormal result rows: orange/amber background
- **Pending** (if not COMPLETED): "Results pending — [status label]"

#### States
- **Loading** → spinner
- **Empty** → "No lab orders found."
- **Expanded but no results yet** → show status timeline + pending message

---

### PT-08 · Patient Timeline Page
**Route:** `/patient/timeline`  
**Access:** PATIENT

#### Purpose
Visual chronological medical history — all events in one view.

#### Layout
- H1: "My Medical Timeline"
- Full-width `PatientTimeline` component

**Timeline Component (vertical feed)**
- Events newest-first (or oldest-first with a toggle)
- Each event has:
  - **Type icon** (different icon per event type)
  - **Date + time**
  - **Title** (e.g., "Encounter with Dr. Smith", "Lab Order Completed", "Prescription Issued")
  - **Brief summary** (1–2 lines)
  - **Link** to detail page if applicable
- Event types (color-coded):
  - 🩺 Encounter (purple)
  - 💊 Prescription (blue)
  - 🧪 Lab Order (orange)
  - 🩻 Scan (gray)
  - 📋 Medical Record (teal)
  - 📝 Clinical Note (yellow)
  - 📤 Referral (indigo)

#### Design Notes
- Consider a filter bar to show/hide event types
- Timeline connector line on left (or center on wide screens)
- Empty state: "Your medical timeline is empty."

---

### PT-09 · Patient Vital Signs Tab
**Route:** `/patient/vitals`  
**Access:** PATIENT

#### Purpose
Patient views their historical vital signs (read-only).

#### Layout
Two sections.

**Vital Signs Trend Chart** *(shown only if 2+ data points)*
- Multi-line chart over time
- Lines for: BP Systolic, BP Diastolic, Heart Rate, Temperature, O2 Saturation, Weight
- X-axis: date/time; Y-axis: value
- Legend for each line

**Vital Signs History Table**
- Read-only table, newest first
| Column | |
|--------|--|
| Date/Time | |
| BP | "120/80 mmHg" |
| Heart Rate | "72 bpm" |
| Temperature | "36.8°C" |
| O2 Saturation | "98%" |
| Weight | "75 kg" |
| Height | "175 cm" |

---

### PT-10 · My Invoices Page
**Route:** `/patient/invoices`  
**Access:** PATIENT

#### Purpose
Patient views invoices for their appointments.

#### Layout
- H1: "My Invoices"
- Paginated list of invoice cards (20 per page)
- Pagination controls at bottom

**Each Invoice Card**
- Invoice number (bold H3, e.g., "INV-2024-001")
- Doctor name + date
- Total amount (formatted with currency)
- Remaining balance (shown only if not PAID)
- Status badge: ISSUED / PARTIALLY_PAID / PAID / VOID
- "View Invoice" button → opens InvoiceViewer modal

**InvoiceViewer Modal (when "View Invoice" clicked)**
- Shows full invoice details (see Modals section)
- "Download PDF" button — uses browser print dialog to save as PDF

#### States
- **Loading** → centered spinner
- **Empty** → "No invoices found."
- **Pagination** → prev/next buttons at bottom

#### Invoice Status Colors
| Status | Color |
|--------|-------|
| ISSUED | Blue (pending payment) |
| PARTIALLY_PAID | Orange (partially settled) |
| PAID | Green (fully paid) |
| VOID | Gray/muted |

---

### PT-11 · My Referrals Page
**Route:** `/patient/referrals`  
**Access:** PATIENT

#### Purpose
Patient views referrals issued to them by their doctor.

#### Layout
- H1: "My Referrals"
- List of referral cards

**Each Referral Card**
- **Header:**
  - Referral type: "Internal" or "External" + destination:
    - Internal: Specialty name + optional specific doctor name (e.g., "Cardiology · Dr. Hassan")
    - External: Facility name (e.g., "National Hospital")
  - Referring doctor + date (muted)
- **Reason text** (what the doctor wrote)
- **Status badge** (PENDING / ACCEPTED / COMPLETED / CANCELLED)

#### States
- **Loading** → spinner
- **Empty** → "No referrals have been issued for you yet."

#### Referral Status Colors
| Status | Color |
|--------|-------|
| PENDING | Amber/yellow |
| ACCEPTED | Blue |
| COMPLETED | Green |
| CANCELLED | Gray/muted |

---

## DOCTOR PAGES

---

### D-01 · Doctor Dashboard
**Route:** `/doctor`  
**Access:** DOCTOR

#### Purpose
Daily overview for the doctor. Labs + today's queue at a glance.

#### Layout
- Greeting: "Good morning, Dr. [Last Name]!"
- Lab KPI row
- Today's Queue card

**Lab KPI Row — 3 widgets side by side**
| Widget | Content | Visual Priority |
|--------|---------|----------------|
| Pending Orders | Count of lab orders awaiting action | Normal |
| Critical Results | Count of CRITICAL lab results | **Red accent — urgent** |
| Recent Labs | Summary of recently completed labs | Normal |

Each widget: large number, descriptive label, click navigates to `/doctor/lab-orders`.  
Critical Results widget: red background or red number + warning icon.

**Today's Queue Card**
- Title: "Today's Appointments"
- List sorted by scheduled time
- Each row:
  - Patient name
  - Scheduled time
  - Status badge
  - Action button (changes by status):
    - CONFIRMED → "Check In" button
    - CHECKED_IN → "Start Encounter" button
    - IN_PROGRESS → "Open Encounter" link button
    - COMPLETED → no button
- "View Full Queue" link → `/doctor/queue`

#### States
- **Loading** → skeleton rows in queue card
- **Empty today** → "No appointments scheduled for today"

---

### D-02 · Doctor Queue Page
**Route:** `/doctor/queue`  
**Access:** DOCTOR

#### Purpose
Live queue management. The doctor's primary daily working screen from the exam room. Updates in real-time via WebSocket (no polling needed).

#### Layout
Three-panel grid: Previous (small) | Current (large) | Next (small)

---

**Page Header**
- H1: "Live Queue"
- Waiting badge: "X waiting" — highlighted amber/red when > 0

---

**PREVIOUS PANEL** (left/top, smaller card)
- Card title: "PREVIOUS"
- If a previous patient exists:
  - Patient name (muted style — already done)
  - "Completed at [time]"
  - Appointment reason
- If none: dash "—"

---

**CURRENT PATIENT PANEL** (center, largest card — primary focus)
- Card title: "NOW WITH" or "CURRENT PATIENT"
- If patient present:
  - **H2: Patient name** (large, prominent)
  - Demographic chips (inline pills):
    - Gender
    - Age (calculated from date of birth)
    - Blood type
  - Appointment type badge: "EMERGENCY" (red) or "WALK-IN" (orange) — only if applicable
  - Phone number (click-to-call `tel:` link if possible)
  - "Started at [time]"
  - **Appointment reason** (label + value)
  - **⚠ ALLERGY ALERT BANNER** — shown prominently in red if allergies exist:
    - "⚠ Allergies: [allergy summary text]"
    - This must be visually unmissable. Red border + background.
  - Chronic conditions (label + text)
  - Current medications (label + text)
  - Divider
  - **Action links/buttons:**
    - "🩻 Open Encounter" → `/doctor/encounters/:appointmentId` (shown for IN_PROGRESS)
    - "Open Patient Record" → `/doctor/patients?patient=:id`
  - **Primary action buttons:**
    - "Complete Visit" (primary green) — triggers `appointmentsApi.complete()`; on success shows **InvoiceGeneratedModal**
    - "Mark No-Show" (danger/red) — requires confirmation dialog

- If no current patient:
  - Centered placeholder: "Queue is clear. Click 'Call Next' to bring in the next patient."

---

**NEXT PATIENT PANEL** (right/bottom, smaller card)
- Card title: "UP NEXT"
- If next patient queued:
  - Patient name (bold)
  - Scheduled time
  - Appointment reason (brief)
  - Appointment type badge if applicable
  - **"Call Next" button** (primary) — starts the appointment (CHECKED_IN → IN_PROGRESS)
- If none: "No more patients in queue"

---

**Queue Footer**
- "X patients waiting" (live count)
- "Auto-updating in real-time" or WebSocket indicator

---

**POST-COMPLETION: InvoiceGeneratedModal** *(appears after "Complete Visit")*
- Pops up when visit is marked complete and billing system generated an invoice
- If free follow-up was used (no charge): different "Free Follow-up Applied" message
- Otherwise: "Invoice [INV-XXX] generated — [Total Amount]"
- Buttons: "Close", "View Invoice", "Print Receipt"
- "Print Receipt" triggers browser print dialog on the invoice

---

**FALLBACK PANEL** *(when in-progress appointment exists outside today's queue)*
- Shown as an accent-bordered card if the queue endpoint returns no current patient but there's an IN_PROGRESS appointment
- Shows patient name + "Open Encounter" button
- Ensures doctor never misses an active encounter

#### Design Notes
- This page is the doctor's primary screen during patient hours. The current patient card should dominate the visual hierarchy.
- The allergy banner must be impossible to miss — use high-contrast red.
- Queue updates via WebSocket mean the UI updates instantly when secretary changes status.

---

### D-03 · Doctor Appointments Page
**Route:** `/doctor/appointments`  
**Access:** DOCTOR

#### Purpose
All appointments (not just today) with filtering and status transitions.

#### Layout
- Status filter tabs
- Appointment list

**Status Filter Tabs**
- All | PENDING | CONFIRMED | CHECKED_IN | IN_PROGRESS | COMPLETED | CANCELLED
- Selected tab highlighted; each tab could show a count badge

**Appointment List**
Each appointment card:
- Patient name (bold H3)
- Date + time (formatted)
- Appointment type badge (EMERGENCY/WALK_IN) if applicable
- Status badge
- Action buttons based on status:
  - CONFIRMED → "Check In" button
  - CHECKED_IN → "Start Encounter" button
  - IN_PROGRESS → "Open Encounter" link
  - COMPLETED → "Create Follow-Up" button (expands inline form)

**Create Follow-Up Inline Form** (expands when "Create Follow-Up" clicked):
- Date picker: "Recommended follow-up date"
- Textarea: "Follow-up notes"
- "Create Follow-Up" button + "Cancel" button
- Smooth expand/collapse animation

#### States
- **Loading** → skeleton rows
- **Empty filtered view** → "No [STATUS] appointments found"

---

### D-04 · Encounter Page
**Route:** `/doctor/encounters/:appointmentId`  
**Access:** DOCTOR (only the assigned doctor can edit; others see read-only)

#### Purpose
The primary clinical documentation workspace. Doctor fills the SOAP note structure during or after seeing a patient. The most feature-rich page in the system.

#### Layout
**Two-column layout:** Main content (wide, ~65%) | Sidebar (narrow, ~35%)

**Page Header**
- Breadcrumb trail
- H1: "Encounter — [Patient Name]"
- Status badge: DRAFT (editable) or SUBMITTED (read-only)

**Lock Notice** *(shown when read-only)*
- Card with message: "This encounter is locked and cannot be edited."
- If the doctor is the owner: "Amend" button → creates a new DRAFT copy for editing

---

**MAIN COLUMN — 4 Cards (top to bottom)**

**Card 1 — Chief Complaint**
- Async searchable combobox: "Chief Complaint" (searches bilingual complaint database)
  - Shows localized name (Arabic when in AR mode, English otherwise)
  - When a complaint is selected, the AR field auto-populates from the master row
- Read-only text field (RTL): "Chief Complaint in Arabic"
  - Auto-filled when a catalog complaint is selected; read-only (not manually editable)
  - Note for designer: this field is intentionally read-only — it mirrors the catalog entry

**Card 2 — Symptoms & Vitals**
- Multi-select searchable dropdown: "Symptoms" (options from complaint catalog)
  - Hint: "Select all symptoms the patient reported"
- **Divider:** "Capture Vital Signs"
- **If vitals already linked:**
  - "✓ Vitals linked — BP 120/80, HR 72" (one-line summary with checkmark)
  - No form shown
- **If no vitals + encounter is editable:**
  - Vitals entry form inline (see VitalSignsForm component specs)
- **If read-only:** "—" dash

**Card 3 — Examination Findings**
- Textarea (LTR, English): "Examination Findings"
- Textarea (RTL, Arabic): "Examination Findings (Arabic)"

**Card 4 — Diagnosis & Treatment Plan**
- Async searchable combobox: "Diagnosis"
  - Searches ICD-10 database
  - Each option shows: `Diagnosis Name (ICD-10 code)` — e.g., "Type 2 Diabetes (E11)"
  - Helps doctor confirm the correct coded diagnosis
- Textarea: "Diagnosis Notes / Observations"
- Textarea (LTR, English): "Treatment Plan"
- Textarea (RTL, Arabic): "Treatment Plan (Arabic)"

**Submit Row** *(below cards, visible only when editable)*
- Small muted text: "Changes are auto-saved as you type"
- Primary "Submit Encounter" button → confirmation dialog → submits + returns to queue

---

**SIDEBAR — Orders & References**

**4 Action Buttons:**
- "Add Prescription" → PrescriptionModal
- "Order Lab" → LabOrderModal
- "Add Procedure" → ProcedureModal
- "Refer Patient" → CreateReferralModal *(available even after submission for the owner)*

All buttons disabled in read-only mode, EXCEPT "Refer Patient" which is available to the owner regardless.

**Linked Prescriptions Section**
- Subheading: "Linked Prescriptions"
- If none: "None linked yet"
- Each prescription:
  - Drug names (comma-separated): e.g., "Amoxicillin, Ibuprofen"
  - VOIDED badge if cancelled + reason shown below
  - 🚫 Void button (only in editable mode on ACTIVE prescriptions)
    - Click expands inline void form: reason textarea (min 5 chars) + "Void" (danger) + "Cancel"

**Linked Lab Orders Section**
- Subheading: "Linked Lab Orders"
- Each: "LAB-2024-001 · ORDERED"

**Linked Procedures Section**
- Subheading: "Linked Procedures"
- Each: clickable button showing "[Procedure Name] · [STATUS]"
  - Click opens ProcedureDetailModal

---

**MODALS FROM ENCOUNTER PAGE:**

**Prescription Modal**
- Wide modal
- Title: "Add Prescription"
- Medication rows (1 to N):
  - Drug name (searchable or free-text)
  - Dosage strength (e.g., "500mg")
  - Dosage form (Tablet/Capsule/Syrup/Injection/Cream/Inhaler/Other)
  - Dosage pattern (e.g., "1-0-1")
  - Frequency (e.g., "Twice daily")
  - Duration (e.g., "7 days")
  - Instructions (e.g., "Take after food")
  - Remove button (🗑) — only if > 1 row
- "Add Medication" button
- Textarea: "Additional notes/instructions"
- Footer: Cancel + Save (loading)
- **Before save: Drug Interaction Check runs automatically**

**Lab Order Modal**
- Title: "Order Lab Tests"
- Priority dropdown: ROUTINE / URGENT / STAT
- Test rows (1 to N):
  - Test name (required)
  - Test code (optional)
  - Remove button
- "Add Test" button
- Footer: Cancel + Save
- Note: Creating from encounter **automatically submits** the order (one-step)

**Procedure Modal**
- Title: "Schedule Procedure"
- Template dropdown:
  - Options: list of active procedure templates (localized name)
  - Last option: "Custom (enter name manually)"
- If "Custom" selected:
  - Text input: "Procedure Name (English)"
  - Text input (RTL): "Procedure Name (Arabic)"
- Textarea: "Pre-procedure notes/instructions" (optional)
- Footer: Cancel + Save

**Create Referral Modal**
- Title: "Refer Patient"
- Referral type dropdown: INTERNAL / EXTERNAL
- **If INTERNAL:**
  - Specialty dropdown (searchable, bilingual labels)
  - Target doctor dropdown (enabled only after specialty selected; shows doctors in that specialty)
    - Hint: "Optional — leave blank to refer to the specialty in general"
- **If EXTERNAL:**
  - Text input: "Facility Name" (required)
- Reason textarea: "Reason for Referral" (required)
- Reason textarea (RTL): "Reason (Arabic)" (optional)
- Notes textarea: "Additional Clinical Notes" (optional)
- Notes textarea (RTL): "Notes (Arabic)" (optional)
- Footer: Cancel + Submit (loading)

---

#### Encounter Page Behavioral Notes
- **Auto-save**: Any form change triggers a 600ms debounced save. Show "Saving..." indicator, then "Saved ✓" briefly.
- **Amend**: SUBMITTED encounters can be amended → creates new DRAFT. The history of versions is preserved.
- **Read-only mode**: When `!isDraft || !isOwner` — all inputs disabled, sidebar buttons disabled (except "Refer Patient" for owner).
- **Chief complaint AR**: Auto-filled from catalog master row when EN complaint is selected. Not manually editable — it's derived.

---

### D-05 · Patient Record Page
**Route:** `/doctor/patients`  
**Access:** DOCTOR

#### Purpose
Doctor's comprehensive view of any of their patients' complete medical record, outside of an active encounter.

#### Layout
- Patient selector card at top
- All sections visible only after patient is selected
- 8 stacked section cards

**Patient Selector**
- Searchable dropdown: "Select a Patient"
- Shows patient name (or email as fallback)
- Only the doctor's own patients are shown

---

*(Once patient selected, 8 sections appear:)*

**Section 1 — AI Scribe Panel**
- Collapsible panel
- AI-assisted clinical documentation
- Takes voice/text input → generates structured clinical draft
- Design as a collapsible card with a microphone icon and "AI Scribe" label

**Section 2 — Vital Signs**
- Trend chart (line chart, only if 2+ data points):
  - Multiple lines: BP Systolic, BP Diastolic, Heart Rate, Temperature, O2, Weight
- "Record New Vitals" toggle:
  - Collapsible VitalSignsForm
  - "Record Vitals" button re-shows the form after saving
- Vital signs history table (newest first)

**Section 3 — Medical Records**
- Existing records (read-only list):
  - Version badge, CURRENT badge on latest, date + doctor
  - Diagnosis + treatment plan text
- "Add Medical Record" inline form:
  - Chief complaint input
  - Diagnosis textarea
  - Treatment plan textarea
  - "Add Record" button

**Section 4 — Clinical Notes**
- Existing notes:
  - Specialty category, doctor name, date, note body
- "Add Note" inline form:
  - Specialty category dropdown (doctor's own specialties)
  - Note body textarea
  - "Add Note" button (disabled if category or body empty)

**Section 5 — Prescriptions**
- Existing prescriptions list:
  - Date issued, drug names, ACTIVE/VOIDED status
  - For ACTIVE (own prescriptions): "Open PDF" + ✏️ Reissue + 🚫 Void buttons
  - Void: inline reason form
  - Reissue: confirmation dialog → copies items + notes to new prescription form, scrolls to it
- "New Prescription" inline form:
  - Medication rows (same as encounter modal)
  - Notes textarea
  - "Issue Prescription" button (with interaction check)

**Section 6 — Clinical Procedures**
- List of all procedures for this patient
- Each procedure row (clickable):
  - Procedure name (localized)
  - Doctor name + date
  - Status badge
  - Click opens ProcedureDetailModal

**Section 7 — Scans / Labs**
- Existing scans:
  - Category, filename, date, uploader
  - "Download" button
  - "🗑 Delete" button (with confirmation dialog)
- Lab results list:
  - Test name, result value, unit
- "Upload Scan" inline form:
  - Category dropdown
  - File input (jpg, png, pdf, dcm)
  - "Upload Scan" button

**Section 8 — Medical Timeline**
- Same PatientTimeline component as patient's own view
- Shows full chronological history

---

### D-06 · Schedule Management Page
**Route:** `/doctor/schedule`  
**Access:** DOCTOR

#### Purpose
Doctor sets their weekly availability (which days + hours + slot duration).

#### Layout
- Create form at top
- Current schedules list below

**Create Schedule Form**
| Field | Type | Validation |
|-------|------|-----------|
| Day of Week | Dropdown | Monday–Sunday (0=Sunday, 6=Saturday) |
| Start Time | Time input | e.g., "09:00" |
| End Time | Time input | e.g., "17:00", must be > start |
| Slot Duration (min) | Number input | Minimum 5 minutes |
- "Add Schedule" button

**Current Schedule List**
- One entry per schedule:
  - Day name (e.g., "Monday")
  - Time range (e.g., "09:00 – 17:00")
  - Slot duration (e.g., "30-minute slots")
  - "Remove" button (red/danger, with confirmation)

#### States
- **Empty** → "No schedule configured yet. Add a day to start accepting appointments."
- **Loading** → skeleton rows

---

### D-07 · Doctor Reviews Page
**Route:** `/doctor/reviews`  
**Access:** DOCTOR

#### Purpose
Doctor reads patient feedback about their practice.

#### Layout
- Summary card
- Review list

**Summary Card**
- Average rating: large star display (e.g., "★ 4.7")
- Total reviews: "(42 reviews)"
- Optional: star distribution bar chart (5★: 30, 4★: 8, 3★: 3, 2★: 1, 1★: 0)

**Review List**
Each review card:
- Star rating (5 visual stars)
- Comment text (or "No comment" in muted style)
- Date
- "HIDDEN" badge if hidden by manager (muted/strikethrough)

#### States
- **Loading** → skeleton cards
- **Empty** → "No patient reviews yet."

---

### D-08 · Lab Orders List Page
**Route:** `/doctor/lab-orders`  
**Access:** DOCTOR

#### Purpose
Overview of all lab orders placed by this doctor.

#### Layout
- KPI widgets row
- Status filter
- Orders table with pagination

**KPI Widgets (same as dashboard)**
- Pending Orders (count)
- Critical Results (count, red accent)

**Status Filter**
- Dropdown or tabs: All | DRAFT | ORDERED | SAMPLE_COLLECTED | PROCESSING | COMPLETED

**Orders Table**
| Column | Notes |
|--------|-------|
| Order # | Link to `/doctor/lab-orders/:id` |
| Patient Name | |
| Status | Status badge |
| Priority | ROUTINE/URGENT/STAT badge |
| Date | Formatted |
| Actions | "View Details" link |

- 20 items per page
- Pagination: prev/next buttons + "Page X of Y"

#### States
- **Loading** → skeleton table rows
- **Empty** → "No lab orders found for this filter."

---

### D-09 · Create Lab Order Page
**Route:** `/doctor/lab-orders/new`  
**Access:** DOCTOR

#### Purpose
Doctor creates a standalone lab order (not from an encounter).

#### Layout
Single-column form.

**Form Fields**
| Field | Type | Notes |
|-------|------|-------|
| Patient | Searchable dropdown | From doctor's patient list |
| Priority | Dropdown | ROUTINE / URGENT / STAT |
| Clinical Notes | Textarea | Context for lab technician |

**Lab Tests Section**
- Dynamic list of test rows:
  - Test Name (text, required)
  - Test Code (text, optional, e.g., "CBC", "HbA1c")
  - Notes (text, optional per test)
  - Remove row button (🗑) — only if > 1 row
- "Add Test" button

**Two Submit Buttons**
- "Save as Draft" — saves without submitting (status: DRAFT)
- "Submit Order" — creates and immediately submits (status: ORDERED)

#### States
- **Loading** → button spinner
- **Success** → success toast + redirect to `/doctor/lab-orders`

---

### D-10 · Lab Order Details Page
**Route:** `/doctor/lab-orders/:id` (and `/secretary/lab/:id`)  
**Access:** DOCTOR, SECRETARY, MANAGER

#### Purpose
Full details of a single lab order + result entry workflow.

#### Layout
- Status timeline at top
- Two columns: order info + tests + results

**Lab Status Timeline**
- Visual step indicator (5 steps):
  - DRAFT → ORDERED → SAMPLE_COLLECTED → PROCESSING → COMPLETED
  - Current step highlighted; completed steps show checkmark

**Order Info Grid**
| Field | Value |
|-------|-------|
| Patient | Name |
| Ordering Doctor | Name |
| Priority | Badge |
| Date Ordered | Formatted |
| Clinical Notes | Text (or —) |

**Critical Alert** *(if any result is critical)*
- Prominent red banner: "⚠ Critical Results — Requires Doctor Review"

**Tests & Results Table** *(if COMPLETED)*
| Test Name | Result | Unit | Ref Range | Date | Abnormal/Critical |
|-----------|--------|------|-----------|------|-------------------|
- Critical rows: red background
- Abnormal rows: orange background
- "Download Result File" button per test (if file attached)

**Result Entry Form** *(PROCESSING status, SECRETARY/MANAGER only)*
- For each test:
  - Result value input
  - Unit input
  - Reference range input
  - Result date picker
  - File upload (for DICOM/PDF result documents)
  - "Abnormal" checkbox
  - "Critical" checkbox
- "Add Test Row" button
- "Submit Results" button

**Action Buttons** *(bottom, role + status dependent)*
| Button | Shown When | Who Can |
|--------|-----------|---------|
| Submit Order | DRAFT | Doctor, Manager |
| Collect Sample | ORDERED | Secretary, Manager |
| Start Processing | SAMPLE_COLLECTED | Secretary, Manager |
| Review & Close | COMPLETED | Doctor, Manager |
| Delete Order | DRAFT | Doctor, Manager |

---

### D-11 · Doctor Referrals Page
**Route:** `/doctor/referrals`  
**Access:** DOCTOR

#### Purpose
Doctor manages referrals they've sent to others AND referrals sent to them.

#### Layout
- H1: "Referrals"
- Tab bar: "Received" | "Sent"
- Referral list (filtered by tab)

**Tab: Received** (referrals sent TO this doctor from other doctors)
Each referral card:
- H3: Patient name · Referral type · Destination (specialty/facility)
- Referring doctor + date (muted)
- Reason text
- Status badge
- Action buttons (based on status):
  - PENDING: "Accept" button (primary)
  - ACCEPTED (and this doctor accepted it): "Mark Completed" button (primary)

**Tab: Sent** (referrals this doctor created)
Each referral card:
- Same header structure
- Status badge
- Action buttons:
  - PENDING or ACCEPTED: "Cancel Referral" button (danger)

#### Referral Destination Display
- INTERNAL: "[Specialty Name] · [Target Doctor Name]" (or just "[Specialty Name]" if no specific doctor)
- EXTERNAL: "[Facility Name]"

#### States
- **Loading** → spinner
- **Empty tab** → "No [received/sent] referrals found."

---

## SECRETARY PAGES

---

### S-01 · Secretary Dashboard
**Route:** `/secretary`  
**Access:** SECRETARY, MANAGER

#### Purpose
Secretary's home screen — quick access to daily tasks.

#### Layout
- Greeting: "Good morning, [Name]!"
- Lab KPI row (same widgets as doctor dashboard)
- Quick Actions card

**Quick Actions Card**
Large link buttons (icon + label + arrow):
- 📅 "Appointment Desk" → `/secretary/desk`
- 🧪 "Lab Samples" → `/secretary/lab`
- 💳 "Billing Desk" → `/secretary/billing`
- 🏥 "Manage Doctors" → `/secretary/doctors`

---

### S-02 · Appointment Desk Page
**Route:** `/secretary/desk`  
**Access:** SECRETARY, MANAGER

#### Purpose
Secretary confirms or cancels pending appointments.

#### Layout
- Status filter tabs
- Appointment list

**Status Filter**
- Tabs: All | PENDING | CONFIRMED | CHECKED_IN | IN_PROGRESS | COMPLETED | CANCELLED

**Appointment List**
Each card:
- Patient name (bold)
- Doctor name
- Date + time
- Status badge
- **"Confirm" button** (PENDING only) — confirms appointment
- **"Cancel" button** (PENDING or CONFIRMED only) — cancels appointment

---

### S-03 · Queue Board Page
**Route:** `/secretary/queue`  
**Access:** SECRETARY, MANAGER

#### Purpose
The front desk's queue management screen. Add walk-ins and manage queue flow for a selected doctor.

#### Layout
- Doctor selector at top (full width)
- Two panels below: **Walk-In Panel** (left) + **Queue Panel** (right)

**Doctor Selector**
- Dropdown: "Select a Doctor"
- Nothing shown until a doctor is selected

---

**LEFT PANEL — Add Walk-In**
*(Visible only after doctor selected)*

**Patient Search**
- Search input: "Search by name or phone"
- Results dropdown: patient name + phone below input
- Selecting a patient populates the "selected patient" state

**After Patient Selected**
- Patient name shown with "Edit Profile" button → PatientProfileEditorModal

**Walk-In Controls**
- "Emergency" checkbox: marks the walk-in as EMERGENCY priority
- "Add Walk-In" button (primary) — adds patient to queue
- "Register New Patient" button (secondary) → RegisterPatientModal

---

**RIGHT PANEL — Current Queue**
- Title: "Queue for Dr. [Name]"
- Shows: CONFIRMED, CHECKED_IN, IN_PROGRESS statuses
- Sorted: EMERGENCY first, then WALK_IN, then by scheduled time
- Auto-refreshes every 20 seconds

Each queue row:
- Patient name
- Appointment type badge (EMERGENCY/WALK_IN) if applicable
- Status badge
- "Mark Emergency" button (if not already emergency)
- Action button (by status):
  - CONFIRMED → "Check In"
  - CHECKED_IN → "Start"
  - IN_PROGRESS → "Complete"

---

### S-04 · Doctors Page
**Route:** `/secretary/doctors`  
**Access:** SECRETARY, MANAGER

#### Purpose
Secretary manages doctor profile details visible on the public site.

#### Layout
List of doctor cards.

**Each Doctor Card**
- Header: Doctor name + specialty tags (read-only)
- Editable fields:
  | Field | Input | Notes |
  |-------|-------|-------|
  | Room Number | Text input | e.g., "Room 204" |
  | Bio | Textarea | Shown on public profile |
  | Accepting Patients | Checkbox | Controls visibility in public booking |
- "Save" button per card (loading state during save)

---

### S-05 · Patient Directory Page
**Route:** `/secretary/patients`  
**Access:** SECRETARY, MANAGER

#### Purpose
Secretary searches and edits patient records.

#### Layout
- Search bar
- "Register New Patient" button (top-right)
- Patients table

**Search Bar**
- "Search by name, phone, or email"
- On type or enter: filters list

**Patients Table**
| Column | Mobile |
|--------|--------|
| Full Name | ✓ |
| Phone | ✓ |
| Email | Hidden on mobile |
| Date of Birth | Hidden on mobile |
| Actions: "Edit Profile" button | ✓ |

- "Edit Profile" → PatientProfileEditorModal

---

### S-06 · Sample Collection Page
**Route:** `/secretary/lab`  
**Access:** SECRETARY, MANAGER

#### Purpose
Lab sample workflow — secretary advances orders through collection and processing pipeline.

#### Layout
Three tabs with count badges.

**Tab 1 — "Ordered" (Awaiting Sample Collection)**
- Badge: count of orders
- Each row:
  - Order number (link to `/secretary/lab/:id`)
  - Patient name
  - Date
  - Priority badge (URGENT or STAT only)
  - **"Collect Sample" button** → changes status to SAMPLE_COLLECTED

**Tab 2 — "Sample Collected" (Awaiting Processing Start)**
- Same columns
- **"Start Processing" button** → changes status to PROCESSING

**Tab 3 — "Processing" (Awaiting Result Entry)**
- Same columns
- **"Enter Results" link** → `/secretary/lab/:id` (detail page with result form)

#### States
- **Loading** → all three tabs load simultaneously (parallel queries)
- **Empty tab** → "No orders in this stage"

---

### S-07 · Billing Desk Page
**Route:** `/secretary/billing`  
**Access:** SECRETARY, MANAGER

#### Purpose
Secretary views all invoices and records payments.

#### Layout
- H1: "Billing"
- 3 tabs: All | Outstanding | Paid
- Paginated invoice list (20 per page)

**Tab Definitions**
- **Outstanding** (default): ISSUED + PARTIALLY_PAID statuses
- **Paid**: PAID status
- **All**: Every invoice

**Each Invoice Row/Card**
- Invoice number + patient name (bold H3)
- Doctor name + date (muted)
- Total amount
- Balance (outstanding amount)
- Status badge
- "View Invoice" button → opens InvoiceViewer modal
- **"Record Payment" button** — shown only for ISSUED or PARTIALLY_PAID
  - Opens PaymentFormModal

**InvoiceViewer Modal**
- Full invoice display (see Modals section)
- "Close" button + "Print Receipt" button

**PaymentFormModal**
- Invoice number + patient name at top
- Outstanding balance shown prominently
- Form fields:
  - Amount (number, defaults to outstanding balance)
  - Payment method (CASH / CARD / BANK_TRANSFER)
  - Reference (text, optional, e.g., card last 4 digits or bank reference)
- "Record Payment" button (loading)
- On full payment: invoice becomes PAID, success toast

**Pagination**
- "‹ Previous" | "Page X of Y" | "Next ›" buttons at bottom

---

### S-08 · Referrals Page (Secretary View)
**Route:** `/secretary/referrals`  
**Access:** SECRETARY, MANAGER

#### Purpose
Read-only view of all clinic referrals for front-desk scheduling coordination.

#### Layout
- H1: "Referrals"
- List of all referral cards

**Each Referral Card** (read-only, no actions)
- Patient name · Referral type · Destination (specialty or facility)
- Referring doctor + date (muted)
- Status badge

Note: Clinical reason/notes text is NOT shown to secretary role (API does not send it).

#### States
- **Loading** → spinner
- **Empty** → "No referrals found."

---

### S-09 · Doctor Absence Page
**Route:** `/secretary/absences`  
**Access:** SECRETARY, MANAGER

#### Purpose
Record and view doctor absences to block scheduling.

#### Layout
Two sections.

**Create Absence Form**
| Field | Type | Options |
|-------|------|---------|
| Doctor | Dropdown | All doctors list |
| Start Date | Date picker | |
| End Date | Date picker | Must be ≥ start date |
| Absence Type | Dropdown | VACATION, SICK, CONFERENCE, BLOCKED_DATE, OTHER |
| Reason | Textarea | Optional description |
- "Create Absence" button → **confirmation dialog** before creating

**Absences List**
- Each entry:
  - Doctor name
  - Absence type (with appropriate icon/badge)
  - Date range (e.g., "Jun 20 – Jun 25, 2025")
  - Reason text (if provided)

#### States
- **Success** → confirmation toast, list refreshes
- **Empty list** → "No absences recorded"

---

### S-10 · Lab Order Details (Secretary View)
Same as D-10, but:
- Accessible at `/secretary/lab/:id`
- Secretary sees the result entry form when status = PROCESSING
- Secretary can advance status: Collect Sample, Start Processing, Enter Results

---

## MANAGER PAGES

---

### M-01 · Manager Dashboard
**Route:** `/manager`  
**Access:** MANAGER

#### Purpose
High-level clinic KPI overview for the current month.

#### Layout
- Greeting: "Good morning, [Name]!"
- KPI cards row (5 cards)
- Quick links row

**KPI Cards (5 cards in a row)**
| Card | Icon Suggestion | Color Accent |
|------|----------------|--------------|
| Total Appointments | Calendar | Blue |
| Completed Visits | Checkmark | Green |
| No-Shows | X mark | Orange |
| Avg. Wait Time (min) | Clock | Purple |
| New Patients | Person+ | Teal |

**Quick Links**
- "📊 View Full Reports" → `/manager/reports`
- "💳 Billing Reports" → `/manager/billing`
- "⭐ Moderate Reviews" → `/manager/reviews`
- "📋 Audit Log" → `/manager/audit`

#### States
- **Loading** → skeleton KPI cards

---

### M-02 · User Management Page
**Route:** `/manager/users`  
**Access:** MANAGER

#### Purpose
Full user lifecycle management — create, edit, reset passwords, deactivate/reactivate.

#### Layout
- Page heading + "Add New" button
- Role tabs
- Search bar
- Temp password display (conditional)
- Users table

**Page Heading Row**
- H1: "User Management"
- Sub-text: brief description
- "Add New" button (top-right, behavior depends on active tab)

**Role Tabs**
- Doctors | Secretaries | Patients

**"Add New" Button Actions**
| Tab | Action |
|-----|--------|
| Doctors | Navigate to `/manager/doctors/new` |
| Secretaries | Open CreateSecretaryModal |
| Patients | Open RegisterPatientModal |

**Search Bar**
- "Search by name or email"
- Real-time filtering

**Temporary Password Box** *(shown after password reset)*
- Yellow/amber highlighted box
- "Temporary password for [name]:"
- Password displayed in monospace/code style
- "Copy Password" button (copies to clipboard)
- Dismissible

**Users Table**
| Column | Hidden on Mobile |
|--------|-----------------|
| Full Name | No |
| Email | No |
| Phone | No |
| Status Badge (Active/Inactive) | No |
| Date Joined | Yes |
| Actions (3 buttons) | No |

**Per-User Actions**
- "Edit" → UserEditModal
- "Reset Password" → confirmation dialog → shows temp password in the box above
- "Deactivate" (shown if active, danger style) or "Reactivate" (shown if inactive, secondary)

**Inactive Row Styling**
- Inactive users shown with reduced opacity or muted text

---

### M-03 · Create Doctor Page
**Route:** `/manager/doctors/new`  
**Access:** MANAGER

#### Purpose
Manager creates a new doctor account.

#### Layout
**Form State:** Single-column form  
**Success State:** Post-creation confirmation screen

**Form Fields**
| Field | Input | Notes |
|-------|-------|-------|
| First Name | Text | Required |
| Last Name | Text | Required |
| Email | Email | Required |
| Phone | Tel | Required |
| License Number | Text | Required |
| Room Number | Text | Optional |
| Specialties | Multi-select searchable | From specialties API |
| Bio | Textarea | For public profile |
| Photo | File input | Image (jpg/png) |
| Password | Password | Optional — system generates if empty |
- "Create Doctor" button

**Success Screen** *(replaces form after creation)*
- "✓ Doctor account created!" headline
- Doctor name
- Temporary password in highlighted box (if system-generated)
  - "Copy Password" button
- Two action buttons:
  - "Back to User Management" → `/manager/users`
  - "Create Another Doctor" → resets to empty form

---

### M-04 · Reports Dashboard Page
**Route:** `/manager/reports`  
**Access:** MANAGER

#### Purpose
Appointment analytics and performance reports.

#### Layout
- Filter bar (period + export buttons)
- 5 data cards

**Filter Bar**
- Period dropdown: This Week | This Month | All Time
- Export PDF button
- Export CSV button

**Card 1 — Overall KPIs (6 tiles)**
| KPI | Description |
|-----|-------------|
| Total Appointments | All appointments in period |
| Completed | Successfully completed visits |
| No-Shows | Patients who didn't show up |
| Cancelled | Cancelled appointments |
| Avg. Wait Time | Average wait in minutes |
| New Patients | First-time patients in period |

**Card 2 — Per-Doctor Performance Table**
| Column | Notes |
|--------|-------|
| Doctor Name | |
| Total Appointments | |
| Visual Bar | Proportional bar relative to highest-volume doctor |
| No-Show Rate | Percentage |

**Card 3 — Ratings Table**
- "Most reviewed doctor: Dr. [Name]" note
| Doctor | Avg Rating | Review Count |
|--------|-----------|--------------|
- Consider star display for avg rating

**Card 4 — Attendance Table**
| Doctor | Days Absent |
|--------|------------|
- Shows doctors who had absences in the period

**Card 5 — Top Diagnoses** *(NEW in current version)*
| Diagnosis | ICD-10 Code | Count | Bar |
|-----------|-------------|-------|-----|
- Arabic diagnosis name shown when in AR mode
- Bar proportional to the most-common diagnosis
- Empty: "No diagnosis data for this period."

#### States
- **Loading** → centered spinner
- **No data** → each card shows its empty state

---

### M-05 · Billing Reports Page
**Route:** `/manager/billing`  
**Access:** MANAGER

#### Purpose
Revenue summary and per-doctor billing breakdown.

#### Layout
- Period selector (Day / Month / Year)
- KPI card
- Revenue by doctor table

**Period Selector**
- Dropdown: Today | This Month | This Year

**KPIs Card (3 tiles)**
| KPI | Notes |
|-----|-------|
| Total Billed | Sum of all invoice totals |
| Total Collected | Sum of all payments received |
| Total Outstanding | Total billed − total collected |
- Currency from backend settings (configurable per clinic)

**Revenue by Doctor Table**
| Column | Notes |
|--------|-------|
| Doctor Name | |
| Total Billed | Formatted currency |
| Total Collected | Formatted currency |
| Visual Bar | Proportional to highest biller |

#### States
- **Loading** → centered spinner
- **No revenue data** → "No billing data for this period."

---

### M-06 · Review Moderation Page
**Route:** `/manager/reviews`  
**Access:** MANAGER

#### Purpose
Manager hides or restores patient reviews that are inappropriate.

#### Layout
- H1: "Review Moderation"
- List of all reviews

**Each Review Card**
- ⭐ Star rating (visual)
- Doctor name
- Patient name
- Date
- Comment text
- "HIDDEN" badge (if currently hidden from public)
- "Hide" button (shown if visible) or "Unhide" button (shown if hidden)

#### States
- **Loading** → skeleton cards
- **Empty** → "No reviews to moderate."

---

### M-07 · Audit Log Page
**Route:** `/manager/audit`  
**Access:** MANAGER

#### Purpose
Compliance and investigation tool showing all system actions.

#### Layout
- Filter bar
- Audit event list

**Filter Bar**
| Control | Type | Notes |
|---------|------|-------|
| Search | Text input | Actor email, model name, object |
| Action type | Dropdown | CREATE, UPDATE, DELETE, LOGIN, etc. |

**Audit Event Cards**
Each card:
- **Action** (large label): e.g., "UPDATED" + model name: "Prescription"
- **Timestamp**: date + time (formatted)
- **Actor**: "by [email address]"
- **Object**: "on [object description]"
- **Changes diff** (if UPDATE action):
  - Table-style: Field | Old Value | New Value
  - Each changed field as one row

#### Design Notes
- Dense information — prioritize readability
- Monospace font for old/new values in diffs
- Timestamps should be consistent format throughout
- Consider alternating row backgrounds for readability

---

## ACCOUNT SETTINGS

---

### A-01 · Notification Preferences Page
**Route:** `/account/notifications`  
**Access:** All authenticated roles

#### Purpose
User controls how they receive notifications.

#### Layout
Single settings card.

**Notification Channels**
- Section: "How to Notify Me"
- Toggle switches:
  - Email notifications (on/off)
  - SMS notifications (on/off)
  - In-app notifications (on/off)

**Reminder Settings**
- Section: "Appointment Reminders"
- "Remind me before appointments" dropdown: 1h, 2h, 6h, 12h, 24h before
- Or: number input + unit dropdown

**Save Button**
- "Save Preferences" primary button

---

## ALL MODALS & OVERLAYS

---

### MOD-01 · InvoiceViewer (Shared Component)
**Used in:** BillingDeskPage, MyInvoicesPage, InvoiceGeneratedModal

Printable invoice sheet displayed inside a wide modal.

**Layout:**

**Header**
- Left: Clinic name + "Invoice" subtitle
- Right: Invoice number (bold) + status badge

**Meta Grid (4 fields)**
| Field | Value |
|-------|-------|
| Patient | Patient name |
| Doctor | Doctor name or "—" |
| Invoice Date | Formatted |
| Due Date | Formatted or "—" |

**Line Items Table**
| Description | Quantity | Unit Price | Line Total |
|-------------|----------|-----------|------------|

**Totals Section (bottom-right aligned)**
- Subtotal
- Discount: − [amount]
- **Total** (bold, larger)
- Paid
- **Balance** (bold, larger — balance due)

**Payment History Table** *(shown only if payments exist)*
| Paid At | Method | Reference | Amount |
|---------|--------|-----------|--------|
- Payment methods: CASH, CARD, BANK_TRANSFER (translated)

**Notes** (if any): footer text below everything

**Modal Actions**
- "Close" (secondary)
- "Print Receipt" (primary) — triggers browser print dialog

---

### MOD-02 · PaymentFormModal
**Used in:** BillingDeskPage

Inline payment recording form in a standard modal.

**Header context**
- Invoice number + patient name
- "Outstanding balance: **[amount]**"

**Form Fields**
| Field | Input | Notes |
|-------|-------|-------|
| Amount | Number input (step 0.01, min 0.01) | Pre-filled with outstanding balance |
| Payment Method | Dropdown | CASH / CARD / BANK_TRANSFER |
| Reference | Text | Optional (card last 4, bank ref, etc.) |

**Actions:** "Cancel" + "Record Payment" (loading)

**Success behavior:**
- If invoice is now fully paid: "Invoice paid in full ✓" toast
- If partially paid: "Payment recorded" toast
- Modal closes, list refreshes

---

### MOD-03 · InvoiceGeneratedModal
**Used in:** DoctorQueuePage (auto-shown after completing a visit)

Post-completion pop-up informing doctor that an invoice was generated.

**Two variants:**
1. **Standard** (invoice generated):
   - "Visit Completed"
   - "Invoice [INV-XXX] generated — [Total Amount]"
   - Buttons: "Close" | "View Invoice" | "Print Receipt"
   - "View Invoice" expands InvoiceViewer inside the modal (it becomes wide)
   - "Print Receipt" immediately triggers browser print (loads invoice first if not yet fetched)

2. **Free Follow-Up** (no invoice):
   - "Visit Completed"
   - "Free follow-up used — no invoice generated"
   - Button: "Done"

---

### MOD-04 · CreateReferralModal
**Used in:** EncounterPage sidebar

(Full spec in Encounter Page D-04 above)

Two referral types: INTERNAL (specialty + optional doctor) and EXTERNAL (facility name). Bilingual reason and notes fields.

---

### MOD-05 · ProcedureDetailModal
**Used in:** EncounterPage, PatientRecordPage

Full procedure management in a wide modal.

**Header**
- Procedure name (localized: Arabic if in AR mode + AR name exists)
- Status badge
- Template category badge (if from a template)

**Timer Row**
- "Started at: [datetime]" · "Ended at: [datetime or —]"

**Cancellation Notice** *(if CANCELLED)*
- Reason text shown in muted style

**Checklist Section**
- "Procedure Checklist" subheading
- List of checklist steps:
  - Checkbox (ticked = done)
  - Step label
  - `*` if required
  - Completed steps: strikethrough or green text
  - Disabled when not IN_PROGRESS or not the owner
- Empty: "No checklist steps defined"

**Pre-Procedure Notes**
- Textarea (save-on-blur): editable only if not terminal (COMPLETED/CANCELLED) and owner
- Shows existing notes as default value

**Post-Procedure Notes** *(shown only if IN_PROGRESS)*
- Textarea (required before "Complete")

**Complications** *(shown only if IN_PROGRESS)*
- Textarea (optional)

**Completed View** *(if COMPLETED)*
- Shows post-procedure notes (read-only)
- Shows complications (read-only, if any)

**Cancel Form** *(inline, shown when "Cancel Procedure" clicked)*
- Reason textarea (min 3 chars)
- "Confirm Cancel" (danger) + "Go Back" (secondary)

**Action Buttons** *(visible only to owner, only on non-terminal status)*
- "Cancel Procedure" (secondary/danger)
- "Start Procedure" (primary) — shown if SCHEDULED
- "Complete Procedure" (primary) — shown if IN_PROGRESS, disabled if no post-notes

---

### MOD-06 · Prescription Modal (Encounter)
**Used in:** EncounterPage

Wide modal for issuing a prescription during an encounter. See D-04 for full spec.

---

### MOD-07 · Lab Order Modal (Encounter)
**Used in:** EncounterPage

Modal for ordering lab tests during an encounter. Note: creating from encounter **automatically submits** the order (no separate DRAFT step). See D-04 for full spec.

---

### MOD-08 · Procedure Modal (Encounter)
**Used in:** EncounterPage

Modal for scheduling a clinical procedure during an encounter. Select from template library or enter custom name (bilingual). See D-04 for full spec.

---

### MOD-09 · RegisterPatientModal
**Used in:** QueueBoardPage, PatientDirectoryPage, UserManagementPage

**Form fields:**
| Field | Input | Required |
|-------|-------|----------|
| First Name | Text | ✓ |
| Last Name | Text | ✓ |
| Phone | Tel | ✓ |
| Email | Email | ✓ |
| Password | Password | ✓ |
| Date of Birth | Date | Optional |

**Actions:** "Cancel" + "Register"

---

### MOD-10 · PatientProfileEditorModal
**Used in:** QueueBoardPage, PatientDirectoryPage

**Editable fields:**
| Field | Input |
|-------|-------|
| First Name | Text |
| Last Name | Text |
| Phone | Tel |
| Email | Email |
| Date of Birth | Date |

**Actions:** "Cancel" + "Save"

---

### MOD-11 · CreateSecretaryModal
**Used in:** UserManagementPage

**Fields:**
| Field | Input | Notes |
|-------|-------|-------|
| First Name | Text | Required |
| Last Name | Text | Required |
| Email | Email | Required |
| Phone | Tel | Optional |
| Password | Password | Optional — system generates if empty |

**Two states:**
1. Form state: fill fields + "Create Secretary" button
2. Success state: "Secretary created!" + temp password box (if generated) + "Done" button

---

### MOD-12 · UserEditModal
**Used in:** UserManagementPage

Simple edit modal for any user's basic info.

**Fields:** First Name, Last Name, Email, Phone  
**Actions:** "Cancel" + "Save"

---

### MOD-13 · Drug Interaction Warning Modal
**Used in:** Any prescription form (triggered automatically before saving)

**When shown:** When the interaction checker detects potential interactions between the medications in the prescription.

**Content:**
- ⚠️ "Potential Drug Interactions Detected" headline
- List of interaction pairs:
  - Drug A ↔ Drug B
  - Severity level (HIGH / MEDIUM / LOW) with color coding
  - Description of the interaction
- Two buttons:
  - "Cancel — Edit Prescription" (secondary)
  - "Proceed Anyway" (danger)

**Design notes:**
- HIGH severity interactions should have a red header
- This modal should feel like a genuine safety warning, not a formality

---

## SHARED COMPONENTS REFERENCE

### VitalSignsForm
Used in: EncounterPage (inline), PatientRecordPage (inline), Doctor Dashboard

**Fields:**
| Field | Unit | Range |
|-------|------|-------|
| Systolic Blood Pressure | mmHg | 60-250 |
| Diastolic Blood Pressure | mmHg | 40-150 |
| Heart Rate | bpm | 30-250 |
| Temperature | °C | 34-43 |
| O2 Saturation | % | 70-100 |
| Weight | kg | 1-500 |
| Height | cm | 30-250 |

"Save Vitals" button with loading state.

---

### MedicationItemRow
Used in: PrescriptionModal, PrescriptionsSection of PatientRecordPage

One row in a prescription form. Fields:
| Field | Type | Notes |
|-------|------|-------|
| Drug Name | Searchable text/autocomplete | Can use catalog or type freely |
| Dosage Strength | Text | e.g., "500mg" |
| Dosage Form | Dropdown | Tablet, Capsule, Syrup, Injection, Cream, Inhaler, Drops, Other |
| Dosage Pattern | Dropdown | e.g., "1-0-1", "1-1-1", "0-0-1" (morning-noon-night) |
| Frequency | Text | e.g., "Twice daily" |
| Duration | Text | e.g., "7 days" |
| Instructions | Text | e.g., "Take after food" |
| Remove (🗑) | Icon button | Disabled if only 1 row |

---

### PatientTimeline
Used in: PatientTimelinePage, PatientRecordPage

Vertical feed of all medical events. Color-coded by event type. Newest first.

---

### VitalSignsTrendChart
Used in: PatientVitalSignsTab, PatientRecordPage

Multi-line chart (requires 2+ data points). Shows trends over time for BP, HR, Temp, O2, Weight. X-axis: date.

---

### LabStatusTimeline
Used in: PatientLabResultsPage, LabOrderDetailsPage

Visual 5-step progress indicator for lab order status.

---

### ProcedureChecklist
Used in: ProcedureDetailModal

Checkbox list for a procedure's step-by-step checklist. Required steps marked with `*`. Checkboxes disabled when not in IN_PROGRESS state or not the owning doctor.

---

### DoctorCard
Used in: LandingPage, PublicDoctorsPage

| Element | Notes |
|---------|-------|
| Doctor photo | Circular, placeholder initials if no photo |
| Doctor name | Bold |
| Specialty tags | Color-coded pills |
| Star rating | Visual stars + count |
| CTA button | "View Profile" or "Book Now" |

---

### AIScribePanel
Used in: PatientRecordPage

Collapsible panel for AI-assisted clinical note generation. Voice or text input → structured clinical draft.

---

## STATUS BADGE & COLOR SYSTEM

### Appointment Status
| Status | Hex | Meaning |
|--------|-----|---------|
| PENDING | `#F59E0B` amber | Awaiting confirmation |
| CONFIRMED | `#3B82F6` blue | Confirmed |
| CHECKED_IN | `#06B6D4` cyan | Patient arrived |
| IN_PROGRESS | `#8B5CF6` purple | Currently being seen |
| COMPLETED | `#10B981` green | Visit done |
| CANCELLED | `#6B7280` gray | Cancelled |
| NO_SHOW | `#EF4444` red | Patient didn't show |

### Lab Order Status
| Status | Color |
|--------|-------|
| DRAFT | Gray |
| ORDERED | Blue |
| SAMPLE_COLLECTED | Orange |
| PROCESSING | Purple |
| COMPLETED | Green |

### Invoice Status
| Status | Color | Meaning |
|--------|-------|---------|
| ISSUED | Blue | Issued, not yet paid |
| PARTIALLY_PAID | Orange | Some payment received |
| PAID | Green | Fully paid |
| VOID | Gray/muted | Voided/cancelled |

### Referral Status
| Status | Color |
|--------|-------|
| PENDING | Amber |
| ACCEPTED | Blue |
| COMPLETED | Green |
| CANCELLED | Gray |

### Procedure Status
| Status | Color |
|--------|-------|
| SCHEDULED | Blue |
| IN_PROGRESS | Purple |
| COMPLETED | Green |
| CANCELLED | Gray/muted |

### Prescription Status
| Status | Color |
|--------|-------|
| ACTIVE | Green |
| CANCELLED / VOIDED | Red/muted with strikethrough |

### Lab Priority
| Priority | Color |
|----------|-------|
| ROUTINE | Gray (default, no badge needed) |
| URGENT | Orange |
| STAT | Red (emergency) |

### Appointment Type
| Type | Color |
|------|-------|
| EMERGENCY | Red |
| WALK_IN | Orange |
| SCHEDULED | No badge (default) |

### Result Severity
| Severity | Row Background |
|----------|---------------|
| CRITICAL | Red background |
| ABNORMAL | Orange/amber background |
| Normal | No highlight |

### User Status
| Status | Badge |
|--------|-------|
| Active | Green "Active" |
| Inactive | Red/gray "Inactive" |

---

## CRITICAL UX PATTERNS

### 1. Bilingual EN/AR Layout
- **Language switcher:** always accessible (header, login, register)
- **When Arabic is active:**
  - Entire layout mirrors to RTL (sidebar on right, text right-aligned)
  - `dir="rtl"` on root or on individual containers
  - Some specific textareas always have `dir="rtl"` regardless of UI language (for bilingual clinical documentation)
- **Localized names:** Doctor specialties, diagnoses, and procedures show Arabic names when in AR mode
- **Chief Complaint AR field:** Auto-populated from the catalog master row — intentionally read-only; not manually editable

### 2. Real-time Queue Updates
| Page | Update Method | Frequency |
|------|--------------|-----------|
| DoctorQueuePage | **WebSocket** (useDoctorQueueSocket) | Instant push |
| QueueBoardPage (Secretary) | Polling | Every 20 seconds |
| MyAppointmentsPage (IN_PROGRESS) | Polling | Every 30 seconds |
| KioskQueuePage | Polling | Every 30 seconds |

WebSocket indicator: show a subtle "Live" badge when WebSocket is connected.
Polling pages: show "Last updated: X seconds ago" in the footer.

### 3. Encounter Auto-Save
- **Trigger:** Any form field change
- **Delay:** 600ms debounce after last keystroke
- **Visual:** "Saving..." → "Saved ✓" indicator (subtle, bottom of form or sidebar)
- **On submit:** Flushes any pending save before submitting to ensure no data loss
- **Read-only mode:** No auto-save; lock notice shown

### 4. Drug Interaction Check
- **When:** Before saving any prescription (both from encounter and patient record)
- **Process:** API checks for interactions between all drugs in the prescription
- **If interactions found:** InteractionWarningModal shown with details
- **User choice:** Proceed anyway or cancel to edit
- **UI:** Loading state while check runs (button shows spinner)

### 5. Inline Expanding Forms
Several actions expand inline rather than opening a modal:
- Leave a review (My Appointments page)
- Create a follow-up (Doctor Appointments page)
- Void a prescription (Encounter sidebar + Patient Record)
Design: smooth expand/collapse animation (200–300ms). The form appears below the trigger button.

### 6. Invoice Auto-Generation
- Happens automatically when a doctor clicks "Complete Visit" on the Queue page
- No doctor action needed for billing — it's automated
- InvoiceGeneratedModal pops up to inform the doctor
- Free follow-up visits: no invoice generated, different modal variant shown

### 7. Procedure Checklist Interaction
- Checklist steps are toggleable ONLY when procedure is IN_PROGRESS and the doctor is the owner
- Each toggle saves immediately to the API
- Multiple rapid toggles are handled correctly (local state mirrors optimistically)
- Required steps marked with `*` — cannot be left unchecked before "Complete" (API enforces this)

### 8. Empty States
Every list/table must have a designed empty state:
- Friendly illustration or icon (not a bare "No results" text)
- Descriptive message explaining why it's empty
- CTA button where applicable (e.g., "Book your first appointment →")

### 9. Mobile Responsiveness
| Element | Mobile Behavior |
|---------|----------------|
| Sidebar navigation | Collapses to hamburger → slide-in drawer |
| Doctor Detail date picker | Horizontal scroll |
| Data tables | Collapse to card/list view; hide less-important columns |
| Queue Page | Stack Previous/Current/Next vertically |
| Kiosk Page | Always full-screen (designed for large screen/tablet) |
| Invoice Viewer | Horizontal scroll in table for line items |

### 10. Loading Skeleton Guidelines
| Context | Skeleton Shape |
|---------|----------------|
| Doctor card | Rectangle with circle avatar |
| Appointment row | Three horizontal bars |
| KPI tile | Square with number placeholder |
| Table row | Full-width bar |
| Invoice card | Two-line horizontal layout |

### 11. Button Loading States
All async actions that might take time use button-level loading:
- Button content replaced with spinner
- Button disabled during loading
- Loading must be limited to the specific button clicked (never freeze the whole page)

### 12. Confirmation Dialogs
Required before these actions:
- Cancel appointment
- Void prescription (with reason textarea in addition)
- Delete scan
- Reset password
- Deactivate/reactivate user
- Create doctor absence
- Reissue prescription
- Mark No-Show
- Cancel procedure (with reason textarea in addition)
- Cancel referral

### 13. Pagination
- Standard: "‹ Previous" | "Page X of Y" | "Next ›"
- Used in: BillingDeskPage (20/page), LabOrdersListPage (20/page), AuditLogPage, MyInvoicesPage (20/page)
- Changing page resets scroll to top

### 14. Print / PDF
- Browser print dialog used for "Print Receipt" and "Download PDF"
- A special CSS print stylesheet should hide navigation, modal chrome, buttons, etc.
- Print view: full-width invoice, clean, black-on-white

---

## APPENDIX: Complete Page Count

| Section | Pages |
|---------|-------|
| Public | 7 |
| Patient | 11 |
| Doctor | 11 |
| Secretary | 10 |
| Manager | 7 |
| Account | 1 |
| **Total** | **47** |

| Section | Modals/Overlays |
|---------|----------------|
| Billing | 3 (InvoiceViewer, PaymentForm, InvoiceGenerated) |
| Referrals | 1 (CreateReferral) |
| Procedures | 1 (ProcedureDetail) |
| Prescriptions | 1 (PrescriptionModal) + InteractionWarning |
| Lab | 1 (LabOrderModal) |
| Users | 3 (CreateDoctor, CreateSecretary, UserEdit) |
| Patients | 2 (RegisterPatient, PatientProfileEditor) |
| **Total Modals** | **~13** |

---

*Document generated from complete frontend source audit · 2026-07-30 · 47 pages · 13 modals · All phases (1–13+)*
