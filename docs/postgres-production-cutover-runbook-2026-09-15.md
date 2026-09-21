# PostgreSQL Production Cutover — As Executed

**Status:** ✅ **DONE.** The live clinic app (`https://clinicms.duckdns.org`) runs on
PostgreSQL 16 as of **2026-09-15 22:04 UTC**.
**Maintenance window:** 21:43:39 → 22:04:30 UTC (~21 minutes of 502).
**Executed by:** SSH session on `root@213.199.47.114` (`vmi3217616`).
**Companion document:** [`postgres-production-cutover-plan.md`](./postgres-production-cutover-plan.md)
— the pre-cutover plan. This file is the record of what was *actually run*, including two
blockers the plan did not anticipate.

| | |
|---|---|
| Database | `clinic_system` (UTF8, `template0`), owner `clinic_app` |
| Role | `clinic_app` — `LOGIN` only, `NOSUPERUSER NOCREATEDB NOCREATEROLE` |
| Server | PostgreSQL 16.15, port 5432, `listen_addresses = localhost` |
| Password file | `/root/pg-cutover/secrets/clinic_app_pg_password.txt` (root, `0600`) |
| Code at cutover | `306a0d5` |

> ⚠️ The box is **shared**. The same PostgreSQL cluster already hosts `bible`,
> `bible_staging`, `followup`, `library`, `marriage`, `streak`, `sunday`. Every command
> below is scoped to `clinic_system` / `clinic_app`. Never run a cluster-wide operation.

---

## 0. Working directory

Everything the cutover produced lives under `/root/pg-cutover/`:

```
/root/pg-cutover/
├── secrets/clinic_app_pg_password.txt          # 0600, root
├── backups/clinic_sqlite_final_<TS>.sqlite3    # + .sha256   <- ROLLBACK ASSET
├── manifests/pre_cutover_counts.json           # baseline, taken while app was live
├── manifests/frozen_counts_<TS>.json           # authoritative comparison target
├── transfer/sqlite_data_<TS>.json              # the fixture that was loaded
├── transfer/reset_sequences_<TS>.sql
├── transfer/postgres_counts_<TS>.json          # post-import counts
├── cron-disabled/                              # cron file parked here during the window
└── env-backup_.env_<TS>                        # pre-cutover Backend/.env
```

---

## Phase 1 — Recon (read-only, app still live)

```bash
hostname; cat /etc/os-release | grep -E '^(NAME|VERSION)='
nproc; free -h; swapon --show; df -h /
systemctl is-active clinic-daphne clinic-qcluster nginx
command -v psql && psql --version
ls -la /var/www/clinic_app/Backend/db.sqlite3*
sha256sum /var/www/clinic_app/Backend/db.sqlite3
```

**Findings:** Ubuntu 24.04.4, 4 vCPU, 7.8 GiB RAM, **0 swap**, 59 G free.
PostgreSQL 16.15 was **already installed and running** — no install needed.
`psycopg[binary]==3.2.10` was already in `requirements.txt` *and* in the venv.

> 🔎 **The `-wal` file was 4.1 MB while `db.sqlite3` was only 2.2 MB.** Most recent data
> was still in the write-ahead log. Copying or hashing `db.sqlite3` alone at this point
> would have captured an incomplete database. This is why Phase 4 checkpoints first.

## Phase 2 — Project health + baseline counts (read-only)

```bash
cd /var/www/clinic_app/Backend && source venv/bin/activate
export DJANGO_SETTINGS_MODULE=clinic_project.settings.prod
python manage.py check          # 0 issues
python manage.py showmigrations # all [X] across 24 apps
```

SQLite `journal_mode=wal`, `integrity_check=ok`. A per-model row-count manifest was
written to `/root/pg-cutover/manifests/pre_cutover_counts.json` (60 models, ~4.3k rows).

## Phase 3 — Create the role and database

```bash
set +o history
umask 077
mkdir -p /root/pg-cutover/secrets
openssl rand -hex 32 > /root/pg-cutover/secrets/clinic_app_pg_password.txt
chmod 600 /root/pg-cutover/secrets/clinic_app_pg_password.txt

PGNEWPASS="$(cat /root/pg-cutover/secrets/clinic_app_pg_password.txt)"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
CREATE ROLE clinic_app WITH LOGIN PASSWORD '$PGNEWPASS' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE clinic_system OWNER clinic_app ENCODING 'UTF8' TEMPLATE template0;
SQL
unset PGNEWPASS
set -o history
```

Verified: role is login-only, database owned by `clinic_app`, **0 tables**, and a real
login over `127.0.0.1` succeeds.

## Phase 4 — Quiesce and freeze (**maintenance window opens**)

Three things write to the database, not two. Stopping systemd alone is **not enough**:

| Writer | How it was stopped |
|---|---|
| `clinic-daphne.service` | `systemctl stop` |
| `clinic-qcluster.service` (5 workers) | `systemctl stop` |
| **`/etc/cron.d/clinic-app`** | `mv` to `/root/pg-cutover/cron-disabled/` |

That cron file runs `send_reminders` **every 5 minutes** and `generate_slots`
**hourly** — it would have written into the database mid-dump.

```bash
mkdir -p /root/pg-cutover/cron-disabled
mv /etc/cron.d/clinic-app /root/pg-cutover/cron-disabled/clinic-app.disabled
systemctl stop clinic-qcluster clinic-daphne

# Must both come back empty before going further:
lsof /var/www/clinic_app/Backend/db.sqlite3{,-wal,-shm}
fuser -v /var/www/clinic_app/Backend/db.sqlite3{,-wal,-shm}
```

Then checkpoint the WAL and take a SQLite-aware backup (`.backup()`, not `cp`):

```python
conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")   # must return (0, 0, 0) — 0 = not BUSY
conn.execute("PRAGMA integrity_check;")            # must be [('ok',)]
src.backup(dst)                                    # then integrity_check the copy too
```

Result: `-wal` and `-shm` disappeared, both integrity checks `ok`, and
`frozen_counts_<TS>.json` came out **identical** to the live baseline — proof nothing
was written after the services stopped.

> 🔎 `db.sqlite3`'s sha256 **changes** at this step (`f62099a5…` → `1968eeed…`). That is
> the checkpoint folding the WAL into the main file, not new data. The number that
> matters is the backup's own sha256, recorded in its `.sha256` file.

## Phase 5 — Export, schema, import

```bash
# 1. Export from the frozen SQLite (contenttypes/permissions are recreated by migrate)
python manage.py dumpdata --exclude contenttypes.contenttype --exclude auth.permission \
  --indent 2 --output "$EXPORT_FILE"          # 3230 objects

# 2. Point Django at PostgreSQL for this process only
export DATABASE_URL="postgresql://clinic_app:${PGPASS}@127.0.0.1:5432/clinic_system"

# 3. Build the schema
python manage.py migrate --noinput

# 4. Import with every save-signal suppressed (see Blocker 2)
python manage.py shell -v 0 -c "
from django.db.models.signals import pre_save, post_save, m2m_changed
for sig in (pre_save, post_save, m2m_changed):
    with sig.lock:
        sig.receivers.clear(); sig.sender_receivers_cache.clear()
    assert not sig.receivers
from django.core.management import call_command
call_command('loaddata', '$EXPORT_FILE', verbosity=1)
"

# 5. Sequences — loaddata with explicit PKs does NOT advance them
python manage.py sqlsequencereset $APP_LABELS > reset.sql
python manage.py dbshell -- -v ON_ERROR_STOP=1 -q < reset.sql
```

> ⚠️ `manage.py dbshell < file` runs psql **without** `ON_ERROR_STOP`. A failed `setval`
> would be silent and the first insert after cutover would hit a duplicate-key error.
> Pass `-- -v ON_ERROR_STOP=1`, **and** verify afterwards that every sequence's next
> value exceeds `max(pk)` — the row-count check cannot catch this.

## Phase 6 — Validation (all passed)

| Check | Result |
|---|---|
| Row counts vs. frozen manifest | **EXACT MATCH**, 60/60 models |
| Sequences ahead of `max(pk)` | 56/56 |
| `manage.py check` on PostgreSQL | 0 issues |
| Arabic text | intact (`اندرو عزت`) |
| `GET /api/appointments/` over HTTPS | 200, 13 rows |
| `GET /api/specialties/` over HTTPS | 200, 6 rows |
| Insert test (rolled back) | new pk 327 after max 326 ✅ |

## Phase 7 — Cutover and reopen

```bash
cp -p Backend/.env /root/pg-cutover/env-backup_.env_<TS>   # back it up FIRST
# replace the single DATABASE_URL line with the postgres:// URL
chmod 600 Backend/.env                                     # was 0644; it holds SECRET_KEY

systemctl start clinic-daphne clinic-qcluster
mv /root/pg-cutover/cron-disabled/clinic-app.disabled /etc/cron.d/clinic-app
chmod 644 /etc/cron.d/clinic-app && chown root:root /etc/cron.d/clinic-app
```

`systemctl reload cron` fails (`reload is not applicable`) — harmless; cron picks up
`/etc/cron.d` changes on its own.

---

## Blocker 1 — `OPTIONS["timeout"]` broke every PostgreSQL connection

`Backend/clinic_project/settings/base.py` applied a **SQLite-only** connect option to
every backend:

```python
DATABASES["default"].setdefault("OPTIONS", {})
DATABASES["default"]["OPTIONS"]["timeout"] = 20      # SQLite busy-timeout
```

psycopg rejects it outright:

```
psycopg.ProgrammingError: invalid connection option "timeout"
```

`migrate` would have failed on its first connection. **Fixed in `306a0d5`** by guarding
the option behind the engine check. SQLite behaviour is unchanged.

> ⚠️ That commit was pushed with **`[skip ci]`**. `.github/workflows/deploy.yml` deploys
> on *any* push to `main`, and its `deploy` job does not wait for `test`. An auto-deploy
> during the window would have restarted the app against the frozen SQLite file, writing
> new rows after the verified backup and invalidating the manifest. **Any push made
> during a maintenance window must carry `[skip ci]`.**

## Blocker 2 — signal receivers ignored `raw` (✅ **fixed 2026-09-19 in `6da5a2f`**)

`loaddata` failed with:

```
IntegrityError: Could not load users.StaffProfile(pk=1):
duplicate key value violates unique constraint "users_staffprofile_user_id_key"
```

Django sends `post_save` with `raw=True` during fixture loading, and receivers are
expected to opt out. **None of this project's 8 save-signal receivers check it:**

| File | Receiver | What it does during a fixture load |
|---|---|---|
| `apps/users/signals.py` | `create_user_dependents` | Creates a second `StaffProfile`/`PatientProfile`/`NotificationPreference` per user — **this is the error above** |
| `apps/audit/signals.py` | `audit_pre_save`, `audit_post_save` | Writes a CREATE audit row for every loaded record |
| `apps/appointments/signals.py` | `capture_old_status`, `broadcast_queue_update`, `notify_on_status_change` | Sends a "booked" notification per appointment + a WebSocket push |
| `apps/doctors/signals.py` | `block_slots_for_absence`, `generate_slots_for_new_schedule` | Regenerates timeslots; **cancels appointments** |
| `apps/vital_signs/signals.py` | `sync_vitals_to_medical_record` | Overwrites `MedicalRecord.vitals` |

**Worked around, not fixed.** The cutover cleared `pre_save` / `post_save` /
`m2m_changed` inside the loading process only. The row-count EXACT MATCH is the proof it
held — any receiver firing would have inflated `notifications.notification` (33),
`audit.auditlog` (326) or `users.notificationpreference` (9).

**Fixed in `6da5a2f`** (2026-09-19) — every receiver now returns early on `raw`, with
`Backend/tests/test_signal_raw_guards.py` covering both paths (raw must be a no-op; the
normal path must behave exactly as before). It went through CI rather than being bundled
into the `[skip ci]` settings fix, which is why it landed separately.

---

## Rollback (still available)

Nothing about the old setup was destroyed.

```bash
systemctl stop clinic-daphne clinic-qcluster
mv /etc/cron.d/clinic-app /root/pg-cutover/cron-disabled/clinic-app.disabled

cp /root/pg-cutover/env-backup_.env_<TS> /var/www/clinic_app/Backend/.env   # back to sqlite://
# only if the live db.sqlite3 is suspect:
cp /root/pg-cutover/backups/clinic_sqlite_final_<TS>.sqlite3 \
   /var/www/clinic_app/Backend/db.sqlite3
sha256sum -c /root/pg-cutover/backups/clinic_sqlite_final_<TS>.sqlite3.sha256

systemctl start clinic-daphne clinic-qcluster
mv /root/pg-cutover/cron-disabled/clinic-app.disabled /etc/cron.d/clinic-app
```

**Any data written to PostgreSQL after 22:04 UTC on 2026-09-15 is lost by a rollback.**
The longer the app runs on PostgreSQL, the more this stops being a real option — treat
it as an emergency measure for the first day, not a standing escape hatch.

## Follow-ups

- [x] ~~Fix the `raw` guards in the 5 signal files (Blocker 2)~~ — done in `6da5a2f`, with tests.
- [ ] Schedule `pg_dump` backups for `clinic_system`. The old SQLite file-copy backup no
      longer protects anything; `deploy/deploy.sh` already takes a pre-migrate `pg_dump`,
      but there is no routine scheduled backup.
- [ ] Add a swapfile — the box still has **0 swap** with 7.8 GiB RAM and five projects.
- [ ] `deploy/deploy.sh` is already PostgreSQL-aware but has **not yet been exercised**
      against PostgreSQL. Watch the first real deploy closely.
- [ ] `financial-foundation` branch is now unblocked (it needs PL/pgSQL triggers,
      `select_for_update()`, and partial unique indexes — all real on PostgreSQL).
