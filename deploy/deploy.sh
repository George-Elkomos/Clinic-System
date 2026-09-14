#!/bin/bash
set -uo pipefail
# Note: no `set -e` — failures are handled explicitly via `|| rollback` below
# so a bad deploy can restore the previous working state instead of just
# stopping halfway.

# Defense-in-depth against a second deploy.sh instance running concurrently
# with this one (the workflow's `concurrency:` guard should already prevent
# two CI-triggered deploys overlapping, but this also covers a manual run
# on the server while CI is mid-deploy). Two instances racing each other's
# git/npm/pip/systemctl operations against the same directory is exactly
# what caused a real incident once — this must run BEFORE the log redirect
# below, since that redirect truncates the log file, which would otherwise
# clobber a still-running instance's active log the moment a second
# instance starts up and exits.
LOCK_FILE=/tmp/clinic-app-deploy.lock
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
    echo "Another deploy is already in progress (lock: $LOCK_FILE) — exiting without touching anything. If this seems stuck, check 'ps aux | grep deploy.sh' on the server."
    exit 1
fi

# Full run (stdout+stderr) is saved here, overwritten each deploy, AND still
# streamed back over the SSH session that invoked this script — the log is
# both persisted on the server for manual debugging and captured by CI in
# the same connection (no separate fetch step to fail independently).
LOG_FILE=/var/log/clinic-deploy.log
exec > >(tee "$LOG_FILE") 2>&1

echo "=== Deploy started: $(date -u '+%Y-%m-%d %H:%M:%S UTC') ==="

APP_DIR=/var/www/clinic_app
cd "$APP_DIR"
PREV_COMMIT=$(git rev-parse HEAD)
echo "Previous commit (rollback target if anything below fails): $PREV_COMMIT"

# Populated by detect_db_config() below, once the venv/Django settings are
# available. Initialized empty here so rollback() can safely check them
# even if a failure happens before detection ever runs (e.g. `git pull`
# itself fails) — an empty DB_ENGINE means "we never found out, so say
# nothing database-specific in the rollback message."
DB_ENGINE=""
DB_HOST=""
DB_PORT=""
DB_NAME=""
DB_USER=""
DB_PASSWORD=""
PG_BACKUP_FILE=""
PG_BACKUP_DIR=/var/backups/clinic_app

# How many "pre-deploy-*.dump" PostgreSQL backups to keep around after a
# *successful* deploy (a failed deploy's backup is never pruned — see
# prune_postgres_backups() and its one call site). Override by exporting
# PG_BACKUP_RETENTION before invoking this script.
PG_BACKUP_RETENTION="${PG_BACKUP_RETENTION:-5}"

# Set to "true" the instant `python manage.py migrate` succeeds — this is
# the one fact rollback() needs to decide whether it's safe to blindly
# revert the application code (see rollback()'s "phase-aware" check up
# top). Must stay false for the whole pre-migrate part of the deploy.
MIGRATIONS_APPLIED=false

# `systemctl restart` only confirms the process launched, not that it kept
# running — a crash-on-startup bug can report "success" and die a moment
# later. This checks the service is still alive after a beat, AND that it
# actually answers a request (Daphne only; qcluster has no HTTP port). On
# any failure it dumps the real journal (systemd routes app crashes/
# tracebacks there, not to this script's own output) before returning.
verify_service() {
    local service="$1"
    sleep 2
    if ! systemctl is-active --quiet "$service"; then
        echo "--- $service is NOT active after restart. journalctl -u $service (last 150 lines): ---"
        journalctl -u "$service" -n 150 --no-pager
        return 1
    fi
    echo "--- $service is active. ---"
    return 0
}

verify_daphne_http() {
    sleep 1
    local code
    code=$(curl -s -o /dev/null -m 5 -w "%{http_code}" "http://127.0.0.1:8000/api/auth/" 2>/dev/null)
    if [ -z "$code" ] || [ "$code" = "000" ]; then
        echo "--- Daphne did not answer a local HTTP request (curl code: '$code'). journalctl -u clinic-daphne (last 150 lines): ---"
        journalctl -u clinic-daphne -n 150 --no-pager
        return 1
    fi
    echo "--- Daphne answered locally with HTTP $code (any response, even 404, confirms it's alive). ---"
    return 0
}

restart_and_verify() {
    local service="$1"
    if ! systemctl restart "$service"; then
        echo "--- systemctl restart $service FAILED. journalctl -u $service (last 150 lines): ---"
        journalctl -u "$service" -n 150 --no-pager
        return 1
    fi
    verify_service "$service"
}

# Reads the *actual* configured database engine/connection info out of
# Django's own settings (DATABASE_URL in .env, parsed by django-environ) —
# never assumed or hardcoded here, so this script keeps working correctly
# whether the server is on SQLite (today) or PostgreSQL (after the planned
# cutover, see docs/postgres-production-cutover-plan.md) without itself
# needing to change again.
#
# Prints ENGINE/HOST/PORT/NAME/USER/PASSWORD on five separate stdout lines,
# in that fixed order, and nothing else — the caller reads them positionally,
# so nothing else may ever print to stdout inside this function. The password
# is only ever held in a shell variable, never echoed by this script; the
# caller is responsible for keeping it out of any log line it writes.
detect_db_config() {
    python -c "
import django
django.setup()
from django.conf import settings
db = settings.DATABASES['default']
for key in ('ENGINE', 'HOST', 'PORT', 'NAME', 'USER', 'PASSWORD'):
    print(db.get(key) or '')
"
}

# Backs up the PostgreSQL database with pg_dump (custom format) and verifies
# the resulting archive is actually readable before trusting it as a rollback
# point — a file that merely *exists* is not a backup. Fails (non-zero
# return) rather than letting the caller continue if either step fails, so
# `backup_postgres || rollback` upstream aborts the deploy before anything
# touches the schema.
#
# The backup is deliberately *not* deleted on success (unlike the SQLite
# pre-migrate copies) and is never restored automatically by rollback() —
# restoring a database can destroy legitimate data written after the backup
# was taken, so that decision is always left to a human. See rollback()'s
# PostgreSQL branch for the exact manual-restore command.
backup_postgres() {
    mkdir -p "$PG_BACKUP_DIR"
    local stamp file dump_status
    stamp=$(date -u '+%Y%m%d-%H%M%S')
    file="$PG_BACKUP_DIR/pre-deploy-$stamp.dump"

    echo "--- PostgreSQL backup: dumping '$DB_NAME' (host ${DB_HOST:-127.0.0.1}, port ${DB_PORT:-5432}) to $file ---"
    dump_status=0
    PGPASSWORD="$DB_PASSWORD" pg_dump -Fc \
        -h "${DB_HOST:-127.0.0.1}" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME" \
        -f "$file" || dump_status=$?

    # The password is only ever needed for this one pg_dump invocation —
    # drop it from the shell the moment that command finishes (success or
    # failure alike), rather than let it sit in memory for the rest of a
    # long-running deploy. `PGPASSWORD` above was only ever set in that one
    # command's own environment, never this shell's, so the `unset` here is
    # belt-and-suspenders; `DB_PASSWORD` is the one that actually matters.
    # Neither is ever echoed, here or anywhere else in this script.
    unset DB_PASSWORD PGPASSWORD 2>/dev/null || true

    if [ "$dump_status" -ne 0 ]; then
        echo "--- pg_dump FAILED — no verified backup exists. Aborting before touching the database. ---"
        return 1
    fi

    # `pg_restore --list` reads the archive's table of contents only — it
    # never connects to any database (no password needed) or writes
    # anything — so this verifies the dump is structurally valid without
    # any risk to live data.
    if [ ! -s "$file" ] || ! pg_restore --list "$file" >/dev/null 2>&1; then
        echo "--- PostgreSQL backup at $file is missing or failed verification (pg_restore --list). Aborting. ---"
        return 1
    fi

    PG_BACKUP_FILE="$file"
    echo "--- PostgreSQL backup verified OK: $PG_BACKUP_FILE ($(du -h "$file" | cut -f1)) ---"
    return 0
}

# Prunes old "pre-deploy-*.dump" backups after a successful deploy, keeping
# only the PG_BACKUP_RETENTION most recent (sorted by the timestamp already
# embedded in the filename, not filesystem mtime — robust against a backup
# ever being copied/rsynced elsewhere and back with a changed mtime). Only
# ever touches files matching this script's own naming pattern inside
# PG_BACKUP_DIR — never a bulk directory wipe, so any unrelated backup that
# might land in the same directory is never at risk.
#
# Deliberately only called after a full successful deploy (see the one call
# site below) — a failed deploy's backup is never pruned, since it may be
# exactly the one a human needs to inspect or restore from.
prune_postgres_backups() {
    local count
    count=$(find "$PG_BACKUP_DIR" -maxdepth 1 -name 'pre-deploy-*.dump' -type f 2>/dev/null | wc -l)
    if [ "$count" -le "$PG_BACKUP_RETENTION" ]; then
        echo "--- PostgreSQL backup retention: $count present, limit is $PG_BACKUP_RETENTION — nothing pruned. ---"
        return 0
    fi
    echo "--- PostgreSQL backup retention: $count present, keeping the $PG_BACKUP_RETENTION most recent, pruning the rest. ---"
    find "$PG_BACKUP_DIR" -maxdepth 1 -name 'pre-deploy-*.dump' -type f 2>/dev/null | sort | head -n -"$PG_BACKUP_RETENTION" \
        | while IFS= read -r old_file; do
            rm -f "$old_file"
            echo "--- Pruned old PostgreSQL backup: $old_file ---"
        done
}

rollback() {
    echo "!!! A deploy step failed — rolling back to $PREV_COMMIT !!!"

    # --- PHASE-AWARE GUARD — decide whether an automatic code rollback is
    #     even safe before doing anything.
    #
    #     Before `migrate` has run, the database hasn't changed at all yet,
    #     so reverting the code is always safe (this is the common case:
    #     git pull / pip install / collectstatic / frontend build failures).
    #
    #     After `migrate` has succeeded against PostgreSQL, this script has
    #     no automatic database restore (see backup_postgres()'s docstring —
    #     restoring can destroy real data written since the backup). Blindly
    #     reverting the *code* in that situation would leave the OLD code
    #     running against the NEW (migrated-forward) schema — exactly the
    #     "code and schema out of sync" failure mode this whole rollback
    #     mechanism exists to prevent, just inverted. So: stop, touch
    #     nothing else, and print a clear manual decision instead — unless
    #     an operator has explicitly asserted the previous code is known
    #     compatible with the current schema (FORCE_CODE_ROLLBACK_AFTER_MIGRATION=true).
    #
    #     SQLite is exempt from this guard: its restore *is* automatic (the
    #     branch below), so code and schema always move back together and
    #     an automatic code rollback stays safe in every phase, as before.
    if [ "$DB_ENGINE" = "django.db.backends.postgresql" ] \
        && [ "$MIGRATIONS_APPLIED" = "true" ] \
        && [ "${FORCE_CODE_ROLLBACK_AFTER_MIGRATION:-}" != "true" ]; then
        echo "!!! Migrations were already applied to PostgreSQL before this failure. !!!"
        echo "--- Refusing to automatically revert the application code: doing so would run"
        echo "--- $PREV_COMMIT's code against the NEW (already-migrated) schema, an unproven"
        echo "--- combination — for PostgreSQL this script never guesses at a database"
        echo "--- restore either. Nothing has been touched by this rollback() call: code,"
        echo "--- services, and the database are all exactly as this deploy attempt left them."
        echo "---"
        echo "--- Current (new, NOT reverted) commit: $(git rev-parse HEAD 2>/dev/null || echo unknown)"
        echo "--- Previous working commit:            $PREV_COMMIT"
        echo "--- PostgreSQL backup (if one was taken this run): ${PG_BACKUP_FILE:-none — check $PG_BACKUP_DIR}"
        echo "---"
        echo "--- Check whether the services are actually still up before doing anything else:"
        echo "---   systemctl status clinic-daphne clinic-qcluster --no-pager"
        echo "---"
        echo "--- Manual recovery — pick one:"
        echo "---   A) The new code is fine and something else failed transiently (e.g. a flaky"
        echo "---      restart) — investigate via journalctl, fix forward, re-run deploy.sh."
        echo "---   B) The new code must be reverted, and you have confirmed $PREV_COMMIT's code"
        echo "---      is compatible with the CURRENT (already-migrated) schema — re-run as:"
        echo "---        FORCE_CODE_ROLLBACK_AFTER_MIGRATION=true bash deploy/deploy.sh"
        echo "---      (or perform the same steps by hand: git reset --hard $PREV_COMMIT, reinstall"
        echo "---      deps, restart clinic-daphne/clinic-qcluster)."
        echo "---   C) The new code must be reverted and is NOT schema-compatible — restore the"
        echo "---      PostgreSQL backup above manually FIRST, THEN revert the code:"
        echo "---        dropdb -h ${DB_HOST:-127.0.0.1} -p ${DB_PORT:-5432} -U $DB_USER $DB_NAME   # only if no newer data must survive"
        echo "---        createdb -h ${DB_HOST:-127.0.0.1} -p ${DB_PORT:-5432} -U $DB_USER -O $DB_USER $DB_NAME"
        echo "---        pg_restore -h ${DB_HOST:-127.0.0.1} -p ${DB_PORT:-5432} -U $DB_USER -d $DB_NAME ${PG_BACKUP_FILE:-<backup file>}"
        echo "---        (password prompted interactively — never logged; then re-run this script"
        echo "---        or FORCE_CODE_ROLLBACK_AFTER_MIGRATION=true bash deploy/deploy.sh to revert the code)"
        echo "=== Deploy FAILED — left as-is for manual recovery: $(date -u '+%Y-%m-%d %H:%M:%S UTC') ==="
        exit 1
    fi

    # --- CODE ROLLBACK — reached for every other case: SQLite always, and
    #     PostgreSQL either before migrations ran or with an explicit,
    #     operator-asserted compatibility override. ---
    echo "--- CODE ROLLBACK: reverting $APP_DIR to $PREV_COMMIT ---"
    cd "$APP_DIR"
    git reset --hard "$PREV_COMMIT"

    # Restore live config files to match the reverted commit, in case they
    # were already copied over before the failure was detected.
    cp "$APP_DIR/deploy/clinic-daphne.service" /etc/systemd/system/clinic-daphne.service 2>/dev/null || true
    cp "$APP_DIR/deploy/clinic-qcluster.service" /etc/systemd/system/clinic-qcluster.service 2>/dev/null || true
    cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/clinic_app 2>/dev/null || true
    systemctl daemon-reload 2>/dev/null || true

    # Reinstall against the reverted code in case the failure happened
    # mid pip-install and left a mismatched venv.
    cd "$APP_DIR/Backend"
    source venv/bin/activate
    pip install -r requirements.txt 2>/dev/null || true

    # --- DATABASE RESTORE — a deliberately separate decision from the code
    #     rollback above. Behavior depends on the engine detected earlier
    #     in this same run (empty if detection itself never ran). ---
    if [ "$DB_ENGINE" = "django.db.backends.sqlite3" ]; then
        # Unchanged from before: SQLite's backup is a plain file copy, so
        # restoring it automatically is low-risk and has always been part
        # of this rollback. The pre-migrate backup is deliberately kept on
        # disk until the whole deploy (including the restart/health check
        # below) succeeds — not deleted the instant `migrate` itself
        # succeeds — so this also covers "migrate worked, but the new code
        # then crashed on startup," not just a failed migration.
        for f in db.sqlite3 db.sqlite3-wal db.sqlite3-shm; do
            if [ -f "$f.pre-migrate-bak" ]; then
                mv "$f.pre-migrate-bak" "$f"
                echo "--- DATABASE: restored $f from its pre-migrate backup (SQLite, automatic). ---"
            fi
        done
    elif [ "$DB_ENGINE" = "django.db.backends.postgresql" ]; then
        # Deliberately NOT automatic: restoring a PostgreSQL backup can
        # destroy real data written after the backup was taken (e.g. a
        # patient payment recorded in the brief window between the backup
        # and this failure). The code above has already been reverted; the
        # database is left exactly as this run leaves it, and a human
        # decides whether a restore is actually warranted.
        if [ -n "$PG_BACKUP_FILE" ]; then
            echo "--- DATABASE: PostgreSQL backup exists at $PG_BACKUP_FILE — NOT restored automatically. ---"
            echo "--- If migrate already succeeded before this failure, the schema may now be AHEAD of the reverted code. ---"
            echo "--- Review what actually failed before deciding. To restore this backup manually (password prompted, never logged):"
            echo "---   dropdb -h ${DB_HOST:-127.0.0.1} -p ${DB_PORT:-5432} -U $DB_USER $DB_NAME   # only if you are SURE no newer data must survive"
            echo "---   createdb -h ${DB_HOST:-127.0.0.1} -p ${DB_PORT:-5432} -U $DB_USER -O $DB_USER $DB_NAME"
            echo "---   pg_restore -h ${DB_HOST:-127.0.0.1} -p ${DB_PORT:-5432} -U $DB_USER -d $DB_NAME $PG_BACKUP_FILE"
        else
            echo "--- DATABASE: PostgreSQL engine detected, but no backup was taken this run (failure happened before the backup step) — nothing to restore. ---"
        fi
    fi

    # Restore Frontend/dist if a botched build left it partially written.
    if [ -d "$APP_DIR/Frontend/dist.bak" ]; then
        rm -rf "$APP_DIR/Frontend/dist"
        mv "$APP_DIR/Frontend/dist.bak" "$APP_DIR/Frontend/dist"
    fi

    # Restart services on the now-reverted code — needed even if the failed
    # step wasn't a restart itself: if `systemctl restart` was the failure
    # (new code crashed on startup), the old process was already killed by
    # that attempt, so it must be explicitly relaunched here.
    if ! systemctl restart clinic-daphne 2>/dev/null; then
        echo "--- Rollback restart of clinic-daphne also failed. journalctl -u clinic-daphne (last 150 lines): ---"
        journalctl -u clinic-daphne -n 150 --no-pager 2>/dev/null || true
    fi
    if ! systemctl restart clinic-qcluster 2>/dev/null; then
        echo "--- Rollback restart of clinic-qcluster also failed. journalctl -u clinic-qcluster (last 150 lines): ---"
        journalctl -u clinic-qcluster -n 150 --no-pager 2>/dev/null || true
    fi
    if nginx -t 2>/dev/null; then
        systemctl reload nginx 2>/dev/null || true
    fi

    echo "=== Rolled back to $PREV_COMMIT and restarted services on the previous working version. ==="
    echo "=== Deploy FAILED and was rolled back: $(date -u '+%Y-%m-%d %H:%M:%S UTC') ==="
    exit 1
}

git pull origin main || rollback

# --- Backend deps ---
cd "$APP_DIR/Backend"
source venv/bin/activate || rollback
pip install -r requirements.txt || rollback
export DJANGO_SETTINGS_MODULE=clinic_project.settings.prod

# Detect the active database engine from Django's own settings (.env's
# DATABASE_URL) now that the venv/deps are ready to import it — used below
# to choose the backup strategy, and by rollback() if anything later fails.
# Never assumed: read fresh every run, so this script needs no further
# changes when the production database engine actually changes.
mapfile -t _db_info < <(detect_db_config)
DB_ENGINE="${_db_info[0]:-}"
DB_HOST="${_db_info[1]:-}"
DB_PORT="${_db_info[2]:-}"
DB_NAME="${_db_info[3]:-}"
DB_USER="${_db_info[4]:-}"
DB_PASSWORD="${_db_info[5]:-}"
unset _db_info   # don't let a copy of the password linger longer than needed

if [ -z "$DB_ENGINE" ]; then
    echo "--- Could not determine the database engine from Django settings — aborting before touching anything. ---"
    rollback
fi
echo "--- Detected database engine: $DB_ENGINE ---"

python manage.py collectstatic --noinput || rollback

# --- Frontend ---
# Deliberately BEFORE `migrate`: this is the step most likely to fail (lock
# file drift, a bad build) and it doesn't touch the database at all. Doing
# it first means a frontend failure rolls back with zero database risk.
cd "$APP_DIR/Frontend"
npm ci || rollback

rm -rf dist.bak
[ -d dist ] && cp -r dist dist.bak
npm run build || rollback
rm -rf dist.bak

# --- Database migration — deliberately the LAST thing that can still fail
#     before we start touching live services. Nothing below this point can
#     fail in a way that leaves code and schema out of sync: everything
#     that could still break (frontend build, dependency install) has
#     already succeeded by the time the schema changes at all. ---
cd "$APP_DIR/Backend"

# Back up the database before migrating — strategy depends on the engine
# detected above. Either branch must fully succeed before `migrate` runs;
# a failed/unverified backup aborts the deploy rather than proceeding with
# no safety net.
case "$DB_ENGINE" in
    django.db.backends.sqlite3)
        echo "--- Backup strategy: SQLite file copy (unchanged pre-existing behavior). ---"
        # Includes WAL/SHM, since WAL mode is in use. Deliberately NOT
        # deleted right after `migrate` succeeds — kept until the restart+
        # health-check below also succeeds (see rollback()'s restore logic
        # for why: a migration can succeed and the new code can still crash
        # on startup, which must undo the schema too, not just the code).
        for f in db.sqlite3 db.sqlite3-wal db.sqlite3-shm; do
            [ -f "$f" ] && cp "$f" "$f.pre-migrate-bak"
        done
        ;;
    django.db.backends.postgresql)
        echo "--- Backup strategy: PostgreSQL pg_dump (verified; manual restore only — see rollback()). ---"
        backup_postgres || rollback
        ;;
    *)
        echo "--- Unrecognized database engine '$DB_ENGINE' — refusing to guess a backup strategy. Aborting. ---"
        rollback
        ;;
esac

python manage.py migrate || rollback

# From this point on, if PostgreSQL is in use, rollback()'s phase-aware
# guard takes over: it will refuse to auto-revert the code, since the
# schema has now genuinely changed. See that guard's own comment for why.
MIGRATIONS_APPLIED=true

# --- Only reached once install/build/migrate all succeeded: sync config
#     and restart the live services onto the new code. ---
cp "$APP_DIR/deploy/clinic-daphne.service" /etc/systemd/system/clinic-daphne.service
cp "$APP_DIR/deploy/clinic-qcluster.service" /etc/systemd/system/clinic-qcluster.service
cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/clinic_app

nginx -t || rollback

systemctl daemon-reload
restart_and_verify clinic-daphne || rollback
verify_daphne_http || rollback
restart_and_verify clinic-qcluster || rollback
systemctl reload nginx || rollback

# Every step succeeded. SQLite's pre-migrate copy is safe to drop now (it
# was only ever a same-deploy safety net). PostgreSQL's pg_dump is
# deliberately left in place — unlike the SQLite copy it's a real point-in-
# time backup worth keeping for a while, and this script never deletes a
# database backup automatically; that's an operator/retention decision.
cd "$APP_DIR/Backend"
if [ "$DB_ENGINE" = "django.db.backends.sqlite3" ]; then
    for f in db.sqlite3 db.sqlite3-wal db.sqlite3-shm; do
        rm -f "$f.pre-migrate-bak"
    done
elif [ "$DB_ENGINE" = "django.db.backends.postgresql" ]; then
    [ -n "$PG_BACKUP_FILE" ] && echo "--- This deploy's PostgreSQL backup kept at $PG_BACKUP_FILE. ---"
    # Only reached on a fully successful deploy — see prune_postgres_backups()'s
    # own docstring for why a failed deploy's backups are never touched here.
    prune_postgres_backups
fi

echo "=== Deploy finished successfully: $(date -u '+%Y-%m-%d %H:%M:%S UTC') ==="
