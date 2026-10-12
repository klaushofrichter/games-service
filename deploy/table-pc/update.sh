#!/bin/sh
# Pull the latest Table Host image and restart it. Games and logs in /var/lib/gametable are kept.
set -eu
cd /opt/gametable
docker compose pull
docker compose up -d
docker image prune -f >/dev/null
docker compose ps
