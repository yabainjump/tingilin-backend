#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANCH="${BRANCH:-master}"
REPO_DIR="${REPO_DIR:-$SCRIPT_DIR}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.deploy.yml}"
INTERNAL_HEALTH_URL="${INTERNAL_HEALTH_URL:-http://127.0.0.1:3000/health/ready}"
HEALTH_URL="${HEALTH_URL:-https://backend.tinguilin.yaba-in.com/health/ready}"

cd "$REPO_DIR"

if [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER}" != "root" ]; then
  USER_HOME="$(getent passwd "$SUDO_USER" | cut -d: -f6)"
else
  USER_HOME="$HOME"
fi

BACKUP_DIR="${BACKUP_DIR:-$USER_HOME/env-backups}"

mkdir -p "$BACKUP_DIR" uploads

if [ -f .env ]; then
  cp .env "$BACKUP_DIR/backend-env-$(date +%F-%H%M%S)"
fi

if [ -f .htaccess ]; then
  cp .htaccess "$BACKUP_DIR/backend-htaccess-$(date +%F-%H%M%S)"
fi

git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"
git clean -fd -e .env -e .htaccess -e uploads/

[ -f .env ] || { echo ".env manquant"; exit 1; }
[ -f "$COMPOSE_FILE" ] || { echo "$COMPOSE_FILE manquant"; exit 1; }
[ -f Dockerfile ] || { echo "Dockerfile manquant"; exit 1; }

if grep -Eiq '^(JWT_ACCESS_SECRET|JWT_REFRESH_SECRET)=(CHANGE_ME|REPLACE_ME|DEFAULT|TEST)' .env; then
  echo "Secrets JWT invalides dans .env"
  exit 1
fi

docker compose -f "$COMPOSE_FILE" down
docker compose -f "$COMPOSE_FILE" build --pull
docker compose -f "$COMPOSE_FILE" up -d

for i in $(seq 1 30); do
  if curl -fsS --max-time 10 "$INTERNAL_HEALTH_URL" >/dev/null; then
    if curl -fsS --max-time 10 "$HEALTH_URL" >/dev/null; then
      echo "Deploy backend Docker OK"
      exit 0
    fi
  fi
  sleep 2
done

echo "Healthcheck failed"
docker compose -f "$COMPOSE_FILE" logs --tail=200 api || true
curl -i "$INTERNAL_HEALTH_URL" || true
curl -i "$HEALTH_URL" || true
exit 1
