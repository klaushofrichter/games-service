# games-service

[![Release](https://img.shields.io/github/v/release/klaushofrichter/games-service?label=release&color=blue)](https://github.com/klaushofrichter/games-service/releases)
[![PR checks](https://github.com/klaushofrichter/games-service/actions/workflows/production-checks.yml/badge.svg)](https://github.com/klaushofrichter/games-service/actions/workflows/production-checks.yml)
[![Build main](https://github.com/klaushofrichter/games-service/actions/workflows/build-push.yml/badge.svg?branch=main)](https://github.com/klaushofrichter/games-service/actions/workflows/build-push.yml)
[![Deploy](https://github.com/klaushofrichter/games-service/actions/workflows/deploy-production.yml/badge.svg?branch=production)](https://github.com/klaushofrichter/games-service/actions/workflows/deploy-production.yml)
<!-- Static assertion: GitHub publishes no endpoint for alert status. -->
[![Dependabot](https://img.shields.io/badge/dependabot-enabled-025E8C?logo=dependabot&logoColor=white)](https://github.com/klaushofrichter/games-service/security/dependabot)

<!-- The repo is public since 13 Oct 2026 (D-096), so these badges render. Versions live on the release badge and the
     releases page, never in this text. -->

Game Table platform: a touchscreen **board** lying flat on a table, players' phones as private **decks**, a Linux **Table Host** that runs the games, and a **cloud service** at `games.skylar.technology` that enrolls tables, collects metrics and logs, and (from phase 1c) brokers remote players.

This repository implements phases 1a, 1b and 1c of the *Game Table — Concept & Architecture* document: lobby, seats, game selection, the game runtime with replayable logs, AI-only simulation, the board control API, pause on a lost service connection, the admin portal, a table PC kit, **remote play** over WebRTC, automated tests, and four playable games with their own board and phone UIs and rules for players: **Roulette**, **Pachisi**, **Hold'em** and **Coin Flip**. More games can come from other repositories, private ones included (*Extra-game repositories* below); [`klaushofrichter/extra-games`](https://github.com/klaushofrichter/extra-games) is the public example, with Chess, Liar's Dice and Backgammon. Decisions are recorded in [`docs/decisions.md`](docs/decisions.md).

## Quick start

Requires Node.js 26 (TypeScript runs natively, no build step).

```sh
npm install
npm test                 # the automated tests: lobby, cloud, sign-in and each game's rules
TABLE_KEY=dev npm run host
```

Open `http://localhost:8080/board/` on the table PC (full screen, 1920 × 1080 or 4K). Phones on the same WiFi scan the QR code, or type the URL shown under it. When no seat is free, the QR panel and the phone say so, and *+ AI player* and *Invite* are greyed out (D-129): choose more seats on the board, or remove a player. During a game the lobby's QR panel is not shown: *Settings › Show join code* shows the QR code and the address, so a phone that lost its seat can rejoin (D-130).

With Docker: `docker compose -f deploy/docker-compose.yml up --build` starts a cloud service and a table host. The table shows a 6-character pairing code; approve it in the admin portal at `http://localhost:8081/admin` (in local development it asks for `ADMIN_TOKEN`: `change-me-dev-admin-token` unless you set your own), or with

```sh
curl -X POST -H "Authorization: Bearer ${ADMIN_TOKEN:-change-me-dev-admin-token}" http://localhost:8081/admin/api/tables/pair/<CODE>
```

Or skip the pairing code: create an access code in the console (*Access codes*) and start with
`TABLE_CODE=ABCD-EFGH docker compose …`, or type it in the board's settings (*Access codes* below).

## A table on a Mac (development)

`scripts/mac-table.sh` runs a Table Host on a Mac against the live service at `games.skylar.technology` (Node 26 needed). It opens the board in the browser, puts the Mac's WiFi address in the QR code, and keeps the table's identity and API key in `~/.gametable-mac`, so a restart is the same table. The first time, the board shows a pairing code: approve it in the console at `https://games.skylar.technology/admin`. Allow `node` to accept incoming connections when macOS asks, or phones cannot join. `scripts/mac-table.sh --code ABCD-EFGH` uses an access code from the console instead, so no approval is needed. `CLOUD_URL= scripts/mac-table.sh` runs it without the service.

## Layout

| Path | What it is |
| --- | --- |
| `packages/protocol` | Message envelope, manifest schema (zod), seat layouts and edges, lobby types |
| `packages/sdk` | `defineGame`, seeded RNG, the `GameContext` games receive, `count()` and `list()` for end-of-game texts, cards (`cards.ts`) |
| `apps/table-host/src` | HTTP + WebSocket server, lobby (`table.ts`), game runtime and replay (`runtime.ts`), game logs (`logs.ts`, `game-log.ts`, and `log-format.md`, the README in every log), move lists and the Game Viewer's endpoints (`moves.ts`, `history.ts`), simulation, cloud link, remote-play gateway (`remote.ts`, WebRTC) |
| `apps/table-host/public` | Board and deck pages (plain HTML/CSS/JS), the board's Game Viewer (`board/viewer.js`); `shared/` has the board kit and the rules renderer (`markdown.js`) |
| `apps/cloud/src` | Cloud service: pairing, access codes (`access-codes.ts`), heartbeat, metrics, log upload/download, download tokens, invites and WebRTC signaling; its persistent state (`store.ts`, SQLite) |
| `apps/cloud/public` | Admin portal (`/admin`) and the remote player's invite page (`/i/CODE`) with its service worker |
| `games/roulette` | European roulette, 1–6 players, simultaneous betting, three AI styles |
| `games/pachisi` | Ludo-style race with dice and captures, 2–4 players, two AI levels |
| `games/holdem` | Fixed-limit Texas Hold'em, 2–8 players, private hole cards, side pots, two AI styles |
| `games/coin-flip` | Guess heads or tails, 1–8 players, simultaneous, AI, players can join mid-game, optional time limit, per-player statistics |
| `games/quartet` | Test game (hidden unless `SHOW_TEST_GAMES=1`): exactly 4 humans, no AI, sequential turns, ends if a player leaves |
| `apps/cloud/src/game-repos.ts`, `apps/table-host/src/extra-games.ts`, `packages/protocol/src/bundle.ts` | Extra-game repositories: fetching and packing on the service, installing on tables, the bundle format |
| `scripts/e2e/` | Browser end-to-end checks (Playwright): `run-all.sh` runs them all, `play.py` per game, `layout.py`, `admin.py` for the portal and sign-in, `codes.py` for access codes and a service restart, `remote.py` for remote play, `extra.py` for extra-game repositories, `logs.py` for game logs, `viewer.py` for the Game Viewer; shared helpers in `common.py` |
| `scripts/game-log.ts` | Reads a game log zip from the command line: an overview, a range of moves, one move in full with the state before and after (D-120) |
| `scripts/sync-secrets.sh` | Puts the values from your local `.env` into GitHub and the cluster, without printing them |
| `scripts/release-notes.sh`, `release.sh` | The release step of the deploy |
| `scripts/soak.ts` | AI-only soak run over every game and player count |
| `scripts/mac-table.sh` | A Table Host on a Mac against the live service (see above) |
| `docs/` | Decision log; the request to the kube-setup session for the cluster side; `runbooks/` for resetting and restoring the service's state |
| `tests/` | Vitest suites that drive a real host through the board control API and fake decks |
| `deploy/` | Dockerfiles, docker-compose, the table PC kit |
| `.github/` | The three workflows, Dependabot, the CodeQL gate and its accepted-findings list |

## Table Host configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | 8080 | HTTP and WebSocket port |
| `TABLE_NAME` | Game Table | Shown on the board and decks |
| `TABLE_KEY` | random per run | Key for the board control API (`X-Table-Key`) |
| `PUBLIC_URL` | `http://<lan-ip>:<port>` | Base of the join URL in the QR code |
| `CLOUD_URL` | unset | Cloud service; unset = development mode without cloud |
| `TABLE_CODE` (or `--code`) | unset | An access code from the console (D-113): the table is approved without a pairing code. Wins over a code typed on the board |
| `REQUIRE_CLOUD` | 0 | `1` blocks new games while the cloud is unreachable (production) |
| `GRACE_MS` | 60000 | How long a disconnected deck keeps its seat |
| `AI_DELAY_MS` | 800 | Pause before an AI player acts |
| `MAX_REMOTE_PLAYERS` | 4 | Remote seat limit (phase 1c) |
| `ALLOW_REMOTE_BOARD` | 0 | Serve the board to non-loopback clients (development only) |
| `ALLOW_NO_LOCAL_PLAYER` | 0 | `1` starts with the developer setting *Games without a player at the table* on (D-118); *Advanced* on the board (hammer and wrench, D-128) turns it on or off until the next restart |
| `LOG_SNAPSHOT_EVERY` | 0 | A snapshot of the whole game state in the log every N moves (D-116); 0: only the final state |
| `SHOW_TEST_GAMES` | 0 | `1` lists the test game (`quartet`) in the game menu; the tests and `run-all.sh` turn it on |
| `DATA_DIR`, `GAMES_DIR` | `<repo>/data`, `<repo>/games` | Logs, saves, the table's identity and a typed access code (`table.json`) and extra-game bundles (`extra-games/`); the built-in games |

## Board control API

Everything the board can do is available over HTTP on the table PC, for tests and for local AI agents (for example a Claude session) running simulations.

```sh
K="X-Table-Key: dev"; H=http://localhost:8080/api/v1
curl -s -H "$K" $H/state                                   # lobby state
curl -s -H "$K" -X POST $H/join/new                       # new join code (the board's QR code changes)
curl -s -H "$K" $H/games                                   # games, selectable + reasons
curl -s -H "$K" -X POST $H/ai -d '{}'                      # add an AI seat
curl -s -H "$K" -X POST $H/face -d '{"edge":"west"}'       # turn the lobby to a side (the board's corner buttons)
curl -s -H "$K" -X POST $H/game/select -d '{"gameId":"coin-flip","settings":{"rounds":5}}'
curl -s -H "$K" -X POST $H/simulation -d '{"gameId":"coin-flip","players":4,"games":100,"seed":42}'
curl -s -H "$K" $H/logs/<id>.zip -o run.zip                # JSONL game logs
curl -s -H "$K" "$H/history/<id>/1/moves?offset=0&limit=25" # a finished game's moves (D-120)
```

Full list: `GET /state, /join, /games, /metrics, /game/board, /logs, /logs/{id}.zip, /history, /history/{id}, /history/{id}/{game}/moves, /history/{id}/{game}/moves/{n}, /history/{id}/{game}/lines/{line}` and `POST /logs/{id}/verify, /join/new, /layout, /face, /rotate, /seats/move, /ai, /game/select, /game/settings, /game/prefs, /display, /game/start, /game/end, /game/close, /game/resume, /game/play-now, /game/skip-timer, /game/save, /simulation, /players/{id}/ai-options, /invites, /remote, /cloud/code`, `GET /saves, /qr?text=URL`, `DELETE /players/{id}`.

Remote players reach a subset over WebRTC (D-057): reads, except the join code, logs, saves, simulations, invites, the remote settings, QR codes and the access code; changes only `/layout` and `/game/select|start|end|close|play-now|skip-timer`. With board control they may also read `/history` (the Game Viewer, D-120), never the zips themselves.

Decks speak JSON envelopes over `/ws`: `system.hello {joinToken, name}` or `{sessionToken}` (remote decks: `{name}`), then `lobby.ready {ready}` and `game.intent {name, payload}`. The host answers with `system.welcome {playerId, sessionToken}`, `lobby.state`, `game.view {seat, view, events, over, timers, now}` (this seat only), `system.ack | reject {reason} | error {message}`, and `system.removed {reason}` when the player is removed. The board says `system.hello {role: "board", key}` and gets `game.board` instead of `game.view`.

## Writing a game

**The contract between games and the platform is [`docs/developers/game-development.md`](docs/developers/game-development.md)**:
the folder, the manifest, every rules hook and its exact behaviour, what the platform does about players (joining,
phones going away, leaving, exchanging a player), AI players, the end-of-game summary and awards, the board and phone
UI modules with everything they receive, rules for players, logs and replay, versions, testing, and a game repository
of your own, with a checklist. [`klaushofrichter/extra-games`](https://github.com/klaushofrichter/extra-games) is a complete example of games written against it in a repository of their own. It is written for people and for language models; [`llms.txt`](llms.txt) is its index
for LLMs, served at `https://games.skylar.technology/llms.txt` (and the whole guide at `/llms-full.txt`).

In short: a game is a folder with `manifest.json`, `rules.ts` (pure, deterministic functions on a JSON state:
`setup`, `onIntent`, `view`, `boardView`, `isOver`, optional `onTimer`, `onSeatChanged`, `onSeatJoined`,
`canContinueWithout`, `ai`, `aiFallback`, `describe`), optional `board.js` and `deck.js` UI modules
(`mount(root, ctx)` → `{ update(view, events, info), destroy(), whenIdle? }`), `how-to-play.md` and `assets/`. The
platform owns the lobby, seats, names, colours, away and leaving players, exchanges, pauses, AI scheduling, logs and
replay; a game never reimplements them. Start from `games/coin-flip`.

## Extra-game repositories

Games can also come from other GitHub repositories, private ones included (D-097), for private games and early
releases. The repositories the service lists are in `deploy/game-repos.json`. The public example is [`klaushofrichter/extra-games`](https://github.com/klaushofrichter/extra-games): three
complete games, tested against this repository, with CI and browser checks; copy its layout for a repository of your
own.

- **The list:** [`deploy/game-repos.json`](deploy/game-repos.json) is baked into the cloud image, so these
  repositories are back after every restart (D-098); change it by PR. In the console they are marked *deploy config*.
- **Console, *Game repositories*:** you can also add `owner/name` and a branch there, until the next restart. The service
  fetches each repository's `games/` folder as one bundle and lists its games; *Refresh* fetches again (it also does
  every hour). A private repository needs `GAME_REPO_TOKEN`, a fine-grained token with Contents: read on it; with several
  private repositories the one token must cover each of them (D-110).
- **Per table:** tick a repository when approving the table's pairing code, or later on its row. The table installs the
  games within 15 seconds, between games, and its board marks them *extra*. Remote players see them too: their board
  comes from the table.
- **A game repository** has a `games/` folder like this one, and its rules import the SDK by name:
  `import { defineGame } from "@game-table/sdk"` (the host maps the name to its own SDK). How such a repository is laid
  out and tested against this one: [`docs/developers/game-development.md`](docs/developers/game-development.md), *A game
  repository of your own*.

Ticking a repository trusts its code on that table PC (rules run in-process, D-035). The ticks, and repositories added
in the console, are kept by the service across restarts (D-114). A table approved with an access code gets the
repositories of the code's scope instead of ticks.

## Access codes

An access code approves a table at once, without a pairing code (D-113). Create one in the console under *Access
codes*: a label, a validity (one week, one month, one year or forever) and the games it brings (built-in only, all
repositories, or chosen ones). The console shows the code, like `ABCD-EFGH`, once; the service keeps only a hash.

- **On the table:** `TABLE_CODE=ABCD-EFGH` in the environment (the table PC's `.env`), `--code ABCD-EFGH` on the
  command line (also `scripts/mac-table.sh --code …`), or *Access code* in the board's settings, which has a keypad.
  A code given at start wins and can't be changed on the board. The board shows what the service said about it.
- **One table per code:** the first table that uses a code keeps it; any other is refused (*in use*) and waits with
  its pairing code. *Release* frees a code for a new table, for example after reinstalling the PC, and disconnects
  the old one.
- **Validity** counts only for that first use. A table connected past its code's validity keeps working and is
  flagged in the console, to disconnect by hand if it should stop.
- **Games:** the code's choice decides the table's extra-game repositories (*all* includes ones added later); edit it
  on the code's row and the table follows within 15 seconds, between games.
- **Revoke** or **Delete** disconnects the code's table; *Reconnect* on the table's row still brings it back. Codes
  that ended more than a year ago disappear by themselves.

## Remote play

A remote player gets an invite link (`https://games.skylar.technology/i/CODE`) from the board (*Invite remote player…*), optionally with their name (`?name=`, D-155). Opening it asks for a name (filled in from the link), then connects the browser **directly to the table** over WebRTC; the service only relays the connection offer and answer. The browser shows the same board as the table, with the player's private deck beside it.

```
 remote browser ──(1) /api/remote/ws: offer──▶ service ──(2) /api/tables/ws──▶ table host
        ◀──────────────(3) answer─────────────          ◀──────────────────────
        ◀═════════(4) WebRTC data channel "gt": board/deck files, API, live sockets═════════▶
```

- The service's `ICE_SERVERS` (JSON) sets STUN/TURN for both sides; without it, Google's public STUN is used. Add a TURN server for players behind strict NATs.
- The table needs outbound UDP; the table PC kit uses host networking. In bridged Docker (the dev `docker-compose.yml`) remote play only works with a TURN server.
- The remote board turns so the remote player's own seat is at the bottom of their screen. On an east or west seat, *Use the full width* shows the board upright instead (their seat at the side), and *Put my seat at the bottom* turns it back; the choice stays in that browser (D-101).
- `POST /api/v1/remote {"boardControl": false}` (or the checkbox in the invite dialog) makes the board read-only for remote players.

## Game logs

Every game is logged for analysis (D-008, D-116): to find out why a game or an AI misbehaved, by reading the log
yourself or handing it to Claude.

- **On the table, as the game goes:** every record is written to `DATA_DIR/logs/running/` while the game runs. When
  the game ends, for whatever reason, the log is packed into one zip in `DATA_DIR/logs/`. A game the table stopped in
  the middle of (switched off, crashed) is packed at the next start, marked *interrupted*. Simulations are packed at
  the end of the run.
- **To the service:** packed logs wait in a queue (`DATA_DIR/logs/outbox/`) and are uploaded when the table is
  online, retried after every heartbeat until the service has them.
- **In the zip:** `README.md` (the format, for a reader who has only the zip), `run.json` (game and version, table,
  start and end, players, settings, how it ended, counts, verification), `game-001.jsonl` (every move, timer and seat
  change, with refusals, events, AI timing and errors thrown by the rules) and `game-001.state.json` (the final
  state). A simulation has one pair of files per game. `LOG_SNAPSHOT_EVERY` adds state snapshots.
- **Verified:** every game is replayed when it ends, and `run.json` says whether it reached the same state; the
  console flags logs that *do not replay*. `POST /api/v1/logs/{id}/verify` replays a stored log on the table.
- **The move list (D-120):** each finished game's zip also has `game-001.moves.jsonl`, every record as a readable row
  in the game's own words (its `describe`), with **player moves numbered from 1**, refused ones too; timers, players
  joining or leaving and pauses are rows between them, and a silence of two minutes or more without a pause shows as a
  gap. Each row names its line in `game-001.jsonl`. The log also records when the game stood still and why
  (`pause`/`resume`: the service lost, an AI over its time, a player away; Play now). See *Moves* in `log-format.md`.
- **Game Viewer on the board (D-120):** *Game logs* under *Advanced* (D-128) lists the finished games on this table
  (not the one being played). A game opens as a table of its moves, a page at a time, with filters (a player, moves
  only, problems), *Move #* to jump to a move, and a simulation's games one by one; a move opens in full with its
  intent, events, AI timing, the state before and after, and a reference to copy such as
  `20261016044059-pachisi-491f #54`, so a developer can tell Claude exactly where to look. Remote players with board
  control can open it too. Simulations and older logs get their move list built when opened.
- **For developers and LLMs:** `node scripts/game-log.ts <zip>` reads a log without a table: `info`, `moves 40-45`,
  `move 43` (in full, with the state before and after), `state 43 [--before]`, `line 17`; `--json` for scripts,
  `--games ../my-games/games` for games from other repositories (states and descriptions need the game's rules in
  the version the log was written with).
- **Console:** *Game logs* lists them with their metadata and filters by game, table, date and kind. A download token
  can be limited the same way (game, table, from and to), so one link gives a pipeline or a Claude session exactly
  the logs it should read: `GET /dl/<token>` lists them, `GET /dl/<token>/<id>.zip` fetches one.

## Cloud service configuration

In the cluster these come from the `games-oauth` Secret (created by `scripts/sync-secrets.sh` from your `.env`) and the Deployment.

| Variable | Meaning |
| --- | --- |
| `PUBLIC_URL` | `https://games.skylar.technology`; an https URL requires Google sign-in |
| `DATA_DIR` | Where the state is kept (D-114): `state.db` (SQLite), `snapshots/state.db` (hourly and at shutdown) and `logs/`. In the cluster the PVC `games-cloud-data` at `/data`. Unset = memory only, lost at restart. A `RESTORE_FROM_SNAPSHOT` file there makes the next start use the snapshot |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | The service's own OAuth client, in Google Cloud project `skylar-technology` |
| `GOOGLE_REDIRECT_URI` | Exactly `PUBLIC_URL/auth/google/callback`; the service refuses to start otherwise |
| `ALLOWED_EMAILS` | Comma-separated admin allow-list, checked at sign-in and on every request |
| `COOKIE_SECRET` | Signs the session cookie (`openssl rand -hex 32`, at least 32 characters). Replace it and restart to end every session |
| `ADMIN_TOKEN` | Optional bearer token for scripts (`Authorization: Bearer …`, at least 16 characters); in local development it is the portal sign-in |
| `TRUST_PROXY` | `1` = trust `X-Forwarded-For` from loopback and the k3s pod/service networks, or a CIDR list |
| `PORT` | HTTP port (default 8081) |
| `MAX_REPLICAS` | Must be `1` (set by the cluster manifest); the service warns at start otherwise, since one process owns the database and the tables' sockets |
| `LOG_RETENTION_DAYS`, `ICE_SERVERS` | Log retention (default 90); STUN/TURN for remote play |
| `DATA_LIMIT_MB`, `LOG_STORAGE_MB` | The service's storage budget in `DATA_DIR` (default 1024, the PVC's size) and the cap on game logs within it (default 256). The budget is counted from the service's own files, since a `local-path` volume has no quota; the oldest logs make way before free space in it drops below 15 % (at least 100 MB), and a log that can't fit is refused (the table keeps its copy). The console's Overview shows the use |
| `GAME_REPO_TOKEN` | Read token for private extra-game repositories (D-097) |
| `GAME_REPOS_FILE`, `GAME_REPOS` | The deploy-time repository list (default `deploy/game-repos.json`; `none` turns it off), and more repositories (`owner/name@ref`, comma-separated) for local development (D-098) |
| `APP_VERSION` | Stamped into the image by the deploy (`YYYY.MM.DD.N`); `/health` (`{status, version}`, on the Table Host also `protocol`) reports it; `main` for main builds, `dev` when unset |

## The service's data

The service keeps its state on the PVC `games-cloud-data` at `/data` (D-114; `DATA_DIR` above), within a 1 GiB budget.
Single records are removed in the console (D-115):

- **Tables:** *Disconnect*, then *Delete* removes a table for good and frees its access code, optionally with its logs.
  If that PC connects again, it shows a new pairing code.
- **Game logs:** *Delete* on a log, or *Delete all simulation logs*. Retention (90 days) and the budget remove old ones
  by themselves.
- **Download tokens:** listed by label and expiry (never the token itself) with *Revoke*.
- **Access codes** and **console-added repositories:** *Delete* and *Remove* on their rows.

Everything at once, and going back to a backup, are runbooks for someone with cluster access:

- [`docs/runbooks/cloud-state-reset.md`](docs/runbooks/cloud-state-reset.md): empty the state and start over.
- [`docs/runbooks/cloud-state-restore.md`](docs/runbooks/cloud-state-restore.md): recover from the hourly snapshot
  (usually automatic), or restore the volume from Velero's daily backup (30 days).

## Branches, CI and deployment

Same shape as every service on the cluster (kube-setup's vault, *Building a New Service*):

```
feature branch → PR → main → (PR) → production → deploy
```

| Workflow | Trigger | Does |
| --- | --- | --- |
| `production-checks.yml` | PR to `main` or `production` | `test` (tests, typecheck, `npm audit --audit-level=high`, both images built and run non-root), `e2e` (all browser checks), `codeql` (fails on any finding not in `.github/codeql-accepted.tsv`) |
| `build-push.yml` | push to `main` | tests, then both images as `:main`, and nothing else |
| `deploy-production.yml` | push to `production` | on the in-cluster runner: calendar version, images as `:<sha>`, `:v<version>`, `:latest`, kube-setup manifest updated (push, then apply), rollout, smoke test until `/health` serves the new version, then a GitHub release with what the deploy verified |

`main` is built but never deployed. Releases are versioned `YYYY.MM.DD.N` (America/Chicago) at deploy time; nothing in the sources carries a version. Curated release notes go under `## [Unreleased]` in `CHANGELOG.md`.

## Testing

```sh
npm test                                   # rules, fuzzing, lobby, concurrency, API limits, platform, pause, cloud, sign-in, access codes, the persistent store, remote play, extra-game repositories, rules for players, seat names, SDK texts, game logs (Vitest)
npm run typecheck                          # tsconfig.check.json: apps, packages, games, tests, scripts
node scripts/soak.ts 100                   # 100 AI-only games per game and player count
scripts/e2e/run-all.sh out/                # every browser check, as CI runs them (pip install -r scripts/e2e/requirements.txt && python -m playwright install chromium)
# single checks; play.py and layout.py need a running host on port 8090 with TABLE_KEY=devkey
python3 scripts/e2e/play.py roulette out/  # also: pachisi, holdem, coinflip, endings, dialogs, rules (every game's rules on a 320 px phone)
python3 scripts/e2e/admin.py out/          # admin portal, sign-in and logout (starts its own cloud and host)
python3 scripts/e2e/codes.py out/          # access codes: console, board keypad, a service restart, a second table refused (starts its own cloud and two hosts)
python3 scripts/e2e/remote.py out/         # remote play in a second browser (starts its own cloud and host)
python3 scripts/e2e/seat_loss.py out/     # a player lost during a game: the waiting card, the phone's banner, the return, Remove that ends the game (starts its own host)
python3 scripts/e2e/developer.py out/     # the developer setting: the last player at the table, DEV on the gear, a game of AIs only (starts its own host)
python3 scripts/e2e/logs.py out/          # game logs: a simulation from the board, a game with a phone, a table stopped mid-game, the console (starts its own cloud and host)
python3 scripts/e2e/viewer.py out/        # the Game Viewer: logs from the lobby and the settings, moves, filters, Move #, a move in full, facing east (starts its own host)
python3 scripts/e2e/extra.py out/          # extra-game repositories: console, table, remote player (starts its own fake GitHub, cloud and host)
python3 scripts/e2e/layout.py out/         # decks at 4 phone sizes x 3 games, the board at 5 screen sizes
```

## Known limits

- Game rules run in-process; the isolated sandbox for third-party games comes later.
- The cloud keeps its state in SQLite on one volume (D-114), so it runs as exactly one replica.
- Tables authenticate to the cloud with an issued bearer token, not yet a key pair or certificate.
- Host-side AI configuration (`ai.hostConfig`, e.g. API keys) is parsed but has no screen yet. For language models it will also hold the model, the effort and a cost limit per game (D-112).
- werift waits up to 5 s for STUN during connection setup when STUN is unreachable.
