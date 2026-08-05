---
name: verify
description: How to launch and E2E-drive this clinic app (Django + Vite) for runtime verification.
---

# Verifying the Clinic System end-to-end

## Launch

```powershell
.\dev.ps1 restart     # backend :8000 (Django) + frontend :5173 (Vite); logs in .run\
.\dev.ps1 stop
```

Health check: `curl http://127.0.0.1:8000/api/auth/login/` → 405, `curl http://localhost:5173/` → 200.

## Seed / reset test data

Run Django management commands with the venv python and `PYTHONPATH=Backend`
(idempotent — safe to re-run anytime, only tops up what a prior round consumed):

```bash
cd Backend && PYTHONPATH="$PWD" ./.venv/Scripts/python.exe manage.py <command>
```

Per-phase one-shot fixtures (each jumps straight to its feature's test point instead
of walking registration → booking → check-in → queue every time):
- `seed_billing_e2e` — Phase 12 billing: clean CHECKED_IN walk-in for e2e.patient
  ready for "Call Next Patient" → "Complete Visit"; one invoice per status bucket
  (ISSUED/PARTIALLY_PAID/PAID).
- `seed_referrals_e2e` — Phase 13 referrals + complaints master: seeds the ~80-entry
  complaint master list; a clean CHECKED_IN walk-in for **e2e.patient2** (deliberately
  not e2e.patient, so it never collides with the billing fixture's walk-in) ready for
  "Call Next Patient" → "Refer Patient"; and one referral per lifecycle bucket
  (PENDING specialty-wide, ACCEPTED, COMPLETED, CANCELLED, PENDING EXTERNAL) between
  e2e.doctor (referring) and e2e.doctor2 (Cardiology, the receiving side).
- `seed_procedures_e2e` — Phase 14 clinical procedures: seeds the ProcedureTemplate
  catalog (Wound Suturing, Minor Skin Biopsy, Injection, Dressing Change, General); a
  clean CHECKED_IN walk-in for **e2e.patient3** (deliberately not e2e.patient/patient2,
  so it never collides with the billing/referrals walk-ins) ready for "Call Next
  Patient" → open encounter → "Add Procedure"; and one ClinicalProcedure per lifecycle
  bucket (SCHEDULED, IN_PROGRESS with checklist half-done, COMPLETED, CANCELLED),
  all performed by e2e.doctor.
- `seed_radiology_e2e` — Phase 15 radiology order templates: seeds the
  RadiologyTemplate catalog (Chest X-Ray, Abdominal Ultrasound, Head CT, Knee MRI,
  PET-CT Whole Body, Other); a clean CHECKED_IN walk-in for **e2e.patient4**
  (deliberately not e2e.patient/patient2/patient3, so it never collides with the
  billing/referrals/procedures walk-ins); and one RadiologyOrder per lifecycle bucket
  (ORDERED, COMPLETED with a real attached scan file, REPORTED with findings +
  impression filled in, CANCELLED), all ordered by e2e.doctor. Backend-only pass —
  no frontend page exists yet, so drive it via the API (see
  `Backend/tests/test_radiology.py`), e.g. `POST /api/radiology-orders/{id}/complete/`
  (multipart, `file` field) and `POST /api/radiology-orders/{id}/report/`.

E2E accounts (password `E2eTest123!`, created by past verification runs, safe to reuse):
`e2e.patient@test.dev`, `e2e.patient2@test.dev`, `e2e.patient3@test.dev`,
`e2e.patient4@test.dev`, `e2e.doctor@test.dev` (DoctorProfile id 4),
`e2e.doctor2@test.dev` (Cardiology — referral target), `e2e.secretary@test.dev`,
`e2e.manager@test.dev`.

## Browser driving

No Playwright browsers are cached, but **Edge + Chrome are installed** — use
`chromium.launch({ channel: 'msedge', headless: true })`. Install the `playwright`
npm module in the scratchpad (`npm i playwright`), never in Frontend/.

Gotchas:
- Login form: `input[type=email]`, `input[type=password]`, `button[type=submit]`.
- The `Select` primitive is a **custom combobox**, not `<select>`:
  click `[role=combobox]`, then `[role=option]` by text.
- "Logout" between roles: `context().clearCookies()` + `localStorage.clear()`.
- Toasts expire in ~4s — `waitForSelector` on the text immediately after the action.
- Language switcher lives in the header (`text=English` → `text=العربية`, use `.first()`).
- Print flows: `page.emulateMedia({ media: 'print' })` + add `print-invoice` class to body.
- Expect benign 401 console errors right after login-page loads (refresh-cookie probe).

## Flows worth driving

- Doctor: `/doctor/queue` → "Call Next Patient" → "Complete Visit" → billing popup.
- Secretary: `/secretary/billing` tabs + "Record Payment" modal (overpay → field-level error toast).
- Patient: `/patient/invoices`; isolation: patient2 sees empty; `/secretary/billing` → /403.
- Manager: `/manager/billing` KPIs + revenue table.
- Referrals (after `seed_referrals_e2e`): e2e.doctor → `/doctor/queue` → "Call Next
  Patient" (e2e.patient2) → open the encounter → "Refer Patient" (chief-complaint
  autocomplete here also exercises the complaints master). `/doctor/referrals` Sent tab
  shows all 5 seeded statuses. e2e.doctor2 → `/doctor/referrals` Received tab → Accept
  the PENDING one, Complete the ACCEPTED one. e2e.patient2 → `/patient/referrals`.
  e2e.secretary → `/secretary/referrals` (read-only, no reason/notes columns).
- Procedures (after `seed_procedures_e2e`): e2e.doctor → `/doctor/queue` → "Call Next
  Patient" (e2e.patient3) → open the encounter → "Add Procedure" (try both a template
  and the "Custom / free-text procedure" option) → open the linked row → "Start
  Procedure" → tick checklist → "Complete Procedure". Then `/doctor/patients` → select
  "Yara Fathy" → Procedures section has the 4 pre-seeded buckets: SCHEDULED (test
  Cancel), IN_PROGRESS (finish the checklist + required post-notes guard + Complete),
  COMPLETED (confirm fully locked/read-only), CANCELLED (confirm reason shown, no
  action buttons). No frontend page exists for PATIENT/MANAGER to browse procedures
  (matches the Phase 14 spec — doctor-only UI); their read/oversight access is
  API-level only, covered by `Backend/tests/test_procedures.py`. To eyeball the audit
  trail: `/manager/audit` (not `/manager/audit-log`) — its search box only matches
  `object_repr`/`object_id`/`actor__email` (see `apps/audit/views.py` search_fields),
  NOT `model_name`, so search by the procedure's name (e.g. "Biopsy", "Wound
  Suturing") or the doctor's email, not the literal string "ClinicalProcedure" — or
  just browse unfiltered, newest-first, right after driving the flow above.

## Gotcha found by driving past page 1

A list page that fetches one page then filters client-side by status will
silently drop matching rows once the table has more than one page (default
ordering is newest-first, so an old unpaid invoice ends up on page 2+).
Symptom is invisible in a small seeded dataset — only shows up once you seed
20+ rows. When touching any staff-facing "outstanding/pending" list, check
whether the status filter is applied server-side (`filterset_class` /
`?status=A,B`) before trusting a happy-path test with a handful of rows.
Regression test: `Backend/tests/test_billing.py::TestInvoiceFilterPagination`.

## Background jobs & WebSockets (Django-Q / Channels)

- `dev.ps1` also starts a third process, the Django-Q worker (`manage.py
  qcluster`, logs in `.run\worker.log`). AI Scribe transcription and outbound
  email/SMS/WhatsApp run there — if you stop it and only restart
  backend+frontend, those tasks queue up but never complete.
- Real-time queue updates use Django Channels with an **in-memory** channel
  layer (`CHANNEL_LAYERS` in settings/base.py) — pure in-process Python memory,
  not database-backed like the Django-Q broker. **A separate script/process
  can never trigger a real WebSocket push**, even though it can freely read/
  write the DB (SQLite) or enqueue Django-Q tasks (ORM-backed) from outside.
  To test a `group_send`, the triggering change MUST go through a real HTTP
  request to the running server (same process as the WebSocket consumers) —
  e.g. `requests.post(...)` against `127.0.0.1:8000`, not a standalone
  `django.setup()` script calling services directly. Symptom of getting this
  wrong: `group_send` logs "completed OK", the consumer's group looks correct,
  and nothing ever arrives — because it was queued into a channel layer
  instance nobody is listening on.
- React 19 StrictMode double-invokes effects in dev: expect **one spurious
  WebSocket open→close→open** within ~300ms of every page mount. When testing
  reconnect-after-server-restart, only trust close/open events that happen
  well after that initial ~1s settle window, or you'll mistake StrictMode
  noise for a real reconnect (and vice versa — a genuine drop that happens to
  land inside that window could get misread as StrictMode).
- To simulate a backend crash/deploy safely, kill by PID only (`Stop-Process
  -Id <pid> -Force`) — never `dev.ps1 stop` mid-test, it also tears down the
  worker and frees ports. Restart with the exact same `Start-Process` args
  `dev.ps1` uses (`manage.py runserver 127.0.0.1:8000`) and remember to patch
  `.run\pids.json`'s `backend` field with the new PID afterward, or later
  `dev.ps1 stop/restart` calls will miss it.
