# Django + React VPS Deployment & CI/CD Pipeline Guide

## 🤖 AI Agent Instructions
**Context:** Step-by-step master plan for deploying this repo (Django REST API +
React/Vite SPA, real-time via Django Channels) to a Linux VPS with an automated
GitHub Actions CI/CD pipeline.

**Server Details:**
*   **IP Address:** `213.199.47.114`
*   **User:** `root`
*   **Stack:** Python 3.14, Django 5.2 (DRF + Channels/Daphne + Django-Q2), SQLite,
    Nginx, Node.js/Vite (frontend build), GitHub Actions.

**Repo layout (this is NOT a flat Django repo — every path below accounts for it):**
```
/                       repo root
├── Backend/            manage.py, clinic_project/ (settings/base|dev|prod|test.py),
│                       apps/ (17 Django apps), requirements.txt, .env(.example)
├── Frontend/            Vite + React + TS SPA (builds to Frontend/dist)
└── deploy/              (to be added) systemd units, nginx conf, deploy.sh — tracked in git
```

**⚠️ Do not copy the original version of this plan verbatim.** It was written for
a generic single-app Gunicorn/WSGI project and does not match this repo:
Gunicorn cannot serve this app correctly (see Section 1.5), the frontend was
never mentioned, and two settings in the codebase actively conflict with an
IP-only HTTP deployment. Those are called out inline as **🔴 BLOCKER** —
fix before the first deploy — or **🟡 FOLLOW-UP** — safe to defer.

---

## Status: repo readiness (read this first)

| # | Item | State | Action |
|---|---|---|---|
| 1 | `Backend/db.sqlite3`, `-wal`, `-shm` are **tracked in git** | 🔴 BLOCKER | `git rm --cached` them + un-comment the 3 lines in root `.gitignore`. As-is, `deploy.sh`'s `git pull` will either refuse to run (local changes on server) or silently overwrite the production DB on every deploy. |
| 2 | `Backend/clinic_project/settings/prod.py` hardcodes `SECURE_SSL_REDIRECT = True` | 🔴 BLOCKER | With plain-HTTP nginx on port 80 (no domain/cert yet), every request 301-redirects to `https://213.199.47.114`, which nothing serves → site is 100% unreachable. Needs to become env-gated. |
| 3 | `JWT_COOKIE_SECURE` defaults to `not DEBUG` → `True` in prod | 🔴 BLOCKER (paired with #2) | Over plain HTTP the browser silently drops the `Secure` refresh cookie → login appears to work, then the user is instantly logged out. Set `JWT_COOKIE_SECURE=False` in the server `.env` until HTTPS exists. |
| 4 | No `CSRF_TRUSTED_ORIGINS` set anywhere | 🟡 FOLLOW-UP | Needed once `/admin/` is used behind HTTPS+proxy (Django requires it for cross-scheme POSTs). Not needed for the IP/HTTP phase. |
| 5 | `CHANNEL_LAYERS` uses `InMemoryChannelLayer` (`settings/base.py`) | ⚠️ constraint, not a bug | The real-time doctor queue only works correctly with **exactly one** ASGI process. This rules out Gunicorn's `--workers 3` and any horizontal scaling until this is swapped for `channels_redis`. |
| 6 | `Q_CLUSTER` (Django-Q2) needs its own long-running worker process | ⚠️ missing from original plan | AI Scribe transcription and all outbound email/SMS/WhatsApp go through `manage.py qcluster`. Without a dedicated service, they queue forever and never run. |
| 7 | `send_reminders` / `generate_slots` are periodic management commands | ⚠️ missing from original plan | README says "run via Windows Task Scheduler (or cron)" — VPS needs actual cron entries. |
| 8 | Frontend (`Frontend/`, React + Vite, client-side routing via `createBrowserRouter`) | ⚠️ missing entirely from original plan | Needs a build step (`npm ci && npm run build`) and Nginx must serve `Frontend/dist` with SPA fallback (`try_files $uri /index.html`), plus proxy `/api/`, `/media/`, `/admin/`, `/static/`, `/ws/` to the backend. |
| 9 | Nginx default `client_max_body_size` is 1 MB | ⚠️ missing from original plan | App allows 25 MB uploads (scans/labs) and 80 MB audio (AI Scribe). Must raise to e.g. `100M` or every upload gets a 413. |
| 10 | `manage.py` / `wsgi.py` / `asgi.py` all `os.environ.setdefault(..., "clinic_project.settings.dev")` | ⚠️ config discipline, not a bug | `setdefault` only applies if `DJANGO_SETTINGS_MODULE` isn't already set — so as long as every systemd unit and the deploy script **explicitly export** `DJANGO_SETTINGS_MODULE=clinic_project.settings.prod`, this is safe. Forget it once, and the process silently boots with `DEBUG=True` dev settings in production. |
| 11 | Migrations | ✅ fine | All 51 migration files are committed — `migrate` on a fresh server will work. |
| 12 | Heavy ML deps in `requirements.txt` (`faster-whisper`, `ctranslate2`, `onnxruntime`) | ⚠️ sizing note | First AI Scribe use downloads the Whisper `large-v3` model (~3 GB). Make sure the VPS has enough disk (≥10 GB free) and RAM; `pip install` of these can take several minutes on a small instance. |
| 13 | HTTPS / Let's Encrypt | 🟡 FOLLOW-UP (documented in Goal 4) | Let's Encrypt does not issue certificates for a bare IP. Ship HTTP-only now; add a domain + Certbot later. |

None of the 🔴/🟡 code fixes have been applied yet — this document only maps the
gap. Nothing has been run against the server.

---

## Goal 1: Get the App Running & Accessible

### Section 1.1: First Contact & Server Prep

1.  **Connect to the server:**
    ```bash
    ssh root@213.199.47.114
    ```
2.  **Update system packages:**
    ```bash
    apt update && apt upgrade -y
    ```
3.  **Install Python, web, and Node.js tooling** (Node is required to build the
    frontend — the Ubuntu default `apt` package is usually too old, so use
    NodeSource):
    ```bash
    apt install -y python3-pip python3-venv python3-dev build-essential git nginx curl ufw

    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt install -y nodejs
    node -v   # expect v22.x, matches Frontend's engines requirement
    ```
4.  **Configure basic firewall (UFW):**
    ```bash
    ufw allow OpenSSH
    ufw allow 'Nginx Full'
    ufw enable
    ```

### Section 1.2: Transferring the Code

1.  **Create a directory for the app and clone the repo** (repo root — contains
    both `Backend/` and `Frontend/`, not just the Django project):
    ```bash
    mkdir -p /var/www/clinic_app
    cd /var/www/clinic_app
    git clone <YOUR_GITHUB_REPOSITORY_URL> .
    ```
    *(Agent: help authenticate via Deploy Key or PAT if the repo is private.)*

### Section 1.3: Backend Environment & Database Setup

All commands below run from `/var/www/clinic_app/Backend` (not the repo root).

1.  **Create and activate a virtual environment:**
    ```bash
    cd /var/www/clinic_app/Backend
    python3 -m venv venv
    source venv/bin/activate
    ```
2.  **Install requirements:**
    ```bash
    pip install --upgrade pip
    pip install -r requirements.txt
    ```
    `daphne` (ASGI server, see 1.5) is already in `requirements.txt` — no separate
    Gunicorn install needed.
3.  **Set up `/var/www/clinic_app/Backend/.env`** (copy from `.env.example` and
    edit). Minimum production values for the HTTP-only/IP phase:
    ```bash
    SECRET_KEY=<generate a real random key>
    DEBUG=False
    ALLOWED_HOSTS=213.199.47.114

    DATABASE_URL=sqlite:///db.sqlite3

    CORS_ALLOWED_ORIGINS=http://213.199.47.114
    # Same-origin (Nginx serves SPA + API on one host) makes CORS mostly moot,
    # but keep this set correctly in case of absolute-URL requests.

    JWT_COOKIE_SECURE=False        # 🔴 required — see Blocker #3, flip to True once HTTPS is live
    JWT_COOKIE_SAMESITE=Lax

    # 🔴 Blocker #2 — set once prod.py is patched to read these (see Goal 2.1):
    SECURE_SSL_REDIRECT=False
    SESSION_COOKIE_SECURE=False
    CSRF_COOKIE_SECURE=False

    EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
    # ... EMAIL_HOST / EMAIL_HOST_USER / EMAIL_HOST_PASSWORD as needed

    GEMINI_API_KEY=<real key if AI Scribe is used>
    # TWILIO_* only if SMS_ENABLED/WHATSAPP_ENABLED=True
    ```
    *(Agent: help the user fill in real `SECRET_KEY`, SMTP, and any Twilio/Gemini
    keys they intend to use.)*
4.  **Run migrations, create an admin user, and collect static files:**
    ```bash
    export DJANGO_SETTINGS_MODULE=clinic_project.settings.prod
    python manage.py migrate
    python manage.py createsuperuser
    python manage.py collectstatic --noinput
    ```
    Do **not** run `makemigrations` on the server — migrations are generated in
    development and committed to git (already true for all 51 existing files);
    the server should only ever apply them with `migrate`.

### Section 1.4: Frontend Build

The SPA has no server-side rendering — it's a static build served by Nginx,
proxying API/WebSocket calls back to Django on the same origin.

```bash
cd /var/www/clinic_app/Frontend
npm ci
npm run build          # tsc -b && vite build → outputs Frontend/dist/
```

### Section 1.5: The Production App Servers

**Why not Gunicorn:** this app uses Django Channels for the real-time doctor
queue (`ws/appointments/queue/`), which is ASGI-only — a standard Gunicorn
sync-worker process cannot upgrade a connection to a WebSocket. The repo
already depends on `daphne` (see `INSTALLED_APPS` in `settings/base.py`, which
loads it specifically so `runserver`/production both speak ASGI). Use Daphne
directly instead of Gunicorn.

**Why exactly one process:** `CHANNEL_LAYERS` is `InMemoryChannelLayer`
(item #5 above) — state for the WebSocket layer lives in one process's memory.
Do **not** run multiple Daphne workers/instances behind Nginx; that would
split doctor-queue clients across processes that can't see each other's
events and break real-time updates unpredictably. One instance is correct
today; scaling past it requires first swapping to `channels_redis`.

1.  **Create `/etc/systemd/system/clinic-daphne.service`:**
    ```ini
    [Unit]
    Description=Daphne ASGI server (Clinic Project)
    After=network.target

    [Service]
    Type=simple
    User=root
    Group=www-data
    WorkingDirectory=/var/www/clinic_app/Backend
    Environment=DJANGO_SETTINGS_MODULE=clinic_project.settings.prod
    ExecStart=/var/www/clinic_app/Backend/venv/bin/daphne -b 127.0.0.1 -p 8000 clinic_project.asgi:application
    Restart=on-failure
    RestartSec=5

    [Install]
    WantedBy=multi-user.target
    ```
2.  **Create `/etc/systemd/system/clinic-qcluster.service`** (item #6 — background
    worker for AI Scribe transcription + outbound email/SMS/WhatsApp):
    ```ini
    [Unit]
    Description=Django-Q2 worker (Clinic Project)
    After=network.target

    [Service]
    Type=simple
    User=root
    Group=www-data
    WorkingDirectory=/var/www/clinic_app/Backend
    Environment=DJANGO_SETTINGS_MODULE=clinic_project.settings.prod
    ExecStart=/var/www/clinic_app/Backend/venv/bin/python manage.py qcluster
    Restart=on-failure
    RestartSec=5

    [Install]
    WantedBy=multi-user.target
    ```
3.  **Start and enable both:**
    ```bash
    systemctl daemon-reload
    systemctl start clinic-daphne clinic-qcluster
    systemctl enable clinic-daphne clinic-qcluster
    ```
4.  **Add cron entries** for the two periodic management commands (item #7 —
    README currently only documents Windows Task Scheduler):
    ```cron
    */5 * * * * cd /var/www/clinic_app/Backend && DJANGO_SETTINGS_MODULE=clinic_project.settings.prod venv/bin/python manage.py send_reminders >> /var/log/clinic_send_reminders.log 2>&1
    0 * * * *   cd /var/www/clinic_app/Backend && DJANGO_SETTINGS_MODULE=clinic_project.settings.prod venv/bin/python manage.py generate_slots  >> /var/log/clinic_generate_slots.log 2>&1
    ```
    (`crontab -e` as root, or drop a file in `/etc/cron.d/`.)

### Section 1.6: Nginx — Serving the SPA + Proxying the API

Unlike the original plan (which proxied everything to Django), Nginx here must
serve the built React SPA at `/` **and** proxy API/WebSocket/admin/media/static
traffic to Daphne — including WebSocket upgrade headers, which the original
plan omitted entirely.

1.  **Configure `/etc/nginx/sites-available/clinic_app`:**
    ```nginx
    server {
        listen 80;
        server_name 213.199.47.114;

        client_max_body_size 100M;   # 🔴 default (1M) breaks scan/audio uploads

        location = /favicon.ico { access_log off; log_not_found off; }

        location /static/ {
            alias /var/www/clinic_app/Backend/staticfiles/;
        }

        location /media/ {
            alias /var/www/clinic_app/Backend/media/;
        }

        location /ws/ {
            proxy_pass http://127.0.0.1:8000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_read_timeout 86400;
        }

        location /api/ {
            proxy_pass http://127.0.0.1:8000;
            include proxy_params;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        location /admin/ {
            proxy_pass http://127.0.0.1:8000;
            include proxy_params;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        location / {
            root /var/www/clinic_app/Frontend/dist;
            try_files $uri /index.html;   # SPA client-side routing (createBrowserRouter)
        }
    }
    ```
2.  **Enable and reload:**
    ```bash
    ln -s /etc/nginx/sites-available/clinic_app /etc/nginx/sites-enabled/
    nginx -t
    systemctl restart nginx
    ```

---

## Goal 2: Fix the Two Code-Level Blockers

These are the two 🔴 items that need an actual code change (not just server
config), broken out as their own goal — do this **before** the first deploy.
No server access needed for this goal; it's a local repo change, pushed like
any other commit.

### 2.1 — `Backend/clinic_project/settings/prod.py`: env-gate SSL/HSTS

Currently:
```python
DEBUG = False
SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
```
Change the hardcoded booleans to `env.bool(...)` calls (default `True`, so
nothing changes for anyone who *does* have HTTPS — only the `.env` on this
particular IP-only server sets them to `False`):
```python
SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=True)
SESSION_COOKIE_SECURE = env.bool("SESSION_COOKIE_SECURE", default=True)
CSRF_COOKIE_SECURE = env.bool("CSRF_COOKIE_SECURE", default=True)
SECURE_HSTS_SECONDS = env.int("SECURE_HSTS_SECONDS", default=60 * 60 * 24 * 30)
SECURE_HSTS_INCLUDE_SUBDOMAINS = env.bool("SECURE_HSTS_INCLUDE_SUBDOMAINS", default=True)
```

### 2.2 — Untrack the SQLite database files

```bash
git rm --cached Backend/db.sqlite3 Backend/db.sqlite3-shm Backend/db.sqlite3-wal
```
Then un-comment these three lines in the root `.gitignore` (currently
commented out):
```
Backend/db.sqlite3
Backend/db.sqlite3-wal
Backend/db.sqlite3-shm
```
Commit. The server's own `migrate` (Section 1.3) creates its production
`db.sqlite3` independently — it must never be overwritten by a `git pull`.

### 2.3 — (Follow-up, not blocking) `CSRF_TRUSTED_ORIGINS`

Add to `settings/base.py` once a domain + HTTPS exist:
```python
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])
```
and set `CSRF_TRUSTED_ORIGINS=https://yourdomain.com` in `.env`. Not needed for
the current HTTP/IP phase.

---

## Goal 3: Automate Updates with a GitHub Pipeline

### Section 3.1: The Handshake (SSH Keys)

1.  **Generate an SSH key pair on the VPS:**
    ```bash
    ssh-keygen -t rsa -b 4096 -C "github-actions-deploy" -f ~/.ssh/github_deploy -N ""
    cat ~/.ssh/github_deploy.pub >> ~/.ssh/authorized_keys
    ```
2.  **Add Secrets to GitHub Repository** (Settings → Secrets and variables →
    Actions):
    *   `SSH_HOST`: `213.199.47.114`
    *   `SSH_USER`: `root`
    *   `SSH_PRIVATE_KEY`: contents of `cat ~/.ssh/github_deploy`
    *   *(Optional)* `MAIL_USERNAME`, `MAIL_PASSWORD`, `NOTIFY_EMAIL` for deploy
        notification emails.

### Section 3.2: The Deployment Script (tracked in `deploy/deploy.sh`)

```bash
#!/bin/bash
set -euo pipefail

APP_DIR=/var/www/clinic_app
cd "$APP_DIR"
git pull origin main

# --- Backend ---
cd "$APP_DIR/Backend"
source venv/bin/activate
pip install -r requirements.txt
export DJANGO_SETTINGS_MODULE=clinic_project.settings.prod
python manage.py migrate
python manage.py collectstatic --noinput

# --- Frontend ---
cd "$APP_DIR/Frontend"
npm ci
npm run build

# --- Sync service/nginx config from repo (in case they changed) ---
cp "$APP_DIR/deploy/clinic-daphne.service" /etc/systemd/system/clinic-daphne.service
cp "$APP_DIR/deploy/clinic-qcluster.service" /etc/systemd/system/clinic-qcluster.service
cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/clinic_app
nginx -t

systemctl daemon-reload
systemctl restart clinic-daphne
systemctl restart clinic-qcluster
systemctl reload nginx
```
Make it executable: `chmod +x /var/www/clinic_app/deploy/deploy.sh`.

### Section 3.3: The GitHub Action Workflow (`.github/workflows/deploy.yml`)

Runs the backend test suite as a gate before touching the server, then
deploys on push to `main`:
```yaml
name: CI/CD Pipeline to VPS

on:
  push:
    branches:
      - main

jobs:
  test:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: Backend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.13"
      - run: pip install -r requirements.txt
      - run: python -m pytest

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - name: Execute deployment script via SSH
        uses: appleboy/ssh-action@v1.2.0    # pinned — not @master
        with:
          host: ${{ secrets.SSH_HOST }}
          username: ${{ secrets.SSH_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            bash /var/www/clinic_app/deploy/deploy.sh

      - name: Send Email Confirmation
        if: success()
        continue-on-error: true            # a missing MAIL_* secret shouldn't red-flag a good deploy
        uses: dawidd6/action-send-mail@v3
        with:
          server_address: smtp.gmail.com
          server_port: 465
          username: ${{ secrets.MAIL_USERNAME }}
          password: ${{ secrets.MAIL_PASSWORD }}
          subject: "🚀 Deployment Successful"
          body: "The latest commit has been successfully deployed to 213.199.47.114."
          to: ${{ secrets.NOTIFY_EMAIL }}
          from: GitHub Actions
```

---

## Goal 4 (Follow-up): HTTPS via a Domain + Certbot

Let's Encrypt cannot issue a certificate for a bare IP address — this phase is
blocked until a domain name points an A record at `213.199.47.114`. Once that
exists:

1.  `apt install -y certbot python3-certbot-nginx`
2.  `certbot --nginx -d yourdomain.com` (updates the Nginx server block, adds
    TLS, sets up auto-renewal)
3.  Flip the `.env` blockers back to secure defaults:
    ```
    SECURE_SSL_REDIRECT=True
    SESSION_COOKIE_SECURE=True
    CSRF_COOKIE_SECURE=True
    JWT_COOKIE_SECURE=True
    ```
4.  Set `CSRF_TRUSTED_ORIGINS=https://yourdomain.com` and add `yourdomain.com`
    to `ALLOWED_HOSTS`/`CORS_ALLOWED_ORIGINS`.
5.  Update `ALLOWED_HOSTS` to the domain (keep the IP too if still needed).

---

## What still needs a decision from you

- Confirm the private GitHub repo URL / auth method (Deploy Key vs PAT) for
  Section 1.2.
- Confirm real SMTP credentials (or leave console/no-email for now) and
  whether Twilio SMS/WhatsApp is enabled for this launch.
- Confirm whether AI Scribe (Whisper + Gemini) should be enabled at launch —
  affects VPS sizing (disk/RAM) per item #12 above.
- Say the word and I'll apply the Goal 2 code fixes (`prod.py` env-gating,
  untracking the sqlite files) and create the `deploy/` files
  (`clinic-daphne.service`, `clinic-qcluster.service`, `nginx.conf`, `deploy.sh`) and
  `.github/workflows/deploy.yml` in this repo — no server access required for
  any of that, it's all local file changes you'd then push yourself.
