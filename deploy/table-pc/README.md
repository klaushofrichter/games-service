# Table PC setup

Turns a Linux PC with a touchscreen into a Game Table: the Table Host runs in Docker, and a kiosk browser shows the board full screen at boot.

**Recommended:** Debian 12 (Ubuntu 22.04 or later also works) minimal install, a 16:9 touchscreen (1080p or 4K) lying flat, and the PC on the same WiFi/LAN as the players' phones. On Ubuntu, Chromium comes as a snap; Debian's native Chromium works more reliably in kiosk mode.

## Install

```sh
git clone https://github.com/klaushofrichter/games-service && cd games-service/deploy/table-pc
sudo ./install.sh
```

The script:

1. installs Docker, the Docker Compose plugin, Chromium and `cage` (a minimal compositor that runs one full-screen app, with no desktop and no screen blanking);
2. creates a `table` user for the kiosk and puts the files in `/opt/gametable`;
3. writes `/opt/gametable/.env` from `env.example` with a freshly generated `TABLE_KEY`;
4. starts the Table Host container (host networking, data in `/var/lib/gametable`) and enables `gametable-kiosk.service`, which opens `http://127.0.0.1:8080/board/` on the touchscreen once the host answers.

The image (`ghcr.io/klaushofrichter/games-table-host`) is public, so no registry login is needed.

## First start

The board shows a 6-character **pairing code**. Approve it in the console at `https://games-console.skylar.technology` (or with `POST /admin/api/tables/pair/<code>` and `ADMIN_TOKEN`). The notice disappears and games can start. Players scan the QR code on the board, or type the address shown under it.

## Everyday

| Task | Command |
| --- | --- |
| Change settings (name, cloud URL, timeouts) | edit `/opt/gametable/.env`, then `sudo /opt/gametable/update.sh` |
| Update to the latest version | `sudo /opt/gametable/update.sh` |
| Pin a version | add `VERSION=v2026.10.13.1` (an image tag: `v<YYYY.MM.DD.N>` as on the GitHub releases page; default `latest`) to `/opt/gametable/.env`, then update |
| Host logs | `sudo docker logs -f $(sudo docker ps -qf name=table-host)` |
| Restart the board browser | `sudo systemctl restart gametable-kiosk` |
| Health | `curl http://127.0.0.1:8080/health` (`{"status":"ok","version":…,"protocol":…}`) |

`/var/lib/gametable` holds the game logs and saves (deleted after the retention period set in the service, default 90 days), the games installed from extra-game repositories (`extra-games/`), and the table's identity (`table.json`): delete that and the table must be paired again.

## Notes

- The board page is served to the PC itself (loopback), which is where it gets `TABLE_KEY`, and to another screen on the same network that was given the board's link (settings › *Board on another screen…*, D-190; the link carries the key, so show it only on your own screens). The control API needs the key from anyone else. Phones only get the deck pages. Keep `TABLE_KEY` on this machine.
- The PC's address can change (no fixed IP range at venues); the QR code always uses the current LAN address unless `PUBLIC_URL` is set.
- No offline play: without the service the board shows a notice, new games cannot start, and running games pause until the connection returns.
