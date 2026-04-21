#!/usr/bin/env bash
set -euo pipefail

BRANCH="${BRANCH:-master}"
REPO_DIR="${REPO_DIR:-$HOME/public_html/backend.tinguilin.yaba-in.com}"
NODE_BIN="${NODE_BIN:-/opt/cpanel/ea-nodejs18/bin}"
NPM="${NPM:-$NODE_BIN/npm}"
HEALTH_URL="${HEALTH_URL:-https://backend.tinguilin.yaba-in.com/health/ready}"

export PATH="$NODE_BIN:$PATH"

cd "$REPO_DIR"

mkdir -p "$HOME/env-backups" tmp

if [ -f .env ]; then
  cp .env "$HOME/env-backups/backend-env-$(date +%F-%H%M%S)"
fi

git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"
git clean -fd -e .env -e tmp/ -e uploads/

[ -f .env ] || { echo ".env manquant"; exit 1; }

chmod 600 .env

if grep -Eiq '^(JWT_ACCESS_SECRET|JWT_REFRESH_SECRET)=(CHANGE_ME|REPLACE_ME|DEFAULT|TEST)' .env; then
  echo "Secrets JWT invalides dans .env"
  exit 1
fi

"$NPM" install --no-audit --no-fund
"$NPM" run build

[ -f app.js ] || { echo "app.js manquant pour Passenger"; exit 1; }
[ -f dist/main.js ] || { echo "dist/main.js manquant apres build"; exit 1; }

touch tmp/restart.txt

for i in $(seq 1 30); do
  if curl -fsS --max-time 10 "$HEALTH_URL" >/dev/null; then
    echo "Deploy backend OK"
    exit 0
  fi
  sleep 2
done

echo "Healthcheck failed"
curl -i https://backend.tinguilin.yaba-in.com/health || true
exit 1
