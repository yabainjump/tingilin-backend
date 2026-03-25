#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE_PORT="${APP_PORT:-3001}"
PM2_APP_NAME="${PM2_APP_NAME:-tingilin-api}"

cd "$ROOT_DIR"
mkdir -p logs

echo "[1/5] Installing production dependencies"
npm ci --omit=dev

echo "[2/5] Building backend"
npm run build

echo "[3/5] Starting or reloading PM2 app"
if pm2 describe "$PM2_APP_NAME" >/dev/null 2>&1; then
    pm2 reload deploy/pm2/ecosystem.config.cjs --update-env
else
    pm2 start deploy/pm2/ecosystem.config.cjs --env production
fi

echo "[4/5] Persisting PM2 process list"
pm2 save

echo "[5/5] Verifying readiness"
for attempt in $(seq 1 30); do
    if curl -fsS --max-time 3 "http://127.0.0.1:${BASE_PORT}/health/ready" >/dev/null; then
        echo "Readiness probe succeeded."
        exit 0
    fi
    sleep 1
done

echo "Readiness probe failed after 30 seconds." >&2
exit 1
