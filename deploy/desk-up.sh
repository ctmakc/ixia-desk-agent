#!/usr/bin/env bash
# Desk VM: sandbox network (internal, no route out), egress proxy (the only exit), sandbox image.
# Usage: PORTAL_HOST=portal-demo.ixia.online bash deploy/desk-up.sh
set -euo pipefail
cd "$(dirname "$0")/.."
: "${PORTAL_HOST:?PORTAL_HOST required}"
docker network inspect desk-sbx >/dev/null 2>&1 || docker network create --internal desk-sbx >/dev/null
docker rm -f desk-proxy >/dev/null 2>&1 || true
docker run -d --name desk-proxy --restart unless-stopped --network bridge \
  --read-only --cap-drop ALL --security-opt no-new-privileges --memory 128m --pids-limit 64 \
  -e ALLOW="$PORTAL_HOST" -v "$PWD/proxy/egress-proxy.js:/p.js:ro" node:20-alpine node /p.js >/dev/null
docker network connect desk-sbx desk-proxy
docker build -q -t ixia-desk-sandbox:dev sandbox >/dev/null
echo "desk-sbx network, desk-proxy (allow $PORTAL_HOST), sandbox image ready"
