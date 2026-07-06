#!/usr/bin/env bash
# =============================================================================
# Deploiement BACKEND (NestJS + PM2) sur cPanel.
# A lancer manuellement sur le serveur, depuis le dossier du repo:
#     bash ./deploy-backend.sh
#
# Variables surchargeables (export VAR=... avant la commande):
#   BRANCH        branche git a deployer            (defaut: master)
#   REPO_DIR      dossier du repo sur le serveur    (defaut: ce dossier)
#   PM2_APP_NAME  nom du process PM2                (defaut: tingilin-api)
#   APP_PORT      port local du Node                (defaut: 3001)
# =============================================================================
set -euo pipefail

BRANCH="${BRANCH:-master}"
REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
PM2_APP_NAME="${PM2_APP_NAME:-tingilin-api}"
APP_PORT="${APP_PORT:-3001}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${APP_PORT}/health/ready}"

# --- Localisation de Node/npm/pm2 (cPanel EA-Nodejs) ----------------------------
if [ -z "${NODE_BIN:-}" ]; then
  if   [ -d /opt/cpanel/ea-nodejs22/bin ]; then NODE_BIN="/opt/cpanel/ea-nodejs22/bin"
  elif [ -d /opt/cpanel/ea-nodejs20/bin ]; then NODE_BIN="/opt/cpanel/ea-nodejs20/bin"
  elif command -v node >/dev/null 2>&1;    then NODE_BIN="$(dirname "$(command -v node)")"
  else echo "Node introuvable. Definis NODE_BIN."; exit 1
  fi
fi
export PATH="$NODE_BIN:$PATH"
NPM="${NPM:-$NODE_BIN/npm}"
PM2="${PM2:-$NODE_BIN/pm2}"
command -v "$PM2" >/dev/null 2>&1 || PM2="$NPM exec --yes pm2 --"

echo "==> Backend deploy | repo=$REPO_DIR | branch=$BRANCH | node=$("$NODE_BIN/node" -v)"
cd "$REPO_DIR"
mkdir -p logs "$HOME/env-backups"

# --- Sauvegarde du .env (jamais ecrase par git) --------------------------------
[ -f .env ] && cp .env "$HOME/env-backups/backend-env-$(date +%F-%H%M%S)" || true

# --- Recuperation du code ------------------------------------------------------
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"
git clean -fd -e .env -e logs/ -e uploads/ -e node_modules/

# --- Garde-fous ----------------------------------------------------------------
[ -f .env ] || { echo "ERREUR: .env manquant dans $REPO_DIR"; exit 1; }
chmod 600 .env

NODE_MAJOR="$("$NODE_BIN/node" -p "process.versions.node.split('.')[0]")"
[ "$NODE_MAJOR" -ge 20 ] || { echo "ERREUR: Node >= 20 requis (actuel $("$NODE_BIN/node" -v))"; exit 1; }

if ! grep -q '^NODE_ENV=production' .env; then
  echo "ATTENTION: NODE_ENV=production absent du .env (garde-fous prod desactives)."
fi

# --- Build (devDeps necessaires pour 'nest build') -----------------------------
if [ -f package-lock.json ]; then "$NPM" ci --no-audit --no-fund; else "$NPM" install --no-audit --no-fund; fi
"$NPM" run build
[ -f dist/main.js ] || { echo "ERREUR: dist/main.js manquant apres build"; exit 1; }

# --- PM2: (re)demarrage propre + persistance -----------------------------------
# On supprime toute entree existante (potentiellement morte/obsolete) puis on
# redemarre. Plus fiable que 'reload' qui no-op si l'entree est fantome
# ("Process not found"). Downtime ~1-2s, acceptable pour 1 instance.
echo "==> PM2 (re)demarrage"
$PM2 delete "$PM2_APP_NAME" >/dev/null 2>&1 || true
"$NODE_BIN/node" dist/scripts/migrate-payment-indexes.js
$PM2 start deploy/pm2/ecosystem.config.cjs --env production
$PM2 save   # persiste la liste des process (pour 'pm2 resurrect' au reboot)

# --- Healthcheck local ---------------------------------------------------------
echo "==> Healthcheck $HEALTH_URL"
for i in $(seq 1 30); do
  if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
    echo "✅ Deploy backend OK ($PM2_APP_NAME)"
    exit 0
  fi
  sleep 2
done

echo "❌ Healthcheck KO. Dernieres lignes de log:"
$PM2 logs "$PM2_APP_NAME" --lines 40 --nostream || true
exit 1
