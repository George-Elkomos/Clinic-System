#!/bin/bash
set -uo pipefail
# Note: no `set -e` — failures are handled explicitly via `|| rollback` below
# so a bad deploy can restore the previous working state instead of just
# stopping halfway.

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

rollback() {
    echo "!!! A deploy step failed — rolling back to $PREV_COMMIT !!!"
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

    # Restore the database if a migration had already been applied before
    # this failure was detected. The pre-migrate backup is deliberately
    # kept on disk until the whole deploy (including the restart/health
    # check below) succeeds — not deleted the instant `migrate` itself
    # succeeds — so this also covers "migrate worked, but the new code
    # then crashed on startup," not just a failed migration.
    for f in db.sqlite3 db.sqlite3-wal db.sqlite3-shm; do
        if [ -f "$f.pre-migrate-bak" ]; then
            mv "$f.pre-migrate-bak" "$f"
            echo "--- Restored $f from pre-migrate backup. ---"
        fi
    done

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

# Back up the SQLite files (including WAL/SHM, since WAL mode is in use).
# Deliberately NOT deleted right after `migrate` succeeds — kept until the
# restart+health-check below also succeeds (see rollback()'s restore logic
# for why: a migration can succeed and the new code can still crash on
# startup, which must undo the schema too, not just the code).
for f in db.sqlite3 db.sqlite3-wal db.sqlite3-shm; do
    [ -f "$f" ] && cp "$f" "$f.pre-migrate-bak"
done

python manage.py migrate || rollback

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

# Every step succeeded — safe to drop the pre-migrate DB backup now.
cd "$APP_DIR/Backend"
for f in db.sqlite3 db.sqlite3-wal db.sqlite3-shm; do
    rm -f "$f.pre-migrate-bak"
done

echo "=== Deploy finished successfully: $(date -u '+%Y-%m-%d %H:%M:%S UTC') ==="
