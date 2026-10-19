#!/usr/bin/env bash
# Writes deploy/local/.env for deploy/local/docker-compose.yml: this machine's LAN address and a random table key.
#   deploy/local/setup.sh            # table only
#   deploy/local/setup.sh --cloud    # also a local cloud service (docker compose --profile cloud)
#   LAN_IP=192.168.1.50 deploy/local/setup.sh   # when the address found is not the one phones reach
# An existing .env is kept (its key too); delete it to start over. Runbook: docs/runbooks/local-docker.md
set -euo pipefail
cd "$(dirname "$0")"
cloud=0; [ "${1:-}" = "--cloud" ] && cloud=1
if [ -f .env ]; then echo ".env exists, keeping it:"; grep -v -E '^(TABLE_KEY|ADMIN_TOKEN)=' .env; exit 0; fi

ip="${LAN_IP:-}"
if [ -z "$ip" ] && command -v ipconfig >/dev/null 2>&1 && [ "$(uname)" = Darwin ]; then
  for i in en0 en1 en2; do ip=$(ipconfig getifaddr "$i" 2>/dev/null || true); [ -n "$ip" ] && break; done
fi
if [ -z "$ip" ] && command -v ip >/dev/null 2>&1; then
  ip=$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -1)
fi
if [ -z "$ip" ] && command -v hostname >/dev/null 2>&1; then ip=$(hostname -I 2>/dev/null | awk '{print $1}' || true); fi
[ -n "$ip" ] || { echo "Could not find this machine's LAN address; run again with LAN_IP=<address>" >&2; exit 1; }
case "$ip" in 127.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*) echo "warning: $ip looks like a loopback or container address; phones may not reach it (set LAN_IP)" >&2;; esac

rand() { od -An -N16 -tx1 /dev/urandom | tr -d ' \n'; }
{
  echo "# Written by setup.sh. Phones reach the table at PUBLIC_URL; keep TABLE_KEY on this machine."
  echo "TABLE_NAME=Game Table"
  echo "PORT=8080"
  echo "PUBLIC_URL=http://$ip:8080"
  echo "TABLE_KEY=$(rand)"
  if [ $cloud = 1 ]; then
    echo "COMPOSE_PROFILES=cloud"
    echo "CLOUD_URL=http://cloud:8081"
    echo "CLOUD_PUBLIC_URL=http://localhost:8081"
    echo "ADMIN_TOKEN=$(rand)"
  fi
} > .env
chmod 600 .env
echo "Wrote deploy/local/.env (PUBLIC_URL=http://$ip:8080$( [ $cloud = 1 ] && echo ', with the cloud profile'))."
echo "Next: docker compose -f deploy/local/docker-compose.yml up -d --build"
