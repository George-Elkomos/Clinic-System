# Clinic System — UI Design Specification

> **Purpose:** This document is the single source of truth for the UI designer. It describes every page in the frontend, what it shows, what users can do on it, and what data drives it. Use this to design the best possible UI for each screen.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Roles & Access](#roles--access)
3. [Global UI Elements](#global-ui-elements)
4. [Public Pages](#public-pages)
   - [Landing Page](#1-landing-page)
   - [Login Page](#2-login-page)
   - [Register Page](#3-register-page)
   - [Public Doctors Page](#4-public-doctors-page)
   - [Doctor Detail Page](#5-doctor-detail-page)
   - [Kiosk Queue Page](#6-kiosk-queue-page)
   - [Error Pages (403 / 404)](#7-error-pages-403--404)
5. [Patient Pages](#patient-pages)
   - [Patient Dashboard](#8-patient-dashboard)
   - [Book Appointment Page](#9-book-appointment-page)
   - [My Appointments Page](#10-my-appointments-page)
   - [My Medical History Page](#11-my-medical-history-page)
   - [My Prescriptions Page](#12-my-prescriptions-page)
   - [My Scans & Labs Page](#13-my-scans--labs-page)
   - [Patient Lab Results Page](#14-patient-lab-results-page)
   - [Patient Timeline Page](#15-patient-timeline-page)
   - [Patient Vital Signs Tab](#16-patient-vital-signs-tab)
6. [Doctor Pages](#doctor-pages)
   - [Doctor Dashboard](#17-doctor-dashboard)
   - [Doctor Queue Page](#18-doctor-queue-page)
   - [Doctor Appointments Page](#19-doctor-appointments-page)
   - [Encounter Page](#20-encounter-page)
   - [Patient Record Page](#21-patient-record-page)
   - [Schedule Management Page](#22-schedule-management-page)
   - [Doctor Reviews Page](#23-doctor-reviews-page)
   - [Lab Orders List Page](#24-lab-orders-list-page)
   - [Create Lab Order Page](#25-create-lab-order-page)
   - [Lab Order Details Page](#26-lab-order-details-page)
7. [Secretary Pages](#secretary-pages)
   - [Secretary Dashboard](#27-secretary-dashboard)
   - [Appointment Desk Page](#28-appointment-desk-page)
   - [Queue Board Page](#29-queue-board-page)
   - [Doctors Page](#30-doctors-page)
   - [Patient Directory Page](#31-patient-directory-page)
   - [Sample Collection Page](#32-sample-collection-page)
   - [Doctor Absence Page](#33-doctor-absence-page)
8. [Manager Pages](#manager-pages)
   - [Manager Dashboard](#34-manager-dashboard)
   - [User Management Page](#35-user-management-page)
   - [Create Doctor Page](#36-create-doctor-page)
   - [Reports Dashboard Page](#37-reports-dashboard-page)
   - [Review Moderation Page](#38-review-moderation-page)
   - [Audit Log Page](#39-audit-log-page)
9. [Account Settings](#account-settings)
   - [Notification Preferences Page](#40-notification-preferences-page)
10. [Shared Modals & Components](#shared-modals--components)
11. [Design Tokens & Status Colors](#design-tokens--status-colors)

---

## System Overview

This is a **multi-role clinic management system** built with React + TypeScript. It supports four user roles: **Patient**, **Doctor**, **Secretary**, and **Manager**. The system supports both **English (LTR)** and **Arabic (RTL)** languages throughout.

### Technology Stack (for designers to be aware of)
- React + TanStack Query for data fetching
- i18next for bilingual support (EN/AR)
- Custom primitive components (Button, Card, FormField, Modal, Select, etc.)
- Real-time queue updates via polling (every 15–30 seconds)

---

## Roles & Access

| Role | Home Route | Accessible Sections |
|------|-----------|---------------------|
| **PATIENT** | `/patient/dashboard` | Patient pages + Account settings |
| **DOCTOR** | `/doctor/dashboard` | Doctor pages + Account settings |
| **SECRETARY** | `/secretary/dashboard` | Secretary pages + Account settings |
| **MANAGER** | `/manager/dashboard` | Manager pages + Secretary pages + Account settings |
| **Public** | `/` | Landing, Doctors list, Doctor detail, Kiosk, Login, Register |

---

## Global UI Elements

These elements appear on every authenticated page:

### App Shell / Navigation
- **Role-based sidebar navigation** — links change based on user role
- **Language switcher** — toggles between English and Arabic (flips layout direction RTL/LTR)
- **Notification bell** — shows unread notifications count, expandable list
- **User avatar/name** — shows logged-in user, links to account settings

### Toast Notifications
- Appear at top-right (or top-center on mobile)
- Three variants: **success** (green), **error** (red), **info** (neutral)
- Auto-dismiss after a few seconds

### Status Badges
Used throughout the app to show appointment/lab/prescription status:

| Status | Color Suggestion |
|--------|-----------------|
| PENDING | Yellow/Amber |
| CONFIRMED | Blue |
| CHECKED_IN | Teal |
| IN_PROGRESS | Purple |
| COMPLETED | Green |
| CANCELLED | Red/Muted |
| DRAFT | Gray |
| ORDERED | Blue |
| SAMPLE_COLLECTED | Orange |
| PROCESSING | Purple |
| ACTIVE | Green |
| ROUTINE | Gray |
| URGENT | Orange |
| STAT | Red |
| EMERGENCY | Red |
| WALK_IN | Orange |

### Confirm Dialog
- Modal with title, message, and two buttons: **Cancel** (secondary) + **Confirm** (primary or danger)
- Used before any destructive action (void prescription, delete, etc.)

### Loading States
- **Full-page spinner** — centered spinner while page data loads
- **Button loading state** — button shows spinner + disabled during API call
- **Skeleton placeholders** — could be added for cards/tables

---

## PUBLIC PAGES

---

### 1. Landing Page
**Route:** `/`  
**Access:** Public (no login required)

#### Purpose
Marketing/home page for the clinic. Introduces the clinic and encourages visitors to register or find a doctor.

#### Layout & Sections

**Hero Section (Full-width banner)**
- Large headline: Clinic name / tagline
- Subheadline: Brief description of services
- Two CTA buttons:
  - "Book an Appointment" → `/doctors`
  - "Register" → `/register`
- Background: gradient or hero image

**How It Works Section**
- Headline: "How It Works"
- 3 steps shown as icon cards in a row:
  1. Find a Doctor
  2. Book a Slot
  3. See Your Doctor
- Each step has an icon, step number, title, and short description

**Top Rated Doctors Section**
- Headline: "Our Top Doctors"
- Horizontal scroll or grid of up to 6 **Doctor Cards**
- Each card shows:
  - Doctor photo
  - Doctor name
  - Specialties (tags)
  - Star rating + review count
  - "Book Now" button → Doctor detail page
- Data: Fetched from API (top 6 by rating)

**Register CTA Section**
- Banner with "Join our clinic today" headline
- "Register as a Patient" button

#### States
- Loading: Show skeleton cards for the doctor section while fetching
- If no doctors found: Hide the section gracefully

---

### 2. Login Page
**Route:** `/login`  
**Access:** Public (redirects to role home if already logged in)

#### Purpose
Authenticate users into the system.

#### Layout
- Centered card, vertically centered on page
- Clinic logo at top
- Language switcher in header (top-right corner of page)

#### Form Fields
| Field | Type | Notes |
|-------|------|-------|
| Email | Email input | Required |
| Password | Password input | With show/hide toggle |

#### Actions
- **Login button** — submits form, shows loading spinner while waiting
- **Register link** — "Don't have an account? Register" → `/register`

#### States
- **Loading** — button shows spinner, fields disabled
- **Error — Invalid credentials** — inline error message: "Invalid email or password"
- **Error — Network/server** — error message: "Cannot connect to server"
- **Success** — redirects to role-specific home (or `?next=` query param destination)

#### Design Notes
- The `?next=` query parameter means after login the user returns to where they were
- Simple, clean design — this is the entry point for all users including clinic staff

---

### 3. Register Page
**Route:** `/register`  
**Access:** Public

#### Purpose
Patient self-registration form.

#### Layout
- Centered card, similar to login
- Clinic logo at top

#### Form Fields
| Field | Type | Notes |
|-------|------|-------|
| First Name | Text | Required |
| Last Name | Text | Required |
| Phone | Tel input | Required |
| Email | Email | Required |
| Password | Password | With show/hide toggle |

#### Actions
- **Register button** — submits, shows loading, then auto-logs in and redirects to patient dashboard
- **Login link** — "Already have an account? Login" → `/login`

#### States
- **Loading** — button spinner
- **Error** — inline field-level or general error message (e.g., "Email already in use")
- **Success** — auto-login then redirect (no separate success screen)

---

### 4. Public Doctors Page
**Route:** `/doctors`  
**Access:** Public

#### Purpose
Browse and search all available doctors.

#### Layout
- Search bar at top
- Specialty filter dropdown beside search bar
- Doctor grid below (responsive: 3-col desktop, 2-col tablet, 1-col mobile)

#### Controls
| Control | Type | Notes |
|---------|------|-------|
| Search | Text input | Filters by doctor name |
| Specialty | Dropdown | Populated from API, "All Specialties" option |

#### Doctor Card (in grid)
- Doctor photo (circle avatar)
- Doctor name
- Specialty tags (colored pills)
- Star rating + number of reviews
- "View Profile" or "Book" button → `/doctors/:id`

#### States
- **Loading** — skeleton cards
- **Empty** — "No doctors found" message with a clear search suggestion
- **Error** — error message with retry

---

### 5. Doctor Detail Page
**Route:** `/doctors/:id`  
**Access:** Public (booking requires PATIENT login)

#### Purpose
Full doctor profile with slot booking.

#### Layout
Two-column on desktop (doctor info left, booking right), single column on mobile.

#### Left Column — Doctor Info
- Large doctor photo
- Doctor name (H1)
- Specialty tags (colored pills, e.g., Cardiology = red, Neurology = blue)
- Bio text
- Info grid:
  - Room number
  - Languages spoken
  - Appointment duration (minutes)
  - Years of experience
- Star rating (visual stars) + "(X reviews)" count

#### Right Column — Booking
**Date Selector**
- 7 horizontally scrollable date buttons (today + next 6 days)
- Each button shows: day of week + date number
- Selected date highlighted

**Available Time Slots**
- Grid of time buttons for selected date
- Each button shows the time (e.g., "09:30 AM")
- Selected slot highlighted
- Disabled slots shown as unavailable
- Loading state while fetching slots

**Reason for Visit**
- Textarea: "What brings you in today?"
- Required before booking

**Book Button**
- Only visible if user is logged in as PATIENT
- If not logged in: "Login to book" button → login page
- If no slots: "Join Waitlist" button

**Waitlist Note**
- If all slots are full, show a message and "Join Waitlist" button

#### Reviews Section (below main content)
- Headline: "Patient Reviews"
- Review cards:
  - Star rating
  - Comment text
  - Date (relative or formatted)
- If no reviews: "No reviews yet"

#### States
- **Loading** — spinner while fetching doctor data
- **Slots loading** — skeleton or spinner in the slots area while fetching
- **No slots** — message + waitlist option
- **Booking success** — toast notification, redirect to patient appointments

---

### 6. Kiosk Queue Page
**Route:** `/kiosk/:doctorId`  
**Access:** Public (designed for a large screen in the waiting room)

#### Purpose
A waiting room display screen showing the current queue status for a specific doctor.

#### Design Notes
- **Large text** — designed to be read from a distance (2–3 meters)
- **Auto-refreshes every 30 seconds** — no user interaction needed
- **Dark or high-contrast theme** recommended for visibility
- No navigation, no login required

#### Layout
Full-screen display, vertically stacked sections:

**Header**
- Doctor name
- Clock or current date/time (optional)

**Now Serving (Primary — largest section)**
- Label: "NOW SERVING"
- Patient name in very large bold text
- Time patient was called
- Green/teal accent

**Up Next (Secondary)**
- Label: "UP NEXT"
- List of next 2–3 patients:
  - Patient name
  - Scheduled time
  - EMERGENCY badge (red) or WALK_IN badge (orange) if applicable

**Waiting**
- Label: "WAITING"
- Number of patients still in queue

#### States
- **Empty queue** — "No patients currently" message
- **Auto-refresh indicator** — subtle "Last updated: X seconds ago" text

---

### 7. Error Pages (403 / 404)
**Route:** `/403`, `*` (catch-all)  
**Access:** Public

#### 403 Forbidden
- Icon: lock or shield
- Headline: "Access Denied"
- Message: "You don't have permission to view this page"
- Button: "Go Home" or "Back"

#### 404 Not Found
- Icon: magnifying glass or broken link
- Headline: "Page Not Found"
- Message: "The page you're looking for doesn't exist"
- Button: "Go Home"

#### Design Notes
- Centered, full-page layout
- Friendly tone, not alarming
- Match the system's visual language (not a bare browser error)

---

## PATIENT PAGES

---

### 8. Patient Dashboard
**Route:** `/patient/dashboard`  
**Access:** PATIENT role

#### Purpose
Patient's home page — quick overview and easy access to main actions.

#### Layout
- Welcome greeting: "Good morning, [First Name]!"
- Two cards side by side (or stacked on mobile)

**Quick Actions Card**
- Two large buttons:
  - "Book an Appointment" → `/patient/book`
  - "My Appointments" → `/patient/appointments`
- These are the primary patient actions, make them prominent

**Upcoming Appointments Card**
- Headline: "Upcoming Appointments"
- List of upcoming appointments (status: PENDING, CONFIRMED, or CHECKED_IN)
- Each row shows:
  - Doctor name
  - Appointment date + time (formatted)
  - Status badge
- If none: "You have no upcoming appointments" with a "Book Now" link

#### States
- **Loading** — spinner or skeleton in the appointments card
- **Empty** — friendly empty state with CTA
- **Error** — retry message

---

### 9. Book Appointment Page
**Route:** `/patient/book`  
**Access:** PATIENT role

#### Purpose
Patient selects a doctor, date, and time slot to book an appointment.

#### Layout
Single-column form flow (wizard-like, though on one page)

#### Step 1 — Choose Doctor
- Searchable dropdown: "Select a Doctor"
- Shows doctor name and specialty in options
- Required before proceeding

#### Step 2 — Choose Date
- Date picker (from today onward, no past dates)
- Appears after doctor is selected

#### Step 3 — Reason for Visit
- Textarea: "Reason for visit"
- Optional or required (check behavior)

#### Step 4 — Choose Time Slot
- Grid of available time slot buttons
- Appears after doctor + date are selected
- Each button: time (e.g., "10:00 AM")
- Disabled if unavailable
- Selected slot highlighted

**Waitlist Option**
- If no slots available for the selected doctor/date, show:
  - Message: "No available slots for this date"
  - "Join Waitlist" button

#### Submit
- "Book Appointment" button
- Disabled until doctor + date + slot are selected
- Shows loading state during booking

#### States
- **Slots loading** — spinner in slot area
- **No slots** — waitlist option shown
- **Success** — toast + redirect to My Appointments
- **Error** — inline error message

---

### 10. My Appointments Page
**Route:** `/patient/appointments`  
**Access:** PATIENT role

#### Purpose
Patient views all their appointments, tracks queue position, confirms follow-ups, and leaves reviews.

#### Layout
Multiple sections stacked vertically.

**Today's Status Card (conditional — only shown if appointment is today)**
- Blue/teal accent card at the top
- Shows:
  - Doctor name
  - Scheduled time
  - Current status badge
  - Queue position: "You are #3 in queue"
  - Estimated wait time: "~15 minutes"
  - For IN_PROGRESS: "Open your encounter record" link
- Auto-refreshes every 30 seconds (live queue tracking)

**Suggested Follow-Ups Section (conditional)**
- Shown if doctor has recommended a follow-up
- Each card shows:
  - Recommended date
  - Notes from doctor
  - Two buttons: "Confirm" (books the follow-up) and "Dismiss"

**All Appointments List**
- Chronological list of all appointments
- Each appointment card:
  - Doctor name + specialty
  - Date and time
  - Reason for visit
  - Status badge
  - **Cancel button** — only shown for PENDING or CONFIRMED status
  - **Leave a Review button** — only shown for COMPLETED status where review not yet submitted
    - Clicking expands inline review form:
      - Star rating selector (1–5)
      - Comment textarea
      - Submit review button

**Waitlist Section (conditional)**
- If patient is on any waitlists, show them
- Each entry: doctor name, date requested
- "Leave Waitlist" button per entry

#### States
- **Today card loading** — spinner
- **Queue position** — auto-refreshes while appointment is IN_PROGRESS
- **Empty list** — "No appointments yet" with "Book Now" button

---

### 11. My Medical History Page
**Route:** `/patient/history`  
**Access:** PATIENT role

#### Purpose
Patient views and edits their personal health background, and reads their medical records and clinical notes from doctors.

#### Layout
Multiple stacked cards.

**Card 1 — Background Information (Editable by patient)**
- Form fields:
  | Field | Type | Notes |
  |-------|------|-------|
  | Blood Type | Dropdown | A+, A-, B+, B-, O+, O-, AB+, AB- |
  | Allergies | Textarea | Free text summary |
  | Chronic Conditions | Textarea | e.g., "Diabetes, Hypertension" |
  | Previous Surgeries | Textarea | e.g., "Appendectomy 2018" |
  | Current Medications | Textarea | Free text |
- "Save" button at bottom
- Read by doctors during queue and encounter

**Card 2 — Medical Records (Read-only)**
- List of structured records added by doctors
- Each record:
  - Version number (v1, v2, v3...)
  - "CURRENT" badge on the latest
  - Date created
  - Doctor name
  - Diagnosis text
  - Treatment plan text
- Accordion or timeline style

**Card 3 — Clinical Notes (Read-only)**
- Notes written by doctors during visits
- Each note:
  - Specialty category (e.g., "Cardiology")
  - Doctor name
  - Date
  - Note body text
- If none: "No notes yet"

#### States
- **Saving** — button shows spinner
- **Saved** — success toast
- **Empty records/notes** — friendly empty message

---

### 12. My Prescriptions Page
**Route:** `/patient/prescriptions`  
**Access:** PATIENT role

#### Purpose
Patient views all prescriptions issued to them.

#### Layout
List of prescription cards, newest first.

**Each Prescription Card**
- Header row:
  - Doctor name + date issued
  - Status badge: "ACTIVE" (green) or "CANCELLED/VOIDED" (red, strikethrough style)
- Medications list:
  - Each medication row:
    - Drug name (bold)
    - Dosage strength + form (e.g., "500mg Tablet")
    - Frequency (e.g., "Twice daily")
    - Duration (e.g., "7 days")
    - Instructions (e.g., "Take after food")
- Notes section (if any)
- "Open PDF" button — only for ACTIVE prescriptions (opens prescription as downloadable/printable PDF)
- If voided:
  - Voided-on date
  - Voided-by name
  - Void reason

#### States
- **Loading** — skeleton cards
- **Empty** — "No prescriptions yet"

---

### 13. My Scans & Labs Page
**Route:** `/patient/scans`  
**Access:** PATIENT role

#### Purpose
Patient views their imaging scans and lab results, and can upload their own scans.

#### Layout
Three sections stacked.

**Section 1 — Upload a Scan**
- Form:
  | Field | Type | Options |
  |-------|------|---------|
  | Category | Dropdown | XRAY, MRI, CT, ULTRASOUND, DICOM, OTHER |
  | File | File input | Accept: jpg, jpeg, png, pdf, dcm, dicom |
- "Upload" button — disabled until file selected
- Loading state during upload

**Section 2 — My Scans**
- List of uploaded scans
- Each row:
  - Category (bold, e.g., "XRAY")
  - Original filename
  - Date uploaded
  - Who uploaded (patient or doctor name)
  - "Download" button

**Section 3 — My Lab Results**
- Simple table/list of lab results
- Each row:
  - Test name
  - Result value + unit
  - "ABNORMAL" badge (orange/red) if applicable

#### States
- **Upload loading** — button spinner
- **Success** — toast + list refreshes
- **Empty scans** — "No scans yet"
- **Empty labs** — "No lab results yet"

---

### 14. Patient Lab Results Page
**Route:** `/patient/labs`  
**Access:** PATIENT role

#### Purpose
Detailed view of all lab orders placed for the patient, with full results.

#### Layout
Expandable list of lab orders.

**Each Lab Order Card (collapsed)**
- Order number (e.g., "LAB-2024-001")
- Date ordered
- Status badge (ORDERED, PROCESSING, COMPLETED, etc.)
- Expand arrow / click to expand

**Each Lab Order Card (expanded)**
- Lab status timeline:
  - Visual progress steps: Ordered → Sample Collected → Processing → Completed
  - Current step highlighted
- Results table (if status = COMPLETED):
  | Column | Notes |
  |--------|-------|
  | Test Name | Bold |
  | Result Value | Bold if abnormal |
  | Unit | e.g., "mg/dL" |
  | Reference Range | e.g., "70-100" |
  | Result Date | Formatted date |
  | Status | CRITICAL (red) or ABNORMAL (orange) badge |
- Critical results highlighted in red row background
- Abnormal results highlighted in orange row background

#### States
- **Loading** — spinner
- **No results yet** — "Results pending" message in expanded view
- **Empty orders** — "No lab orders found"

---

### 15. Patient Timeline Page
**Route:** `/patient/timeline`  
**Access:** PATIENT role

#### Purpose
Visual chronological view of the patient's entire medical history.

#### Layout
- Page title: "My Medical Timeline"
- PatientTimeline component takes up the full content area

**Timeline Component**
- Vertical timeline (like a feed/stream)
- Events sorted newest-first (or oldest-first with toggle)
- Each event card shows:
  - Event type icon (appointment, prescription, lab, scan, note)
  - Date + time
  - Title (e.g., "Encounter with Dr. Smith" or "Lab Order Completed")
  - Brief summary/description
  - Link to detail if applicable

#### Design Notes
- Use color-coding per event type for visual scanning
- Consider a filter bar to show/hide event types

---

### 16. Patient Vital Signs Tab
**Route:** `/patient/vitals` (or as a tab within another page)  
**Access:** PATIENT role

#### Purpose
Patient views their historical vital signs.

#### Layout
Two sections:

**Trend Chart (shown if 2+ data points)**
- Multi-line chart showing trends over time
- Lines for: Blood Pressure (systolic/diastolic), Heart Rate, Temperature, O2 Saturation, Weight

**History Table**
- Read-only table of all recorded vitals
- Columns:
  - Date/Time
  - BP (systolic/diastolic)
  - Heart Rate
  - Temperature
  - O2 Saturation
  - Weight
  - Height
- Newest first

---

## DOCTOR PAGES

---

### 17. Doctor Dashboard
**Route:** `/doctor/dashboard`  
**Access:** DOCTOR role

#### Purpose
Doctor's daily overview — quick view of today's queue and pending lab work.

#### Layout
- Welcome greeting: "Good morning, Dr. [Last Name]!"
- Lab KPI row
- Today's Queue card

**Lab KPI Row (3 widgets)**
- **Pending Orders** — count of lab orders awaiting action
- **Critical Results** — count of critical lab results needing review (highlighted red)
- **Recent Labs** — summary of recently completed labs

Each widget is a small card with a number and label. Critical Results should have a red accent/alert style.

**Today's Queue Card**
- Headline: "Today's Appointments"
- List of today's appointments sorted by time
- Each row:
  - Patient name
  - Scheduled time
  - Status badge
  - **Action button** (changes based on status):
    - CONFIRMED → "Check In"
    - CHECKED_IN → "Start Encounter"
    - IN_PROGRESS → "Open Encounter" (link)
    - COMPLETED → no action

#### States
- **Loading** — skeleton rows
- **Empty** — "No appointments today"

---

### 18. Doctor Queue Page
**Route:** `/doctor/queue`  
**Access:** DOCTOR role

#### Purpose
The doctor's live queue management screen — seen from the exam room to manage patient flow.

#### Layout
Three-column or three-card layout (Previous | Current | Next)

**Previous Patient Card (left/top, smaller)**
- Label: "PREVIOUS"
- Patient name
- Completion time
- Appointment reason (brief)

**Current Patient Card (center/main, LARGEST)**
- Label: "NOW WITH"
- Patient name (large, prominent)
- Demographic chips:
  - Gender
  - Age
  - Blood type
- Appointment type badge: "EMERGENCY" (red) or "WALK_IN" (orange) — only shown if applicable
- Phone number (with click-to-call link)
- "Started at [time]"
- Appointment reason
- **ALLERGY ALERT BANNER** (bright red) — shown prominently if patient has allergies
  - Text: "⚠ Allergies: [allergy summary]"
- Chronic conditions (brief text)
- Current medications (brief text)
- Separator line
- Two action buttons:
  - "Complete Encounter" (primary) — marks appointment complete
  - "Mark No-Show" (secondary/danger) — marks patient as no-show
- Two links:
  - "Open Encounter" → `/doctor/encounter/:appointmentId` (for IN_PROGRESS)
  - "Open Patient Record" → `/doctor/patients` (with this patient pre-selected)

**Next Patient Card (right/bottom, smaller)**
- Label: "UP NEXT"
- Patient name
- Scheduled time
- Appointment reason
- Appointment type badge if applicable
- **"Call Next" button** (primary) — moves next patient to CHECKED_IN/IN_PROGRESS

**Queue Footer**
- "X patients waiting"
- "Auto-refreshes every 15 seconds" indicator

#### States
- **Empty queue** — "No patients in queue today" message
- **No current patient** — "Queue is empty — tap Call Next to begin"
- **Auto-refresh** — page re-queries every 15 seconds silently

---

### 19. Doctor Appointments Page
**Route:** `/doctor/appointments`  
**Access:** DOCTOR role

#### Purpose
Doctor sees all their appointments (across all time), can filter by status, and perform status transitions.

#### Layout
- Status filter tabs/pills at top
- Appointment list below

**Status Filter**
- Tab bar: All | PENDING | CONFIRMED | CHECKED_IN | IN_PROGRESS | COMPLETED | CANCELLED
- Selected tab highlighted

**Appointment List**
- Each appointment card:
  - Patient name
  - Appointment date + time
  - Status badge
  - Appointment type badge (EMERGENCY, WALK_IN) if applicable
  - **Action button** (based on status):
    - CONFIRMED → "Check In"
    - CHECKED_IN → "Start Encounter"
    - IN_PROGRESS → "Open Encounter" link
    - COMPLETED → "Create Follow-Up" button
  - **Create Follow-Up inline form** (expands when clicked for COMPLETED):
    - Date picker: "Recommended follow-up date"
    - Textarea: "Notes for follow-up"
    - "Create" button

#### States
- **Loading** — skeleton rows
- **Empty filtered list** — "No [status] appointments"

---

### 20. Encounter Page
**Route:** `/doctor/encounter/:appointmentId`  
**Access:** DOCTOR role (only the assigned doctor)

#### Purpose
The primary clinical documentation page. Doctor fills in clinical notes during or after seeing a patient. This is the most complex page in the system.

#### Layout
Two-column: **Main content (wide left)** + **Sidebar (narrow right)**

#### Page Header
- Breadcrumb: Appointments → Encounter
- Title: "Encounter — [Patient Name]"
- Status badge: DRAFT or SUBMITTED

**Lock Notice (shown when not editable)**
- Card with message: "This encounter is locked for editing"
- If doctor is the owner and status is SUBMITTED: "Amend" button (creates a new draft copy)

---

#### Main Column — 4 Cards

**Card 1 — Chief Complaint**
- Async searchable combobox: "Chief Complaint" (searches from complaint database)
- Text input (RTL): "Chief Complaint in Arabic"

**Card 2 — Symptoms & Vitals**
- Multi-select searchable dropdown: "Symptoms" (options from complaint database)
  - Hint: "Select all symptoms reported"
- Divider: "Capture Vitals"
- **If vitals are already linked:**
  - Checkmark ✓ "Vitals linked — BP 120/80, HR 72"
  - No form shown
- **If no vitals and encounter is editable:**
  - Vitals form inline:
    | Field | Type | Notes |
    |-------|------|-------|
    | Systolic BP | Number | mmHg |
    | Diastolic BP | Number | mmHg |
    | Heart Rate | Number | bpm |
    | Temperature | Number | °C or °F |
    | O2 Saturation | Number | % |
    | Weight | Number | kg |
    | Height | Number | cm |
  - "Save Vitals" button — auto-links to encounter on success
- **Read-only:** Shows "—" dash

**Card 3 — Examination Findings**
- Textarea (LTR): "Examination Findings"
- Textarea (RTL): "Examination Findings (Arabic)"

**Card 4 — Diagnosis & Treatment**
- Async searchable combobox: "Diagnosis" (searches ICD/diagnosis database)
- Textarea: "Diagnosis Notes"
- Textarea (LTR): "Treatment Plan"
- Textarea (RTL): "Treatment Plan (Arabic)"

**Submit Row (below cards, only when editable)**
- "Auto-saved" hint text (small, muted)
- "Submit Encounter" button (primary) → triggers confirm dialog

---

#### Sidebar — Linked Orders & Prescriptions

**Title: "Orders & Prescriptions"**

**Action buttons:**
- "Add Prescription" (secondary) → opens Prescription Modal
- "Order Lab" (secondary) → opens Lab Order Modal

Both buttons are disabled in read-only mode.

**Prescriptions Section**
- Subheading: "Linked Prescriptions"
- If none: "None linked"
- If linked: List of prescription items
  - Each item:
    - Drug names (comma-separated)
    - Void button 🚫 (only in editable mode, on ACTIVE prescriptions)
    - **Inline void form** (expands when void clicked):
      - Textarea: "Reason for voiding" (required, min 5 chars)
      - "Cancel" (secondary) + "Void Prescription" (danger) buttons
    - VOIDED badge if already cancelled, with reason shown

**Lab Orders Section**
- Subheading: "Linked Lab Orders"
- If none: "None linked"
- List items: "LAB-2024-001 · ORDERED"

---

#### Prescription Modal
- Triggered by "Add Prescription" button
- Full-width modal

**Content:**
- One or more Medication Rows:
  - Drug name (searchable autocomplete or free text)
  - Dosage strength (e.g., "500mg")
  - Dosage form dropdown (Tablet, Capsule, Injection, Syrup, etc.)
  - Dosage pattern dropdown (e.g., "1-0-1", "0-0-1")
  - Frequency (e.g., "Twice daily")
  - Duration (e.g., "7 days")
  - Instructions (e.g., "Take after food")
  - Remove row button (🗑) — only if more than 1 row
- "Add Medication" button — adds another row
- Textarea: "Additional Notes / Instructions"
- Footer buttons: "Cancel" (secondary) + "Save" (primary, with loading)
- **Drug Interaction Check** — happens automatically before save:
  - If interactions detected: shows Interaction Warning Modal first

#### Lab Order Modal
- Triggered by "Order Lab" button

**Content:**
- Priority dropdown: ROUTINE | URGENT | STAT
- One or more Test Rows:
  - Test name text input
  - Test code text input (optional)
  - Remove button
- "Add Test" button
- Footer buttons: "Cancel" + "Save"

---

#### Behavior Notes (Important for UI)
- **Auto-save**: Form saves automatically 600ms after the last change while encounter is in DRAFT. Show a subtle "Saved" indicator.
- **Interaction warning**: Before submitting a prescription, the system checks for drug interactions. If found, shows a warning modal with the interaction details and options to "Proceed Anyway" or "Cancel".
- **Amend**: A SUBMITTED encounter can be "amended" — this creates a new DRAFT copy that the doctor can edit. The original is preserved.

---

### 21. Patient Record Page
**Route:** `/doctor/patients`  
**Access:** DOCTOR role

#### Purpose
Doctor's full view of any of their patients' complete medical record. Used for reviews outside of an active encounter.

#### Layout
- Patient selector at top
- All sections below (only visible once patient is selected)

**Patient Selector**
- Searchable dropdown: "Select a patient"
- Populated with doctor's own patient list
- Shows patient full name or email

---

**Once patient is selected, 7 sections appear:**

**Section 1 — AI Scribe Panel**
- Optional AI-assisted documentation
- Expandable panel
- Listens to or takes text input, generates structured clinical notes

**Section 2 — Vital Signs**
- Trend chart (line chart, only shown if 2+ data points):
  - Multiple lines: BP systolic, BP diastolic, Heart Rate, etc.
- "Record Vitals" subheading + form:
  - Same fields as encounter vitals form
  - Submit button: "Save Vitals"
  - After save: form collapses, "Record Vitals" button appears to re-show it
- "History" subheading:
  - Table of all past vitals (newest first)
  - Date, BP, HR, Temp, O2, Weight, Height

**Section 3 — Medical Records**
- Existing records (read-only display):
  - Version badge (v1, v2, v3)
  - "CURRENT" badge on latest
  - Date + doctor name
  - Diagnosis text
  - Treatment plan text
- "Add Medical Record" form:
  - Chief complaint input
  - Diagnosis textarea
  - Treatment plan textarea
  - "Add Record" button

**Section 4 — Clinical Notes**
- Existing notes:
  - Each: specialty, doctor name, date, note body
- "Add Note" form:
  - Specialty category dropdown (options = doctor's own specialties)
  - Note body textarea
  - "Add Note" button (disabled if no category or empty body)

**Section 5 — Prescriptions**
- Existing prescriptions:
  - Date issued
  - Drug names list
  - "ACTIVE" or "VOIDED" badge
  - For ACTIVE, if authored by this doctor:
    - "Open PDF" button
    - ✏️ Reissue button (copies items to new prescription form, with confirm dialog)
    - 🚫 Void button → inline void form (same as encounter sidebar)
  - For VOIDED: voided date, voided by, reason
- "New Prescription" form:
  - Same as encounter prescription form (medication rows, notes)
  - "Issue Prescription" button (with interaction check)

**Section 6 — Scans / Labs**
- Existing scans list:
  - Category, filename, date, uploader
  - "Download" button
  - "Delete" button (🗑, red) — with confirmation dialog
- Lab results list:
  - Test name, result value, unit
- "Upload Scan" form:
  - Category dropdown
  - File input (jpg, png, pdf, dcm)
  - "Upload Scan" button

**Section 7 — Medical Timeline**
- PatientTimeline component
- Same as patient's own timeline view
- Read-only from doctor's perspective

---

### 22. Schedule Management Page
**Route:** `/doctor/schedule`  
**Access:** DOCTOR role

#### Purpose
Doctor sets their weekly availability for appointments.

#### Layout
Two sections: create form + current schedule list.

**Create Schedule Section**
| Field | Type | Notes |
|-------|------|-------|
| Day of Week | Dropdown | Monday – Sunday |
| Start Time | Time input | e.g., "09:00" |
| End Time | Time input | e.g., "17:00" |
| Slot Duration | Number input | Minutes (min 5), e.g., "30" |
- "Add Schedule" button

**Current Schedule List**
- One card per schedule entry:
  - Day name (e.g., "Monday")
  - Time range (e.g., "09:00 – 17:00")
  - Slot duration (e.g., "30 min slots")
  - "Remove" button (with confirmation)

#### States
- **Empty** — "No schedule set yet" with instruction
- **Loading** — skeleton rows

---

### 23. Doctor Reviews Page
**Route:** `/doctor/reviews`  
**Access:** DOCTOR role

#### Purpose
Doctor reads patient reviews and ratings for their profile.

#### Layout
- Review summary at top
- Review list below

**Summary Card**
- Average star rating (large, e.g., "4.7 ★")
- Total visible review count
- Star distribution could be shown as a mini bar chart

**Review List**
- Each review card:
  - Star rating (5 stars visual)
  - Comment text (or "No comment" if empty)
  - Date
  - "HIDDEN" badge if hidden by manager
- If no reviews: "No reviews yet"

#### States
- **Loading** — skeleton cards

---

### 24. Lab Orders List Page
**Route:** `/doctor/lab-orders`  
**Access:** DOCTOR role

#### Purpose
Doctor views all lab orders they've placed, with status tracking.

#### Layout
- KPI widgets at top
- Filter bar
- Lab orders table

**KPI Widgets (same as dashboard)**
- Pending Orders count
- Critical Results count (red)

**Status Filter**
- Dropdown or tabs: All | DRAFT | ORDERED | SAMPLE_COLLECTED | PROCESSING | COMPLETED

**Lab Orders Table**
| Column | Notes |
|--------|-------|
| Order # | e.g., "LAB-2024-001", link to detail |
| Patient Name | Clickable |
| Status | Status badge |
| Priority | ROUTINE / URGENT / STAT badge |
| Date | Formatted |
| Actions | "View" link button |

- Paginated: 20 per page
- Pagination controls at bottom

#### States
- **Loading** — skeleton table
- **Empty** — "No lab orders found"

---

### 25. Create Lab Order Page
**Route:** `/doctor/lab-orders/new`  
**Access:** DOCTOR role

#### Purpose
Doctor creates a new lab order for a patient.

#### Layout
Single-column form.

**Form Fields**
| Field | Type | Notes |
|-------|------|-------|
| Patient | Searchable dropdown | From doctor's patient list |
| Priority | Dropdown | ROUTINE / URGENT / STAT |
| Clinical Notes | Textarea | Context for the lab technician |

**Lab Tests Section**
- Dynamic list of test rows:
  - Test Name (text, required)
  - Test Code (text, optional)
  - Notes (text, optional)
  - Remove row button
- "Add Test" button

**Submit Buttons (two separate)**
- "Save as Draft" — saves without submitting
- "Submit Order" — creates and immediately submits

#### States
- **Loading** — button spinner
- **Success** — redirect to lab orders list with success toast

---

### 26. Lab Order Details Page
**Route:** `/doctor/lab-orders/:id`  
**Access:** DOCTOR (own orders), SECRETARY, MANAGER

#### Purpose
View full details of a single lab order, enter results, and advance workflow status.

#### Layout
- Status timeline at top
- Two columns: Order info + Test details

**Lab Status Timeline**
- Visual progress bar/steps:
  - DRAFT → ORDERED → SAMPLE_COLLECTED → PROCESSING → COMPLETED
  - Current step highlighted

**Order Info Grid**
| Field | Value |
|-------|-------|
| Patient | Name |
| Ordering Doctor | Name |
| Priority | Badge |
| Date Ordered | Formatted |
| Clinical Notes | Text |

**Tests Section**
- Table of ordered tests:
  | Test Name | Test Code | Notes |
  |-----------|-----------|-------|

**Results Section (if COMPLETED)**
- "CRITICAL RESULT" alert banner (red) if any result is critical
- Results table:
  | Test | Result | Unit | Reference Range | Date | Status |
  |------|--------|------|-----------------|------|--------|
- Critical rows: red background
- Abnormal rows: orange background
- "Download Result File" button per test (if file attached)

**Result Entry Form (PROCESSING status, secretary/manager only)**
- For each test, entry fields:
  - Result value
  - Unit
  - Reference range
  - Result date
  - File upload
  - "Abnormal" checkbox
  - "Critical" checkbox
- "Add Test" button (if more tests needed)
- "Submit Results" button

**Action Buttons (bottom, based on status + role)**
| Action | When Shown | Who Can |
|--------|-----------|---------|
| Submit Order | Status = DRAFT | Doctor, Manager |
| Collect Sample | Status = ORDERED | Secretary, Manager |
| Start Processing | Status = SAMPLE_COLLECTED | Secretary, Manager |
| Review & Close | Status = COMPLETED | Doctor, Manager |
| Delete Order | Status = DRAFT | Doctor, Manager |

---

## SECRETARY PAGES

---

### 27. Secretary Dashboard
**Route:** `/secretary/dashboard`  
**Access:** SECRETARY, MANAGER

#### Purpose
Secretary's home page — quick access to daily tasks.

#### Layout
- Welcome greeting
- Lab KPI widgets (same as doctor dashboard)
- Quick Actions card

**Quick Actions Card**
- Large link buttons:
  - "Appointment Desk" → `/secretary/appointments`
  - "Lab Orders & Samples" → `/secretary/samples`
  - "Manage Doctors" → `/secretary/doctors`

---

### 28. Appointment Desk Page
**Route:** `/secretary/appointments`  
**Access:** SECRETARY, MANAGER

#### Purpose
Secretary confirms or cancels patient appointments.

#### Layout
- Status filter tabs
- Appointment list

**Status Filter**
- Tabs: All | PENDING | CONFIRMED | CHECKED_IN | IN_PROGRESS | COMPLETED | CANCELLED

**Appointment List**
- Each appointment card:
  - Patient name (bold)
  - Doctor name
  - Date and time
  - Status badge
  - "Confirm" button (PENDING only) — changes status to CONFIRMED
  - "Cancel" button (PENDING or CONFIRMED only) — cancels appointment

#### States
- **Loading** — skeleton rows
- **Empty** — "No appointments found for this status"

---

### 29. Queue Board Page
**Route:** `/secretary/queue`  
**Access:** SECRETARY, MANAGER

#### Purpose
Secretary manages the walk-in queue for a selected doctor — the physical front desk screen.

#### Layout
Two panels: Walk-In Panel + Queue Display Panel

**Doctor Selector (top)**
- Dropdown: "Select a Doctor"
- Must be selected before anything else is shown

---

**Left Panel — Add Walk-In**
(Shown only after doctor is selected)

**Patient Search**
- Search input: "Search patient by name or phone"
- Results dropdown: Shows matching patients (name + phone)
- Select a patient from results OR:

**Register New Patient**
- "Register Patient" button → opens RegisterPatientModal

**Edit Patient Profile**
- After patient selected: "Edit Profile" button → opens PatientProfileEditorModal

**Walk-In Options**
- "Emergency" checkbox — marks as EMERGENCY priority
- "Add Walk-In" button (primary) — adds patient to queue

---

**Right Panel — Current Queue**
- Headline: "Queue for Dr. [Name]"
- Auto-refreshes every 20 seconds
- Shows: CONFIRMED, CHECKED_IN, IN_PROGRESS statuses only
- Sorted by: emergency first, then time

**Each Queue Row**
- Patient name
- Appointment type badge (EMERGENCY, WALK_IN) if applicable
- Status badge
- "Mark as Emergency" button (shown if not already emergency)
- **Action button** (changes by status):
  - CONFIRMED → "Check In"
  - CHECKED_IN → "Start"
  - IN_PROGRESS → "Complete"

---

### 30. Doctors Page
**Route:** `/secretary/doctors`  
**Access:** SECRETARY, MANAGER

#### Purpose
Secretary manages doctor profile details visible to the system (room number, bio, availability).

#### Layout
- List of all doctor cards (one per doctor)

**Doctor Card**
- Doctor name + specialties (read-only header)
- Editable fields:
  | Field | Type | Notes |
  |-------|------|-------|
  | Room Number | Text input | Where they see patients |
  | Bio | Textarea | Profile bio for public page |
  | Accepting Patients | Toggle/Checkbox | Shows/hides from public booking |
- "Save" button per card

#### States
- **Saving** — button spinner
- **Saved** — success toast

---

### 31. Patient Directory Page
**Route:** `/secretary/patients`  
**Access:** SECRETARY, MANAGER

#### Purpose
Secretary searches and edits patient records.

#### Layout
- Search bar at top
- Patients table
- "Register New Patient" button

**Search Bar**
- Text input: "Search by name, phone, or email"
- Real-time filtering or submit-on-enter

**Patients Table**
| Column | Notes |
|--------|-------|
| Full Name | Bold |
| Phone | |
| Email | |
| Date of Birth | Formatted |
| Actions | "Edit Profile" button |

**"Edit Profile" → PatientProfileEditorModal**
**"Register Patient" button (top-right) → RegisterPatientModal**

#### States
- **Loading** — skeleton table
- **No results** — "No patients found" for search term

---

### 32. Sample Collection Page
**Route:** `/secretary/samples`  
**Access:** SECRETARY, MANAGER

#### Purpose
Lab sample collection workflow — secretary advances lab orders through the collection and processing pipeline.

#### Layout
Three tabs, each showing a different pipeline stage.

**Tab 1 — ORDERED (Pending Collection)**
- List of lab orders awaiting sample collection
- Each row:
  - Order number (link to detail page)
  - Patient name
  - Date ordered
  - Priority badge (if URGENT or STAT)
  - "Collect Sample" button (primary)

**Tab 2 — SAMPLE_COLLECTED (Pending Processing)**
- List of orders where sample has been collected
- Each row:
  - Same columns as above
  - "Start Processing" button (primary)

**Tab 3 — PROCESSING (Enter Results)**
- List of orders being processed
- Each row:
  - Same columns
  - "Enter Results" link → goes to lab order details page

**Tab badges**
- Each tab shows a count badge: e.g., "Ordered (5)"

#### States
- **Loading** — all three tabs load simultaneously
- **Empty tab** — "No orders in this stage"

---

### 33. Doctor Absence Page
**Route:** `/secretary/absences`  
**Access:** SECRETARY, MANAGER

#### Purpose
Record doctor absences (vacation, sick leave, conference, etc.) to block off scheduling.

#### Layout
Two sections: create form + existing absences list.

**Create Absence Form**
| Field | Type | Options |
|-------|------|---------|
| Doctor | Dropdown | All doctors |
| Start Date | Date picker | |
| End Date | Date picker | Must be ≥ start date |
| Absence Type | Dropdown | VACATION, SICK, CONFERENCE, BLOCKED_DATE, OTHER |
| Reason | Textarea | Optional description |
- "Create Absence" button → confirm dialog before creating

**Absences List**
- Grouped or listed:
  - Doctor name
  - Absence type (with icon or badge)
  - Date range (e.g., "Jun 20 – Jun 25")
  - Reason text

#### States
- **Success** — confirmation toast, list refreshes
- **Empty list** — "No absences recorded"

---

## MANAGER PAGES

---

### 34. Manager Dashboard
**Route:** `/manager/dashboard`  
**Access:** MANAGER

#### Purpose
High-level clinic performance overview for the month.

#### Layout
- Welcome greeting: "Good morning, [Name]!"
- KPI cards row
- Quick actions

**KPI Cards (5 cards in a row)**
| Card | Value Type | Notes |
|------|-----------|-------|
| Total Appointments | Number | This month |
| Completed | Number | Green |
| No-Shows | Number | Orange/red |
| Avg. Wait Time | Minutes | e.g., "14 min" |
| New Patients | Number | This month |

**Quick Actions**
- Link cards/buttons:
  - "View Reports" → `/manager/reports`
  - "Moderate Reviews" → `/manager/reviews`
  - "Audit Log" → `/manager/audit`

---

### 35. User Management Page
**Route:** `/manager/users`  
**Access:** MANAGER

#### Purpose
Manager manages all system users (doctors, secretaries, patients) — activate/deactivate, reset passwords, edit profiles.

#### Layout
- Role tabs at top
- Search bar
- "Add New" button (role-specific)
- Users table

**Role Tabs**
- Doctors | Secretaries | Patients

**Search Bar**
- Text input: "Search by name or email"

**"Add New" Button Actions**
- Doctors tab → "Create Doctor" → `/manager/create-doctor`
- Secretaries tab → opens CreateSecretaryModal
- Patients tab → opens RegisterPatientModal

**Temp Password Display (conditional)**
- Yellow banner box showing temporary password after a reset
- "Copy" button
- Dismissible

**Users Table**
| Column | Notes |
|--------|-------|
| Full Name | Bold |
| Email | |
| Phone | |
| Status | Active (green) / Inactive (red) badge |
| Date Joined | Hidden on mobile |
| Actions | 3 buttons |

**Per-User Actions**
- "Edit" button → UserEditModal
- "Reset Password" button → generates temp password, shows it in the banner above
- "Deactivate" / "Reactivate" button (toggles)

---

### 36. Create Doctor Page
**Route:** `/manager/create-doctor`  
**Access:** MANAGER

#### Purpose
Manager creates a new doctor account with full credentials.

#### Layout
Single-column form.

**Form Fields**
| Field | Type | Notes |
|-------|------|-------|
| First Name | Text | Required |
| Last Name | Text | Required |
| Email | Email | Required |
| Phone | Tel | Required |
| License Number | Text | Required |
| Room Number | Text | |
| Specialties | Multi-select | From specialties list |
| Bio | Textarea | |
| Photo | File input | Image |
| Password | Password | Optional (system generates if empty) |
- "Create Doctor" button

**Success Screen (shown after creation)**
- Doctor name confirmation
- Temporary password displayed in a highlighted box
- "Copy Password" button
- Two action buttons:
  - "Back to User Management"
  - "Create Another Doctor"

---

### 37. Reports Dashboard Page
**Route:** `/manager/reports`  
**Access:** MANAGER

#### Purpose
Analytics and performance reports for the clinic.

#### Layout
- Period selector + export buttons at top
- KPI summary
- Per-doctor performance table
- Ratings section
- Attendance section

**Period Selector**
- Segmented control or dropdown: This Week | This Month | All Time

**Export Buttons (top-right)**
- "Export PDF" button
- "Export CSV" button

**Overall KPIs (6 cards)**
| Card | Value |
|------|-------|
| Total Appointments | |
| Completed | |
| No-Shows | |
| Cancelled | |
| Avg. Wait Time | |
| New Patients | |

**Per-Doctor Performance Table**
| Doctor | Total | Progress Bar | No-Show Rate |
|--------|-------|-------------|--------------|
- Progress bar shows appointments relative to the highest-volume doctor

**Ratings Section**
- Note: "Most reviewed doctor: Dr. [Name]"
- Table:
  | Doctor | Avg Rating | Review Count |
  |--------|-----------|--------------|
  - Star rating shown visually

**Attendance Table**
| Doctor | Days Absent |
|--------|------------|

---

### 38. Review Moderation Page
**Route:** `/manager/reviews`  
**Access:** MANAGER

#### Purpose
Manager can hide/unhide patient reviews from public view.

#### Layout
- Review list (all doctors' reviews)

**Each Review Card**
- Star rating (visual)
- Doctor name
- Patient name
- Date
- Comment text
- "HIDDEN" badge (if currently hidden)
- "Hide" or "Unhide" toggle button

#### States
- **Loading** — skeleton cards
- **Empty** — "No reviews yet"

---

### 39. Audit Log Page
**Route:** `/manager/audit`  
**Access:** MANAGER

#### Purpose
Manager reviews all system actions for compliance and investigation.

#### Layout
- Filter bar at top
- Audit event list

**Filter Bar**
| Control | Type | Notes |
|---------|------|-------|
| Search | Text input | Searches actor email, model, object |
| Action | Dropdown | Filter by action type (CREATE, UPDATE, DELETE, LOGIN, etc.) |

**Audit Event Cards**
- Each card:
  - Action label (e.g., "UPDATED Prescription")
  - Model name (e.g., "Prescription")
  - Timestamp (date + time)
  - Actor: "by [email]"
  - Object: "on [object description]"
  - Changes diff (if UPDATE):
    - Table of: Field → Old Value → New Value
    - Each changed field shown as a row

#### Design Notes
- This is a power-user screen — prioritize readability and scanability
- Timestamps should be clear and consistent
- Diffs should be easy to read (consider monospace or two-column old/new layout)

---

## ACCOUNT SETTINGS

---

### 40. Notification Preferences Page
**Route:** `/account/notifications`  
**Access:** All authenticated roles

#### Purpose
User configures how they want to receive notifications.

#### Layout
Single settings card.

**Notification Channels Section**
- Toggle switches:
  - Email notifications on/off
  - SMS notifications on/off
  - In-app notifications on/off

**Reminder Settings Section**
- "Remind me X hours before appointment"
- Number input or dropdown (options: 1h, 2h, 6h, 12h, 24h)

**Save Button**
- "Save Preferences"

---

## SHARED MODALS & COMPONENTS

### RegisterPatientModal
Used by: Secretary Queue Board, Secretary Patient Directory, Manager User Management

**Fields:**
| Field | Type |
|-------|------|
| First Name | Text |
| Last Name | Text |
| Phone | Tel |
| Email | Email |
| Password | Password |
| Date of Birth | Date |

**Actions:** Cancel | Register

---

### PatientProfileEditorModal
Used by: Secretary Queue Board, Secretary Patient Directory

**Editable Fields:**
| Field | Type |
|-------|------|
| First Name | Text |
| Last Name | Text |
| Phone | Tel |
| Email | Email |
| Date of Birth | Date |

**Actions:** Cancel | Save

---

### UserEditModal (Manager)
Edits any user's basic info. Fields depend on role.

---

### CreateSecretaryModal (Manager)
Creates a new secretary account with credentials.

---

### Drug Interaction Warning Modal
Triggered automatically before saving any prescription with multiple medications.

**Content:**
- Warning headline: "Potential Drug Interactions Detected"
- List of interactions:
  - Drug A ↔ Drug B
  - Severity level (HIGH, MEDIUM, LOW)
  - Description of interaction
- Two buttons:
  - "Cancel — Edit Prescription" (secondary)
  - "Proceed Anyway" (danger)

---

### Vitals Form (Component used in multiple pages)
Fields:
| Field | Unit | Notes |
|-------|------|-------|
| Blood Pressure Systolic | mmHg | |
| Blood Pressure Diastolic | mmHg | |
| Heart Rate | bpm | |
| Temperature | °C | |
| O2 Saturation | % | |
| Weight | kg | |
| Height | cm | |

---

### MedicationItemRow (Component used in prescription forms)
Each row represents one medication in a prescription.

Fields:
| Field | Type | Notes |
|-------|------|-------|
| Drug Name | Searchable text | Can search catalog or type free text |
| Dosage Strength | Text | e.g., "500mg" |
| Dosage Form | Dropdown | Tablet, Capsule, Syrup, Injection, Cream, Inhaler, Other |
| Dosage Pattern | Dropdown | e.g., "1-0-1", "1-1-1", "0-0-1" |
| Frequency | Text | e.g., "Twice daily" |
| Duration | Text | e.g., "7 days" |
| Instructions | Text | e.g., "Take after food" |
| Remove | Button 🗑 | Disabled if only one row |

---

## DESIGN TOKENS & STATUS COLORS

### Appointment Status Colors
| Status | Hex Suggestion | Use |
|--------|---------------|-----|
| PENDING | `#F59E0B` (amber) | Awaiting confirmation |
| CONFIRMED | `#3B82F6` (blue) | Confirmed appointment |
| CHECKED_IN | `#06B6D4` (cyan) | Patient arrived |
| IN_PROGRESS | `#8B5CF6` (purple) | Currently being seen |
| COMPLETED | `#10B981` (green) | Visit done |
| CANCELLED | `#6B7280` (gray) | Cancelled |

### Lab Order Status Colors
| Status | Color Suggestion |
|--------|-----------------|
| DRAFT | Gray |
| ORDERED | Blue |
| SAMPLE_COLLECTED | Orange |
| PROCESSING | Purple |
| COMPLETED | Green |

### Priority Colors
| Priority | Color |
|----------|-------|
| ROUTINE | Gray (default) |
| URGENT | Orange |
| STAT | Red |

### Alert Colors
| Type | Color |
|------|-------|
| CRITICAL result | Red background |
| ABNORMAL result | Orange background |
| ALLERGY warning | Red banner |
| Drug interaction | Amber/orange |

### Appointment Type Badges
| Type | Color |
|------|-------|
| EMERGENCY | Red |
| WALK_IN | Orange |
| SCHEDULED | Default/Blue |

---

## KEY UX PATTERNS TO IMPLEMENT

### 1. Bilingual Support (EN/AR)
- All UI text comes from translation keys — never hardcoded
- When Arabic is active, the **entire layout flips to RTL**
- Some textareas accept input in Arabic (marked with `dir="rtl"`)
- Language switcher is always accessible (header or settings)

### 2. Real-time Queue Updates
The following pages auto-refresh data silently:
- Doctor Queue Page → every **15 seconds**
- Secretary Queue Board → every **20 seconds**
- Patient appointments (when IN_PROGRESS) → every **30 seconds**
- Kiosk queue display → every **30 seconds**

Show a subtle "Last updated X seconds ago" indicator to let users know the data is live.

### 3. Form Auto-Save
The Encounter Page auto-saves 600ms after the last keystroke. The UI should:
- Show a subtle "Saving..." spinner or "Saved" checkmark indicator
- Never require the user to manually save mid-encounter (only the final "Submit" is intentional)

### 4. Inline Expanding Forms
Several actions expand inline rather than opening a modal:
- Leave a review (on My Appointments)
- Create a follow-up (on Doctor Appointments)
- Void a prescription (on Encounter sidebar)
This keeps the user in context. Design these as smooth expand/collapse animations.

### 5. Empty States
Every list/table needs a designed empty state:
- Friendly illustration or icon
- Descriptive text
- CTA button where relevant (e.g., "Book your first appointment")

### 6. Mobile Responsiveness
Key mobile considerations:
- Navigation collapses to a hamburger/bottom tab bar
- Date selectors on Doctor Detail become horizontal scroll
- Tables collapse to card view on mobile
- Kiosk page is always full-screen (tablet/large screen)

### 7. Loading Skeletons vs Spinners
- **Full page loads** → centered spinner
- **Card/section loads** → skeleton placeholder
- **Button actions** → button loading state (spinner in button)
- **Silent background refresh** → no UI interruption

---

*End of UI Design Specification — Version 1.0*
*Generated from codebase scan on 2026-06-27*
