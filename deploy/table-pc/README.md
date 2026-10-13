# Table PC setup

Turns a Linux PC with a touchscreen into a Game Table: the Table Host runs in Docker, and a kiosk browser shows the board full screen at boot.

**Recommended:** Debian 12 (or Ubuntu 24.04) minimal install, a 16:9 touchscreen (1080p or 4K) lying flat, and the PC on the same WiFi/LAN as the players' phones. On Ubuntu, Chromium comes as a snap; Debian's native Chromium works more reliably in kiosk mode.

## Install

```sh
git clone <games-service repo> && cd games-service/deploy/table-pc
sudo ./install.sh
```

The script:

1. installs Docker, the Docker Compose plugin, Chromium and `cage` (a minimal compositor that runs one full-screen app, with no desktop and no screen blanking);
2. creates a `table` user for the kiosk and puts the files in `/opt/gametable`;
3. writes `/opt/gametable/.env` from `env.example` with a freshly generated `TABLE_KEY`;
4. starts the Table Host container (host networking, data in `/var/lib/gametable`) and enables `gametable-kiosk.service`, which opens `http://127.0.0.1:8080/board/` on the touchscreen once the host answers.

If the container image is private, log in to GitHub's registry first (a token with `read:packages`):

```sh
echo <token> | sudo docker login ghcr.io -u <github-user> --password-stdin
```

## First start

The board shows a 6-character **pairing code**. Approve it in the admin portal at `https://games.skylar.technology/admin` (or with `POST /admin/api/tables/pair/<code>`). The notice disappears and games can start. Players scan the QR code on the board, or type the address shown under it.

## Everyday

| Task | Command |
| --- | --- |
| Change settings (name, cloud URL, timeouts) | edit `/opt/gametable/.env`, then `sudo /opt/gametable/update.sh` |
| Update to the latest version | `sudo /opt/gametable/update.sh` |
| Pin a version | add `VERSION=v2026.10.13.1` (an image tag: `v<YYYY.MM.DD.N>` as on the GitHub releases page; default `latest`) to `/opt/gametable/.env`, then update |
| Host logs | `sudo docker logs -f $(sudo docker ps -qf name=table-host)` |
| Restart the board browser | `sudo systemctl restart gametable-kiosk` |
| Health | `curl http://127.0.0.1:8080/health` (`{"status":"ok","version":…,"protocol":…}`) |

Game logs and saves live in `/var/lib/gametable` and are deleted after the retention period set in the service (default 90 days).

## Notes

- The board page and its control API are only served to the PC itself (loopback); phones only get the deck pages. Keep `TABLE_KEY` on this machine.
- The PC's address can change (no fixed IP range at venues); the QR code always uses the current LAN address unless `PUBLIC_URL` is set.
- No offline play: without the service the board shows a notice, new games cannot start, and running games pause until the connection returns.
