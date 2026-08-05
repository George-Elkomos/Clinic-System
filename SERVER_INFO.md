# Server Info — Clinic-System

Reference for anyone working on this project who needs to understand how and
where it's deployed. For the step-by-step history of *how* this was built,
see `Django_VPS_Deployment_Master_Plan.md`. This file is the current-state
operations reference — what's true right now, and how to do common tasks.

For general knowledge about the *server itself* (shared with any other
project that might be hosted on the same box later), see the
`Server-Documentation/` folder — that one isn't part of this repo.

---

## Where it lives

| | |
|---|---|
| Live URL | `https://clinicms.duckdns.org` |
| Server | Contabo VPS, `213.199.47.114`, root access via SSH |
| App directory | `/var/www/clinic_app` (this repo, cloned at its root) |
| Backend | `/var/www/clinic_app/Backend` (Django, venv at `Backend/venv`) |
| Frontend | `/var/www/clinic_app/Frontend` (React/Vite, built to `Frontend/dist`, served as static files by Nginx) |

## Architecture

```
Browser ──HTTPS──> Nginx (sites-available/clinic_app)
                     ├─ /              → Frontend/dist (static SPA, try_files fallback)
                     ├─ /static/       → Backend/staticfiles (alias)
                     ├─ /media/        → Backend/media (alias)
                     ├─ /api/, /admin/ → proxy → 127.0.0.1:8000 (Daphne)
                     └─ /ws/           → proxy (WebSocket upgrade) → 127.0.0.1:8000 (Daphne)
```

- **Daphne** (`clinic-daphne.service`) — ASGI server, not Gunicorn. Required
  because of the real-time WebSocket doctor-queue feature (Django Channels).
  Runs as **exactly one process** — `CHANNEL_LAYERS` is
  `InMemoryChannelLayer` (see `Backend/clinic_project/settings/base.py`), so
  its WebSocket state only exists in one process's memory. Do not scale this
  to multiple instances without first switching to `channels_redis`.
- **Django-Q2 worker** (`clinic-qcluster.service`) — background task queue
  for AI Scribe transcription and outbound email/SMS/WhatsApp. Without it
  running, those tasks queue forever and never execute.
- **Cron** (`/etc/cron.d/clinic-app`) — `send_reminders` every 5 minutes,
  `generate_slots` hourly.

## Checking status / logs

```bash
systemctl status clinic-daphne clinic-qcluster --no-pager
journalctl -u clinic-daphne -n 100 --no-pager     # app crash tracebacks live here, not in deploy logs
journalctl -u clinic-qcluster -n 100 --no-pager
cat /var/log/clinic-deploy.log                    # full output of the most recent deploy attempt
```

## Environment variables

`Backend/.env` on the server (never committed — see `Backend/.env.example`
for the full annotated template). Current production values, by category:

| Variable | Current value | Notes |
|---|---|---|
| `SECRET_KEY` | (random, generated on server) | Never share/commit |
| `DEBUG` | `False` | |
| `ALLOWED_HOSTS` | `213.199.47.114,clinicms.duckdns.org` | |
| `DATABASE_URL` | `sqlite:///db.sqlite3` | |
| `CORS_ALLOWED_ORIGINS` | `https://clinicms.duckdns.org` | Same-origin serving makes this mostly moot, kept for safety |
| `CSRF_TRUSTED_ORIGINS` | `https://clinicms.duckdns.org` | Needed for HTTPS behind the Nginx proxy |
| `JWT_COOKIE_SECURE` | `True` | Requires real HTTPS — it is now live |
| `SECURE_SSL_REDIRECT` / `SESSION_COOKIE_SECURE` / `CSRF_COOKIE_SECURE` | `True` | Flipped on once Certbot HTTPS was confirmed working |
| `EMAIL_BACKEND` | console (not real SMTP) | App emails just log to `journalctl -u clinic-daphne`, not sent — flip to SMTP backend + `EMAIL_HOST`/`EMAIL_HOST_USER`/`EMAIL_HOST_PASSWORD` when ready |
| `AI_SCRIBE_ENABLED` | `False` | Off for now — needs a Gemini API key (free tier) to turn on, and ~3GB disk for the Whisper model on first use |
| `SMS_ENABLED` / `WHATSAPP_ENABLED` | `False` | Off — Twilio is the one dependency in this stack that would ever need a paid account |

## HTTPS

Let's Encrypt certificate via Certbot for `clinicms.duckdns.org` (free
DuckDNS domain — Let's Encrypt can't certify a bare IP). Auto-renews via
`certbot.timer` (`systemctl list-timers | grep certbot`) — nothing to do
manually, ever, unless the domain changes.

**If the domain or cert setup ever changes**: Certbot edits
`/etc/nginx/sites-available/clinic_app` directly. `deploy/nginx.conf` in
this repo must be re-synced to match afterward (`cat
/etc/nginx/sites-available/clinic_app` on the server, copy that exact
content into `deploy/nginx.conf`, commit) — otherwise the next automated
deploy overwrites Certbot's SSL block with the old config and silently
breaks HTTPS. This has already happened once during setup.

## CI/CD pipeline

`.github/workflows/deploy.yml` + `deploy/deploy.sh`, triggered on every push
to `main`:

- **`test`** and **`deploy`** jobs run **in parallel** (deploy does not wait
  for tests to pass — a deliberate tradeoff so the growing test suite never
  slows down how fast the server updates; tests still run and are reported).
- **`notify`** job always runs (success or failure of either job) and emails
  one combined log — `pytest` output + the server's full
  `/var/log/clinic-deploy.log` (including `journalctl` dumps if a service
  failed to start) — via Gmail SMTP (`MAIL_USERNAME`/`MAIL_PASSWORD` repo
  secrets, a Gmail **App Password**, not the real Gmail login password).
  `NOTIFY_EMAIL` accepts a comma-separated list for multiple recipients.
- **GitHub repo secrets required**: `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`
  (the deploy key — see `Server-Documentation/02-access-and-security.md`),
  `MAIL_USERNAME`, `MAIL_PASSWORD`, `NOTIFY_EMAIL`.

### Automatic rollback
`deploy.sh` records the commit before pulling. Step order is deliberate:
`git pull` → `pip install` → `collectstatic` → **`npm ci`/`npm run build`**
→ **`migrate`** → sync config → restart + health-check. Frontend build runs
*before* the database migration on purpose — it's the step most likely to
fail (e.g. a `package-lock.json` drift), and it doesn't touch the database,
so a frontend failure rolls back with zero database risk. `migrate` is the
last thing that can still fail before the schema actually changes.

If **any** step fails, `rollback()`:
1. `git reset --hard` back to the previous commit.
2. Restores `db.sqlite3` (+ `-wal`/`-shm`) from a pre-migrate backup —
   **whenever that backup is present**, not only when `migrate` itself was
   the failing step. The backup is deliberately kept on disk through the
   restart + health-check that follows `migrate`, so "migration succeeded
   but the new code then crashed on restart" *also* correctly reverts the
   schema, not just the code. (This exact gap caused a real incident once —
   a later, unrelated `npm ci` failure rolled the code back while the
   database stayed on the new schema, because the backup used to be deleted
   immediately after `migrate` succeeded. Reordering + delaying the backup
   cleanup fixed it.)
3. Restores `Frontend/dist` from a pre-build backup if `npm run build` failed
   partway.
4. Re-syncs the systemd/Nginx config files to the reverted commit's versions.
5. Restarts `clinic-daphne`/`clinic-qcluster` on the now-reverted code (this
   matters even if the failure *wasn't* a restart — a failed
   `systemctl restart` already killed the old process, so it must be
   explicitly relaunched).

Live services are never touched until `pip install`/frontend build/`migrate`
have all already succeeded — most failure modes never reach the running app
at all.

**A failed `systemctl restart` isn't the only failure mode checked** —
restart "succeeding" doesn't guarantee the process stayed up (systemd only
confirms it launched). After restarting, the script also checks
`systemctl is-active` and makes a real local HTTP request to Daphne; either
failing triggers the same rollback, with `journalctl -u clinic-daphne`
dumped into the log so the actual crash traceback is visible.

**Residual, much narrower risk**: if `migrate` succeeds and the restart/
health-check *also* succeeds (so the deploy is reported successful), but the
new code has some other startup-order-independent bug, that's just a normal
bug in the new code — not a rollback gap. The rollback only needs to (and
now does) protect against the schema and the running code ever being out of
sync with each other; it was never meant to catch every possible application
bug.

**Gotcha**: `deploy.sh` reads itself from disk at the start of its own
execution — so an edit to `deploy.sh` itself only takes effect starting the
push *after* the one that changed it (the currently-running instance
finishes using its old logic first).

## Manual operations

Only needed if you're debugging outside the normal CI/CD flow.

**Manual deploy** (same script CI runs):
```bash
bash /var/www/clinic_app/deploy/deploy.sh
```

**Manual rollback to a specific commit** (if you need something other than
"one commit back"):
```bash
cd /var/www/clinic_app
git reset --hard <commit-sha>
bash deploy/deploy.sh   # re-run to reinstall/rebuild/restart onto that commit
```

**Create/reset an admin user**:
```bash
cd /var/www/clinic_app/Backend
source venv/bin/activate
export DJANGO_SETTINGS_MODULE=clinic_project.settings.prod
python manage.py createsuperuser      # or: python manage.py changepassword <email>
```

**Run a one-off management command**:
```bash
cd /var/www/clinic_app/Backend
source venv/bin/activate
export DJANGO_SETTINGS_MODULE=clinic_project.settings.prod
python manage.py <command>
```

## Known limitations / not yet done

- **AI Scribe, real SMTP, SMS/WhatsApp** are all off — see the env var table
  above. Each just needs credentials added to `.env` + a `clinic-daphne`
  restart to enable.
- **No separate deploy user** — everything runs as `root` (see
  `Server-Documentation/02-access-and-security.md`).
- **Single Daphne instance only** — do not attempt to scale horizontally
  without first replacing `InMemoryChannelLayer` with `channels_redis`.
