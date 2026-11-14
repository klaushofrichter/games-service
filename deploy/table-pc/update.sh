#!/bin/sh
# Pull the latest Table Host image and restart it. Games and logs in /var/lib/gametable are kept.
set -eu
cd /opt/gametable
docker compose pull
docker compose up -d
# The kiosk's copy of the port (it can't read .env): when PORT changed, the kiosk starts again on the new one.
PORTLINE=$(grep -E '^PORT=' .env || true)
if [ "$PORTLINE" != "$(cat kiosk.env 2>/dev/null)" ]; then
  printf '%s\n' "$PORTLINE" > kiosk.env
  chmod 0644 kiosk.env
  systemctl restart gametable-kiosk.service 2>/dev/null || true
fi
docker image prune -f >/dev/null
docker compose ps
