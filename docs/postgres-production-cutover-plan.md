# Production PostgreSQL Cutover Plan

> ✅ **SUPERSEDED — this cutover was executed on 2026-09-15.** See
> [`postgres-production-cutover-runbook-2026-09-15.md`](./postgres-production-cutover-runbook-2026-09-15.md)
> for what was actually run, the two blockers hit, and the rollback procedure.
> The text below is the original pre-cutover plan, kept for context.

**Status:** not started (at time of writing). **Owner:** whoever has SSH access to `213.199.47.114`.
**Written:** 2026-09-14, prompted by an attempt to deploy the financial
roadmap (`financial-foundation` branch, 10 commits, Tasks 1–17 + API
idempotency hardening) to production and discovering it depends on
PostgreSQL-only behavior that the live server doesn't have yet.

This is a planning document, not a completed migration — nothing described
here has been run against the production server. No SSH session was opened
to write this; everything below is derived from the repo (`SERVER_INFO.md`,
`deploy/deploy.sh`, the migrations themselves) plus previously-recorded VPS
specs. **Treat every command below as a draft to review, not a script to
paste and run unattended** — especially the maintenance-window section,
which touches a live database with real patient/financial data.

---

## 1. Why this has to happen before `financial-foundation` ships

`SERVER_INFO.md` already documents `DATABASE_URL=sqlite:///db.sqlite3` in
production, with `prod.py` itself carrying the comment
`# EXTENSION HOOK: swap SQLite for PostgreSQL by setting DATABASE_URL=postgres://...`
— the Django side is already fully engine-agnostic. What's missing is the
infrastructure and data-migration work, which was always described as "a
separate, deliberate follow-up" and has not been started.

Concrete reasons this can't be skipped or patched around:

1. **`apps/accounting/migrations/0003_journal_immutability_trigger.py`** is
   raw PL/pgSQL (`CREATE TRIGGER ... LANGUAGE plpgsql`). Its own docstring
   says *"Postgres-only... production is still SQLite and out of scope for
   this migration."* Run through `manage.py migrate` on SQLite, this fails
   outright — not a warning, a hard `OperationalError`.
2. **`select_for_update()`** — used throughout `apps/billing/services.py`
   (payments, refunds, credit notes, shifts, cash movements, invoice-number
   allocation) and `apps/accounting/services.py` — is a silent no-op on
   SQLite. None of the concurrency guarantees the financial roadmap was
   built and tested against actually exist without Postgres.
3. **Partial unique indexes and multi-column `CHECK` constraints** (one
   open shift per cashier/till, "exactly one side per journal line",
   mandatory reason+approver on a variance, etc.) are expressed in ways
   SQLite supports much more weakly — some would silently behave
   differently even where the migration itself doesn't error.
4. **The new `Idempotency-Key` requirement** on payment/refund/credit-note/
   cash-movement endpoints is a *contract change* the currently-deployed
   frontend doesn't speak yet — deploying the backend alone would start
   returning 400s on live payment recording regardless of the database.
   (Out of scope for this doc, but must not be forgotten when scheduling
   the actual cutover + deploy.)

None of this is new information invented for this document — it's what the
branch's own commits, `CLAUDE.md`, and `SERVER_INFO.md` already say. This
plan exists to make the *how* concrete.

---

## 2. Current state (facts this plan is built on)

| | |
|---|---|
| Server | Contabo VPS, `213.199.47.114`, root SSH access, **password auth only from this dev machine — no key configured here** |
| Hardware | 4 vCPU / 7.8 GB RAM / **no swap configured** / 72 GB disk |
| App directory | `/var/www/clinic_app` |
| Current DB | `Backend/db.sqlite3`, WAL mode (deploy.sh backs up `.sqlite3`/`-wal`/`-shm` together) |
| Deploy trigger | push to `main` → `.github/workflows/deploy.yml` → `deploy/deploy.sh` on the server |
| Services | `clinic-daphne` (ASGI, single process — `InMemoryChannelLayer`), `clinic-qcluster` (Django-Q2 worker), Nginx, Certbot |
| `financial-foundation` branch | 10 commits ahead of `origin/main`, 0 behind — clean fast-forward, nothing to reconcile once this plan is done |

**`deploy/deploy.sh`'s rollback is hardcoded to SQLite file-copy** (`cp
db.sqlite3 db.sqlite3.pre-migrate-bak` / restore on failure). This will
silently do nothing useful once the DB is Postgres — **updating this script
is part of the cutover, not an afterthought**, or every deploy after cutover
loses its automatic database rollback protection. See §5.

---

## 3. Sequencing

```
1. Prep work on the VPS (no downtime, done ahead of time)
2. Update deploy.sh for a Postgres-aware backup/rollback (no downtime — ships
   normally through the existing pipeline, on main, BEFORE the cutover itself)
3. Maintenance window: stop app → back up → migrate schema on Postgres →
   copy data → switch DATABASE_URL → start app → verify
4. Only after the app is confirmed healthy on Postgres: merge and deploy
   `financial-foundation`
```

Steps 4 is deliberately its own, separate deploy — don't fold the financial
roadmap's 10 commits into the same window as the engine cutover. If
something goes wrong, you want exactly one variable to have changed.

---

## 4. Step-by-step

### 4.1 Prep (no downtime, do this first, whenever convenient)

On the VPS, as root:

```bash
# --- Swap: the box has none today. Postgres + Daphne + qcluster on 7.8GB
# with zero swap is already a little tight; a maintenance-window migration
# process (dumpdata/loaddata) will use extra memory transiently. 2GB is
# plenty for a box this size — not meant to be a performance tier, just a
# safety margin against an OOM kill mid-migration.
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# --- Install PostgreSQL (Ubuntu/Debian — confirm the actual distro first
# with `cat /etc/os-release`; adjust package names if it's something else) ---
apt update
apt install -y postgresql postgresql-contrib

systemctl enable --now postgresql
systemctl status postgresql --no-pager

# --- App role + database (mirrors the dev-machine setup already documented
# in Backend/.env.example — same credential *shape*, different actual
# password; generate a real one, don't reuse the dev one) ---
sudo -u postgres psql -c "CREATE ROLE clinic_app WITH LOGIN PASSWORD '<GENERATE-A-REAL-SECRET>';"
sudo -u postgres psql -c "CREATE DATABASE clinic_system OWNER clinic_app;"
```

Do **not** touch `Backend/.env`'s `DATABASE_URL` yet — the app keeps running
on SQLite until the maintenance window in §4.3.

Confirm `psycopg[binary]` is already in `Backend/requirements.txt` (it is —
added in the dev-side Task 3 work) so the next normal `pip install -r
requirements.txt` on the server picks it up without a special step.

### 4.2 Make `deploy.sh` Postgres-aware (ship this on `main` first, separately)

This is a normal code change through the normal pipeline — no downtime, and
it's safe to deploy while still on SQLite (the branch check makes it inert
until `DATABASE_URL` actually changes). Replace the SQLite-only backup/
restore blocks with something that branches on the configured engine, e.g.:

```bash
# in the "back up before migrate" section:
DB_ENGINE=$(python -c "import django,os; os.environ.setdefault('DJANGO_SETTINGS_MODULE','clinic_project.settings.prod'); django.setup(); from django.conf import settings; print(settings.DATABASES['default']['ENGINE'])")

if [ "$DB_ENGINE" = "django.db.backends.sqlite3" ]; then
    for f in db.sqlite3 db.sqlite3-wal db.sqlite3-shm; do
        [ -f "$f" ] && cp "$f" "$f.pre-migrate-bak"
    done
else
    PGPASSWORD="$DB_PASSWORD" pg_dump -Fc -h "$DB_HOST" -U "$DB_USER" "$DB_NAME" \
        -f /var/backups/clinic_app/pre-migrate-$(date +%Y%m%d-%H%M%S).dump
fi
```

with the matching restore logic in `rollback()`. Keep the credentials out of
the script itself — read them from the same `.env`/`DATABASE_URL` the app
already uses (`env.db()` parses it; a tiny Python one-liner can extract
host/user/db name for `pg_dump` without ever printing the password to the
log). **Review and test this change on a non-production copy before trusting
it as the safety net for the real cutover in §4.3** — an untested rollback
path is not a rollback path.

### 4.3 The maintenance window

Announce downtime first — this is a live clinic system; pick a low-traffic
window.

```bash
# 1. Stop the app so nothing writes to SQLite while it's being copied.
systemctl stop clinic-daphne clinic-qcluster

# 2. Back up the SQLite files untouched, off to the side — this is the
#    "abort and go back to exactly where we started" copy, independent of
#    anything deploy.sh does.
mkdir -p /root/pre-postgres-cutover
cp /var/www/clinic_app/Backend/db.sqlite3* /root/pre-postgres-cutover/
cp /var/www/clinic_app/Backend/.env /root/pre-postgres-cutover/.env.bak

# 3. Dump the data (from the CURRENT commit's code — don't switch commits
#    yet — the model state must match what wrote db.sqlite3):
cd /var/www/clinic_app/Backend
source venv/bin/activate
export DJANGO_SETTINGS_MODULE=clinic_project.settings.prod
python manage.py dumpdata \
    --natural-foreign --natural-primary \
    -e contenttypes -e auth.permission -e admin.logentry -e sessions.session \
    --indent 2 > /root/pre-postgres-cutover/data.json

# Sanity check before going further — do NOT proceed on a 0-byte or
# obviously-truncated dump.
ls -la /root/pre-postgres-cutover/data.json
python -c "import json; d=json.load(open('/root/pre-postgres-cutover/data.json')); print(len(d), 'objects')"

# 4. Point at Postgres and build a fresh schema there — this app has NEVER
#    had its schema created on Postgres in production, so this runs every
#    migration from zero (all apps, not just accounting/billing).
#    Edit Backend/.env: DATABASE_URL=postgres://clinic_app:<password>@127.0.0.1:5432/clinic_system
python manage.py migrate

# 5. Load the data into the new schema.
python manage.py loaddata /root/pre-postgres-cutover/data.json

# 6. Re-sync auto-increment sequences — loaddata inserts explicit PKs, so
#    every sequence is still at 1 until this runs; the next INSERT would
#    otherwise collide with an existing row.
python manage.py sqlsequencereset billing accounting appointments users \
    doctors encounters medical_records medications procedures radiology \
    referrals reports reviews vital_signs notifications audit ai_scribe \
    core | python manage.py dbshell

# 7. Spot-check row counts match between the two databases for a handful of
#    the most important tables before trusting the load (compare against
#    counts taken from the SQLite file before it was stopped) — do this
#    without printing patient data:
python manage.py shell -c "
from django.contrib.auth import get_user_model
from apps.billing.models import Invoice, Payment
print('users', get_user_model().objects.count())
print('invoices', Invoice.objects.count())
print('payments', Payment.objects.count())
"

# 8. Restart the app on the new database.
systemctl start clinic-daphne clinic-qcluster
sleep 2
systemctl status clinic-daphne clinic-qcluster --no-pager
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000/api/auth/

# 9. Watch logs for a few minutes under real traffic.
journalctl -u clinic-daphne -f
```

**If anything in steps 4–8 looks wrong**, don't try to patch it live — go to
§4.4.

### 4.4 Rollback (of the cutover itself)

This is separate from `deploy.sh`'s normal rollback (which only reverts a
code deploy) — this reverts the *engine switch*:

```bash
systemctl stop clinic-daphne clinic-qcluster
cp /root/pre-postgres-cutover/.env.bak /var/www/clinic_app/Backend/.env   # DATABASE_URL back to sqlite:///db.sqlite3
cp /root/pre-postgres-cutover/db.sqlite3* /var/www/clinic_app/Backend/
systemctl start clinic-daphne clinic-qcluster
```

The original SQLite files were never modified (only copied from), so this
is a clean revert regardless of how far into §4.3 things got. Leave the
Postgres role/database in place — nothing about deleting it is required to
roll back, and re-attempting the cutover later doesn't need it recreated.

### 4.5 Only after Postgres is confirmed healthy: deploy the financial roadmap

Now — and only now — is it safe to merge `financial-foundation` into `main`
and let the existing CI/CD pipeline deploy it normally. At that point:

- `apps.accounting`'s migrations (0001–0003) apply for the first time.
- `apps.billing`'s migrations 0004–0012 (everything from the duplicate-
  billing guard through the idempotency hardening) apply.
- Coordinate this with the frontend release that sends `Idempotency-Key` —
  deploying the new backend contract without it breaks live payment
  recording (see §1, point 4). That frontend work is not part of this
  branch and is out of scope for this document.

---

## 5. Effort estimate

- Prep (§4.1, §4.2): a few hours, no downtime, can happen days ahead.
- Maintenance window (§4.3): realistically 30–60 minutes for a clinic-sized
  dataset, plus whatever buffer you want for the log-watching step. Size
  this against how much data is actually in `db.sqlite3` today — check
  `ls -la db.sqlite3` before scheduling the window.
- Do a full dry run of §4.3 against a **copy** of the production
  `db.sqlite3` on a throwaway directory/venv first, if at all possible —
  this plan has not been executed even once yet.

## 6. Open questions only the server operator can answer

- Confirm the VPS's actual distro/package manager before trusting the
  `apt install postgresql` line verbatim.
- Confirm how large `db.sqlite3` actually is today (`ls -la`) — this changes
  the maintenance-window time estimate above.
- Decide the actual maintenance window time/announcement process — a live
  clinic's patients and staff need notice.
