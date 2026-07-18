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

Run Django scripts with the venv python and `PYTHONPATH=Backend`:

```bash
cd Backend && PYTHONPATH="$PWD" ./.venv/Scripts/python.exe <script.py>
```

E2E accounts (password `E2eTest123!`, created by past verification runs, safe to reuse):
`e2e.patient@test.dev`, `e2e.patient2@test.dev`, `e2e.doctor@test.dev` (DoctorProfile id 4),
`e2e.secretary@test.dev`, `e2e.manager@test.dev`.

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
