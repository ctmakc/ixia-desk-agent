#!/usr/bin/env bash
# Copy everything the demo produced off the Vultr VMs (the hackathon account is deleted
# 30 days after 3 Nov 2026 unless a card is added). Secrets (/etc/*/*.env) are not copied.
set -euo pipefail
DESK=${DESK_IP:-155.138.147.8}; PORTAL=${PORTAL_IP:-155.138.147.52}
OUT=${1:-/data/backups/ixia-desk-agent/$(date +%Y-%m-%d)}
mkdir -p "$OUT"
ssh -o BatchMode=yes root@$DESK 'tar -C / -czf - var/lib/ixia-desk etc/caddy/Caddyfile etc/systemd/system/ixia-desk.service' > "$OUT/desk-data.tgz"
ssh -o BatchMode=yes root@$PORTAL 'tar -C / -czf - var/lib/rc-portal etc/caddy/Caddyfile etc/systemd/system/rc-portal.service' > "$OUT/portal-data.tgz"
# The sandbox image is rebuilt from sandbox/Dockerfile (pinned base), so it is not copied.
ssh -o BatchMode=yes root@$DESK 'docker logs desk-proxy 2>&1' > "$OUT/desk-proxy.log"
( cd "$OUT" && sha256sum *.tgz *.tar.gz *.log > SHA256SUMS )
ls -la "$OUT"
