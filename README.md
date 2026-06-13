# 🏥 Clinic Management System

A full-stack, elder-friendly, multilingual (English + Arabic, RTL-aware) clinic
management system. **Django REST Framework** backend + **React (TypeScript + Vite)**
frontend + **SQLite**. Four roles — Patient, Doctor, Secretary, Manager — with
strict, API-level role-based access control.

This repository implements **Phase 1 (Core)** and **Phase 2 (Medical)**. The full
project scaffold, the complete data model (all ~20 tables migrated), and the
cross-cutting infrastructure (JWT auth, RBAC, audit logging, notifications, the
elder-friendly design system, i18n/RTL) are in place.

**Phase 1 — Core** (working end-to-end):
- Authentication (login / refresh / logout / register / password reset)
- Doctor profiles + working schedules → auto-generated bookable time slots
- Patient appointment booking (Pending → Confirmed) with a calendar slot picker
- Secretary appointment desk (confirm / cancel) and doctor profile editing
- Doctor queue + appointment status flow (check-in → start → complete)
- Public, no-login **waiting-room kiosk** (per doctor, auto-refreshes every 30 s)
- Manager audit log (searchable who / what / old-value / when)

**Phase 2 — Medical** (working end-to-end):
- Patient medical background (chronic conditions, surgeries, medications, allergies)
- Version-tracked clinical records (append-only; an edit creates a new version)
- Clinical notes **tagged to a specialty** — a doctor can only write notes within
  their own specialty category
- Scan + lab-result uploads (JPG/PNG/PDF/DICOM) with **permission-checked download**
- Prescriptions with line items and a **printable PDF** (reportlab)
- Access strictly scoped: patients see only their own data; doctors only patients
  they have treated (via a completed visit); secretaries are excluded; managers see all

**Phase 3 — Operations** (working end-to-end):
- Appointment **reminders** (24h / 1h) via the `send_reminders` command, honoring
  per-user channel + reminder preferences (idempotent, no double-sends)
- Secretary **queue board**: live per-doctor queue, **add walk-in**, **mark emergency**
  (emergencies bump to the front of the queue and the public kiosk)
- **Waitlist auto-notify**: when a booked slot is cancelled, the earliest matching
  waiting patient is notified that a slot opened (with a hold window)
- **Doctor absence**: marking a doctor absent blocks their slots, cancels booked
  appointments, and sends affected patients an **absence** notification to rebook
- **Notification preferences** page (all roles): toggle in-app / email / SMS and
  24h / 1h reminders. SMS stays optional (Twilio, off by default)

**Phase 4 — Intelligence** (working end-to-end):
- **Doctor reviews**: after a completed visit the patient is prompted to rate (1–5)
  + comment; ratings drive the public doctor directory; doctors read their own
  reviews; **managers moderate** (hide/unhide) — hidden reviews drop from the public
  average; secretaries can't see reviews
- **Follow-up scheduling**: a doctor recommends a follow-up from a completed visit;
  the system suggests the next open slot; the patient confirms (booked as a
  `FOLLOW_UP` visit) or dismisses
- **Manager reports dashboard**: appointments per doctor, no-show rate, average wait,
  ratings, new patients, doctor attendance — with **PDF + CSV export**
- **Audit log** UI (built in P1) rounds out the manager's oversight tools

All four phases of the original blueprint are now implemented.

### Background jobs

```bash
cd Backend
.venv\Scripts\python.exe manage.py send_reminders          # one-shot (reminders + waitlist expiry)
.venv\Scripts\python.exe manage.py send_reminders --loop   # demo: repeat every 60s
```

For production, run `send_reminders` every few minutes via **Windows Task Scheduler**
(or cron). To enable SMS: uncomment `twilio` in `requirements.txt`, `pip install -r`,
set `SMS_ENABLED=True` + `TWILIO_*` in `.env`, and have users opt in under Settings.

## Quick start (one command each)

From the repo root, after a one-time setup (see below):

```
.\start.cmd      # start backend (:8000) + frontend (:5173) together
.\stop.cmd       # stop both cleanly
.\status.cmd     # show what's running    (.\restart.cmd to restart)
```

These wrap `dev.ps1` (`.\dev.ps1 start|stop|restart|status`). Logs stream to
`.run\backend.log` and `.run\frontend.log`. The runner does **not** install
anything — do the one-time setup below first.

---

## Requirements

- **Python 3.14** (3.13 also fully supported) — verified on Windows
- **Node.js 20.19+ / 22.12+ / 24** and npm

---

## Backend — run locally

```bash
cd Backend
py -3.14 -m venv .venv
.venv\Scripts\activate            # Windows  (source .venv/bin/activate on macOS/Linux)
pip install -r requirements.txt

copy .env.example .env            # then edit if needed (cp on macOS/Linux)

python manage.py migrate
python manage.py seed_data        # demo users, doctors, slots, appointments, kiosk queue
python manage.py generate_slots   # (seed already does this; run anytime to top up)
python manage.py runserver        # http://127.0.0.1:8000
```

The API is under `http://127.0.0.1:8000/api/`. Django admin is at `/admin/`
(log in as the manager — it is a superuser).

### Seeded demo accounts (password `Clinic123!`)

| Role | Email |
|---|---|
| Manager | `manager@clinic.test` |
| Secretary | `secretary@clinic.test` |
| Doctors | `dr.adams@clinic.test`, `dr.benali@clinic.test`, `dr.chen@clinic.test` |
| Patients | `patient1@clinic.test` … `patient4@clinic.test` |

### Backend tests

```bash
cd Backend
.venv\Scripts\python.exe -m pytest      # 38 tests across all 4 phases: auth, RBAC, slots,
                                        # booking + rebook, medical records/notes/scans/PDF,
                                        # reminders, waitlist, walk-in/emergency, absence,
                                        # reviews + moderation, follow-ups, reports + export
```

> `seed_data` also creates sample medical data: each doctor has a treated patient
> (from a completed visit) with a medical record, a prescription, and a lab result,
> so the Phase 2 screens are populated immediately.

---

## Frontend — run locally

```bash
cd Frontend
npm install
npm run dev                       # http://localhost:5173
```

The Vite dev server proxies `/api` and `/media` to the Django server on port 8000,
so start the backend first. Open `http://localhost:5173` and sign in with any
seeded account above. The public kiosk is at `http://localhost:5173/kiosk/1`
(no login required); the public doctor directory is at `/doctors`.

```bash
npm run build                     # type-check + production build
npm run lint
```

---

## Architecture notes

- **Auth**: SimpleJWT. The access token is returned in the login response body and
  kept **in memory only**; the refresh token is set as an **httpOnly cookie** and
  read by `/api/auth/refresh/`. The Axios client attaches the bearer token and
  performs a single-flight refresh on 401.
- **RBAC (3 layers)**: `IsAuthenticated` globally → role permission classes
  (`apps/users/permissions.py`) → per-viewset `get_queryset()` scoping +
  `has_object_permission()`. Patients see only their own data; doctors see only
  patients they have treated (the `DoctorPatient` link); secretaries never see
  review comments; managers see everything.
- **Slots**: generated from `WorkingSchedule` by `apps/doctors/services/slot_generator.py`
  (idempotent). Booking flips a slot to `BOOKED` under `select_for_update` inside a
  transaction; a DB unique constraint prevents double-booking. Saving a working day
  generates its slots immediately.
- **Signals**: appointment status changes raise notifications (in-app + email;
  console email backend in dev). A thread-local middleware + generic signal
  receivers write the `AuditLog`.
- **Append-only medical data**: `MedicalRecord`/`ClinicalNote` use a version chain +
  soft-delete; nothing in `medical_records` is ever hard-deleted.
- **Elder-friendly UI**: in-house CSS-token design system (`src/theme/tokens.css`) —
  ≥18px body / 20px actions, 48px tap targets, AA-contrast colour pairs, visible
  focus rings, plain-language errors, confirm dialogs for every destructive action,
  spinners/skeletons (no blank screens). RTL via `dir` + CSS logical properties.
- **i18n**: i18next with `en.json` / `ar.json`; Arabic flips the layout to RTL;
  language preference is persisted to the user profile (localStorage for guests).

---

## Scheduled jobs (later phases)

Reminders, waitlist expiry, and slot top-up are management commands designed to run
on a scheduler (no Celery required):

```bash
python manage.py generate_slots        # available now — top up the booking horizon
# python manage.py send_reminders      # Phase 3 — wire to Windows Task Scheduler / cron
```

Run `generate_slots` (and, in Phase 3, `send_reminders`) every few minutes via
**Windows Task Scheduler** (or cron). All logic lives in service functions, so a
later move to Celery beat is a scheduler swap, not a rewrite.

---

## Extensibility hooks

- **Payments**: `DoctorProfile.consultation_fee` is already present; add a billing app.
- **SMS**: set `SMS_ENABLED=True` + Twilio creds in `.env` (`pip install twilio`).
- **PostgreSQL**: set `DATABASE_URL=postgres://…` — the ORM is DB-agnostic.
- **Video / new notification channels**: the notification backend registry
  (`apps/notifications/backends.py`) accepts new channels without touching callers.

---

## Project layout

```
Backend/   Django project (clinic_project/) + apps/ (core, users, doctors,
           appointments, medical_records, reviews, notifications, reports, audit)
Frontend/  Vite + React + TS SPA (src/: pages by role, components, services, i18n, theme)
```
