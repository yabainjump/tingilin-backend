#!/usr/bin/env bash
set -euo pipefail

URL="${1:-http://127.0.0.1:3001/health/ready}"
TIMEOUT_SEC="${2:-3}"

curl -fsS --max-time "$TIMEOUT_SEC" "$URL" >/dev/null
