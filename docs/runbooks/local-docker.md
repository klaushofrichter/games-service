# Runbook: Game Table on one machine with Docker

Runs the Game Table platform locally: the **Table Host** (lobby, games, AI players, the board and the phone pages)
with the built-in games, in Docker, on a computer in the same WiFi as the players' phones. It needs **no cloud
service, no DNS entry and no HTTPS**, and nothing from `games.skylar.technology`.

Written to be followed by a coding agent (for example Claude) as much as by a person. A typical instruction: *"Read
https://github.com/klaushofrichter/games-service and set up a running version of the core service with the built-in
games."* That is Part A below. Parts B and C are optional.

## For an agent following this

- Do the steps in order and run each **Check**; when a check fails, stop and report it with the output instead of
  improvising around it. *Troubleshooting* at the end covers the usual causes.
- You can verify everything except the phones yourself: health, games, simulated AI games (A5) and the board page.
  Ask the person to scan the QR code with a phone for the last check (A6).
- Do not change files in the repository to make the setup work; everything is configured in `deploy/local/.env`.
- Asked to add games from another repository, public or private: that is Part B (B2 for a private one: a clone and a
  folder), not Part C.
  The cloud service is never needed for games at the table.
- Report at the end: the board URL, the phone URL (`PUBLIC_URL`), and that `deploy/local/.env` holds the table key
  (do not paste the key into shared logs or chats).

## What you get, and what you don't

| Works locally (Part A) | Needs a cloud service (Part C, or not at all) |
| --- | --- |
| Board and phones over plain `http://` on the LAN, joining by QR code | Remote players outside the room |
| The built-in games (Coin Flip, Hold'em, Pachisi, Roulette), AI players, statistics | Installing extra-game repositories through a console (Part B adds games without one) |
| Game logs, saves, the Game Viewer, simulations, the board control API | Uploading logs, table metrics, the admin console |

Without a cloud service the table runs in *development mode*: nothing to pair, no pairing code, games start at once.

**Do I need the cloud service (its console)? No**, not to play at the table: the built-in games and games from any
other repository, public or private, run without it (Part B: clone the repository, point the table at its game
folders). The cloud service only adds remote players outside the room, installing game repositories through its
console, uploading logs and table metrics (Part C).

## Prerequisites

- **Docker** with the Compose plugin (`docker compose version` prints v2 or later): Docker Engine on Linux, Docker
  Desktop on macOS or Windows (on Windows, run the commands in WSL or Git Bash).
- **git**, and about 1 GB of disk for the image.
- The machine and the phones on **the same network**, not a guest WiFi that isolates devices. Port **8080** free and
  reachable from the LAN (a firewall may ask, or need a rule; see *Troubleshooting*).
- A browser on the machine for the board; a touchscreen is optional (a mouse works).

## Part A: the table with the built-in games

### A1. Get the code

```sh
git clone https://github.com/klaushofrichter/games-service
cd games-service
```

All later commands run from this folder.

### A2. Write the settings

```sh
deploy/local/setup.sh
```

It writes `deploy/local/.env` with `PUBLIC_URL` (this machine's LAN address, which goes into the QR code) and a
random `TABLE_KEY` (the key of the board control API). It keeps an existing `.env`; delete the file to start over.

**Check:** the script prints `PUBLIC_URL=http://<address>:8080`. The address must be the one phones reach, usually
`192.168.x.x` or `10.x.x.x`. If it picked the wrong one (a VPN, Docker's own `172.17.x.x`), run
`rm deploy/local/.env && LAN_IP=<the right address> deploy/local/setup.sh`. To find the address:
`ipconfig getifaddr en0` (macOS), `ip -4 route get 1.1.1.1` (Linux, the `src` value) or `ipconfig` (Windows, the WiFi
adapter's IPv4 address).

### A3. Build and start

```sh
docker compose -f deploy/local/docker-compose.yml up -d --build
```

This builds the Table Host image from the checkout (a few minutes the first time) and starts it in the background;
Docker restarts it after a reboot. Logs and saves live in the Docker volume `local_table-data`.

**Check:**

```sh
curl -s http://localhost:8080/health          # {"status":"ok","version":"dev","protocol":1}
docker compose -f deploy/local/docker-compose.yml logs table-host | head
```

The log names the board URL, the join URL with your LAN address, the games, and
`CLOUD_URL not set: running without the cloud service (development mode)`.

### A4. Check from the LAN address

```sh
set -a; . deploy/local/.env; set +a
curl -s "$PUBLIC_URL/health"                                          # the same answer as above
curl -s -H "X-Table-Key: $TABLE_KEY" "$PUBLIC_URL/api/v1/join"        # {"token":"…","url":"http://<LAN address>:8080/j/…"}
curl -s -H "X-Table-Key: $TABLE_KEY" "$PUBLIC_URL/api/v1/games" | grep -o '"id":"[a-z-]*"'
```

**Check:** the games include `coin-flip`, `holdem`, `pachisi` and `roulette`, and the join URL starts with
`PUBLIC_URL`. If the LAN address does not answer while `localhost` does, it is the firewall (*Troubleshooting*).

### A5. Play games with AI players (no phone needed)

```sh
curl -s -H "X-Table-Key: $TABLE_KEY" -X POST "$PUBLIC_URL/api/v1/simulation" \
  -d '{"gameId":"coin-flip","players":4,"games":20,"seed":42}' | grep -o '"endReasons":{[^}]*},"verified":[a-z]*'
```

**Check:** `"endReasons":{"finished":20},"verified":true`: twenty AI-only games ran to the end, and each one replayed
from its log to the same result. Every built-in game id works the same way.

### A6. Open the board and join with a phone

1. On the machine, open **`http://localhost:8080/board/`** in a browser, full screen (F11, or ⌃⌘F on macOS). The real
   setup is a 1920 × 1080 or larger touchscreen lying flat; a normal monitor works for trying it.
2. Scan the QR code on the board with a phone (or type the address under it) and enter a name. The phone shows the
   lobby, and the board shows the player at a seat.
3. On the board, choose a game, add AI players with *+ AI player* if you like, and start. Each phone shows its
   player's private part of the game (cards, bets, controls).

**Check:** a phone joined, and a game started and ended. *How to play* on the board and on the phones explains each
game.

### Everyday

| Task | Command (from the repository folder) |
| --- | --- |
| Logs | `docker compose -f deploy/local/docker-compose.yml logs -f table-host` |
| Stop / start | `docker compose -f deploy/local/docker-compose.yml stop` / `… start` |
| Update to the newest code | `git pull && docker compose -f deploy/local/docker-compose.yml up -d --build` |
| Another network (new LAN address) | `rm deploy/local/.env && deploy/local/setup.sh`, then `up -d` as in A3 |
| Remove everything, data included | `docker compose -f deploy/local/docker-compose.yml down -v` |
| The published image instead of building | `TABLE_HOST_IMAGE=ghcr.io/klaushofrichter/games-table-host:latest docker compose -f deploy/local/docker-compose.yml up -d --no-build` (linux/amd64 only; on Apple Silicon, build) |
| Board control API | everything the board can do, over HTTP with `X-Table-Key`: README, *Board control API* |

More Table Host settings (time limits, the AI's pause, remote seats) are environment variables, listed in the
README under *Table Host configuration*.

## Part B (optional): more games, from any repository

Games from other repositories run without the cloud service: a game is a folder (`games/<id>/` in its repository,
with a `manifest.json`), and the table runs every game folder it is given. You clone the repository, copy its game
folders next to the built-in ones, and point the table at that folder. A **private repository** works the same way
(B2): only the clone needs access; the table needs no token and no console.

### B1. Games from a public repository

The example is the public [`klaushofrichter/extra-games`](https://github.com/klaushofrichter/extra-games) (Chess,
Liar's Dice, Backgammon). Put all game folders, the built-in ones included, into one folder and point the table at it:

```sh
git clone https://github.com/klaushofrichter/extra-games ../extra-games
mkdir -p ../table-games
cp -r games/* ../extra-games/games/* ../table-games/
echo "GAMES=\"$(cd ../table-games && pwd)\"" >> deploy/local/.env
docker compose -f deploy/local/docker-compose.yml up -d
```

**Check:** `curl -s -H "X-Table-Key: $TABLE_KEY" "$PUBLIC_URL/api/v1/games" | grep -o '"id":"[a-z-]*"'` also lists
`backgammon`, `chess` and `liars-dice` (and the games of every repository you copied).

- `GAMES` must be an absolute path; the folder is mounted read-only at `/app/games` (there, the games find the SDK).
- Game folder names must differ between repositories: a folder copied later replaces one with the same name.
- To update: `git pull` in each clone, copy the game folders again, then
  `docker compose -f deploy/local/docker-compose.yml restart table-host`.
- A game repository is tested against a version of this one (often named in its `games-service.ref`); if a game
  does not load, the table's log says why (`docker compose -f deploy/local/docker-compose.yml logs table-host`), and
  updating this checkout (`git pull`, then `up -d --build`) usually helps.
- Writing a game of your own: [`docs/developers/game-development.md`](../developers/game-development.md).

### B2. Games from a private repository

A private game repository is installed like the public one above: cloned with your own access, its game folders
copied next to the others. Nothing on the table side is private-specific: no token in `deploy/local/.env`, no cloud
service, no console. Only the clone needs access.

1. **Access:** your GitHub account must be able to read the repository (the owner adds you, or you are in the
   organization). Check: `git ls-remote https://github.com/<owner>/<repo>` (or the SSH form below) lists its branches
   instead of saying *Repository not found*. For a coding agent: use the person's existing git access on this
   machine; ask them if the check fails, and never put a token into the repository or into `deploy/local/.env`.
2. **Clone** it next to this checkout, with whichever access the machine has:

   ```sh
   git clone git@github.com:<owner>/<repo>.git ../<repo>            # SSH key registered with GitHub
   git clone https://github.com/<owner>/<repo>.git ../<repo>        # HTTPS: git asks, or uses the credential helper
   gh repo clone <owner>/<repo> ../<repo>                           # GitHub CLI, after `gh auth login`
   ```

   Use the branch the repository releases from, if it has one (for example `git -C ../<repo> checkout production`);
   tables run what that branch holds.
3. **Add its games** to the folder the table uses, then let the table load them. The first three lines are what B1
   sets up; they change nothing when it is done already:

   ```sh
   mkdir -p ../table-games
   [ -d ../table-games/coin-flip ] || cp -r games/* ../table-games/      # the built-in games, once
   grep -q '^GAMES=' deploy/local/.env || echo "GAMES=\"$(cd ../table-games && pwd)\"" >> deploy/local/.env
   cp -r ../<repo>/games/* ../table-games/
   docker compose -f deploy/local/docker-compose.yml up -d                # picks up GAMES the first time
   docker compose -f deploy/local/docker-compose.yml restart table-host   # loads the games in the folder again
   ```

4. **Check:** the games list (as in B1) now has the repository's game ids (its `games/` folder names); the
   table's log names them at start (`docker compose -f deploy/local/docker-compose.yml logs table-host | grep games:`).
5. **Update** later: `git -C ../<repo> pull`, copy again (step 3), restart.

The games stay on this machine: the table serves them to the phones on the LAN and to nobody else. Several private
repositories: repeat steps 2-5 for each; their game folder names must differ.

## Part C (optional): a local cloud service

Adds the cloud service on the same machine, to try what it does: the admin console, extra-game repositories
installed through it, log uploads and remote play. Still plain `http://`, no DNS, no Google sign-in.

```sh
docker compose -f deploy/local/docker-compose.yml down     # keeps the data
rm deploy/local/.env && deploy/local/setup.sh --cloud      # a new table key, plus ADMIN_TOKEN and the cloud profile
docker compose -f deploy/local/docker-compose.yml up -d --build
```

1. The board now shows a 6-character **pairing code**. Open **`http://localhost:8081/admin`**, sign in with the
   `ADMIN_TOKEN` from `deploy/local/.env`, and approve the code. The notice on the board disappears.
2. The console's game repositories list `klaushofrichter/extra-games`; tick it for the table, and the table installs
   those games within a minute (the cloud service needs to reach `api.github.com`). More repositories: list them in
   `GAME_REPOS` in `deploy/local/.env` (`owner/name@branch`, comma-separated). A private one also needs
   `GAME_REPO_TOKEN` there: a GitHub token that can read it (fine-grained, *Contents: read*). This is only the console
   route; Part B2 needs neither.
3. *Invite* on the board creates a link for a remote player.

**Limit of plain http:** browsers allow remote play (it uses a service worker) only on `https://` or on `localhost`.
So an invite link (`http://localhost:8081/…`) works in a browser on this machine, which is enough to try it, but not
on another device. Remote play across networks needs the cloud service on an HTTPS address, which is out of scope
here. Players at the table and their phones are not affected: they never need HTTPS.

**Check:** `curl -s http://localhost:8081/health` answers `{"status":"ok",…}`, and the console shows the table
online.

Back to Part A: `docker compose -f deploy/local/docker-compose.yml down && rm deploy/local/.env && deploy/local/setup.sh`,
then `up -d` as in A3 (the cloud profile goes with the old `.env`).

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `required variable TABLE_KEY is missing` | No `deploy/local/.env`: run `deploy/local/setup.sh` (A2) |
| Phone: the page does not load | The phone is on another network, a guest WiFi with client isolation or a VPN, or the machine's firewall blocks port 8080. Test `curl "$PUBLIC_URL/health"` from another computer. Firewall: macOS *System Settings › Network › Firewall* (allow Docker); Linux `sudo ufw allow 8080/tcp`; Windows: allow Docker Desktop for private networks |
| The phone opens a wrong address | `PUBLIC_URL` is wrong (A2 check): rewrite `.env` with `LAN_IP`, then `up -d` |
| Board: `the board is only served on the table PC` | Not this compose file, which sets `ALLOW_REMOTE_BOARD=1`. Use it, and open `http://localhost:8080/board/` |
| `port is already allocated` | Something else uses 8080: set `PORT=8090` and `PUBLIC_URL=http://<address>:8090` in `.env` |
| The build cannot pull `node:26-bookworm-slim` | No access to Docker Hub (a proxy, offline): use the published image (*Everyday*) or a registry mirror |
| Games do not start; the board says the table is offline | `CLOUD_URL` is set but no cloud service runs: remove `CLOUD_URL` and `COMPOSE_PROFILES` from `.env` (Part A) |
| A remote invite link fails on another device | Expected over plain http (Part C, *Limit*) |

## Security notes

This setup is for a home or another trusted LAN. The board page, and with it control of the table, is served to every
device that reaches port 8080 (`ALLOW_REMOTE_BOARD=1`), because the board's browser reaches the container from outside
its loopback. Do not expose port 8080 to the internet. A real table PC (`deploy/table-pc/`) differs: host networking,
the board served only to the PC itself, and the cloud service over HTTPS.
