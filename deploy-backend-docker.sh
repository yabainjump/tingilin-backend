#!/usr/bin/env bash
set -euo pipefail

BRANCH="${BRANCH:-master}"
REPO_DIR="${REPO_DIR:-$HOME/public_html/backend.tinguilin.yaba-in.com}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.deploy.yml}"
HEALTH_URL="${HEALTH_URL:-https://backend.tinguilin.yaba-in.com/health/ready}"

cd "$REPO_DIR"

mkdir -p "$HOME/env-backups" uploads

if [ -f .env ]; then
  cp .env "$HOME/env-backups/backend-env-$(date +%F-%H%M%S)"
fi

git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"
git clean -fd -e .env -e uploads/

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
  if curl -fsS --max-time 10 "$HEALTH_URL" >/dev/null; then
    echo "Deploy backend Docker OK"
    exit 0
  fi
  sleep 2
done

echo "Healthcheck failed"
docker compose -f "$COMPOSE_FILE" logs --tail=200 api || true
curl -i https://backend.tinguilin.yaba-in.com/health || true
exit 1
