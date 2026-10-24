#!/bin/sh
# Set up a Game Table PC on Debian 12 or Ubuntu 22.04+: Docker, the Table Host container, and a
# kiosk browser that shows the board on the touchscreen at boot. Run as root: sudo ./install.sh
set -eu

[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo ./install.sh" >&2; exit 1; }
HERE=$(cd "$(dirname "$0")" && pwd)
DIR=/opt/gametable

echo "==> Installing packages (Docker, cage, Chromium)"
apt-get update -q
apt-get install -y -q ca-certificates curl openssl docker.io cage
apt-get install -y -q docker-compose-plugin 2>/dev/null || apt-get install -y -q docker-compose-v2
apt-get install -y -q chromium 2>/dev/null || apt-get install -y -q chromium-browser
systemctl enable --now docker

echo "==> Kiosk user 'table'"
id table >/dev/null 2>&1 || useradd -m -s /bin/sh -G video,input,render table 2>/dev/null || useradd -m -s /bin/sh -G video,input table

echo "==> Files in ${DIR}"
mkdir -p "$DIR" /var/lib/gametable
install -m 0644 "$HERE/docker-compose.yml" "$DIR/docker-compose.yml"
install -m 0755 "$HERE/kiosk.sh" "$DIR/kiosk.sh"
install -m 0755 "$HERE/update.sh" "$DIR/update.sh"
if [ ! -f "$DIR/.env" ]; then
  install -m 0600 "$HERE/env.example" "$DIR/.env"
  KEY=$(openssl rand -hex 16)
  sed -i "s/^TABLE_KEY=.*/TABLE_KEY=${KEY}/" "$DIR/.env"
  echo "    created ${DIR}/.env with a new TABLE_KEY"
fi
chown -R 1000:1000 /var/lib/gametable   # the container runs as the 'node' user (uid 1000)

echo "==> Kiosk service"
install -m 0644 "$HERE/gametable-kiosk.service" /etc/systemd/system/gametable-kiosk.service
systemctl daemon-reload
systemctl set-default graphical.target >/dev/null
systemctl enable gametable-kiosk.service

echo "==> Starting the Table Host"
if ! (cd "$DIR" && docker compose pull); then
  echo "    Could not pull the image (it is public: check the network and the VERSION in ${DIR}/.env),"
  echo "    then run: sudo ${DIR}/update.sh"
  exit 1
fi
(cd "$DIR" && docker compose up -d)
systemctl restart gametable-kiosk.service || true

PORT=$(grep -E '^PORT=' "$DIR/.env" | cut -d= -f2)
echo
echo "Done. The board opens on the touchscreen. On first start it shows a pairing code:"
echo "approve it in the console (https://games-console.skylar.technology)."
echo "Settings: ${DIR}/.env    Update: sudo ${DIR}/update.sh    Logs: docker logs -f \$(docker ps -qf name=table-host)"
echo "Health: curl http://127.0.0.1:${PORT:-8080}/health"
