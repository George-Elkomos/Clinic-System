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
