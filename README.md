# games-service

[![Release](https://img.shields.io/github/v/release/klaushofrichter/games-service?label=release&color=blue)](https://github.com/klaushofrichter/games-service/releases)
[![PR checks](https://github.com/klaushofrichter/games-service/actions/workflows/production-checks.yml/badge.svg)](https://github.com/klaushofrichter/games-service/actions/workflows/production-checks.yml)
[![Build main](https://github.com/klaushofrichter/games-service/actions/workflows/build-push.yml/badge.svg?branch=main)](https://github.com/klaushofrichter/games-service/actions/workflows/build-push.yml)
[![Deploy](https://github.com/klaushofrichter/games-service/actions/workflows/deploy-production.yml/badge.svg?branch=production)](https://github.com/klaushofrichter/games-service/actions/workflows/deploy-production.yml)
<!-- Static assertion: GitHub publishes no endpoint for alert status. -->
[![Dependabot](https://img.shields.io/badge/dependabot-enabled-025E8C?logo=dependabot&logoColor=white)](https://github.com/klaushofrichter/games-service/security/dependabot)

<!-- The repo is private, so these badges render blank: they are fetched anonymously and no token can help.
     They start working if the repo ever goes public. Versions live on the release badge and the releases page,
     never in this text. -->

Game Table platform: a touchscreen **board** lying flat on a table, players' phones as private **decks**, a Linux **Table Host** that runs the games, and a **cloud service** at `games.skylar.technology` that enrolls tables, collects metrics and logs, and (from phase 1c) brokers remote players.

This repository implements phases 1a, 1b and 1c of the *Game Table — Concept & Architecture* document: lobby, seats, game selection, the game runtime with replayable logs, AI-only simulation, the board control API, pause on a lost service connection, the admin portal, a table PC kit, **remote play** over WebRTC, automated tests, and three playable games with their own board and phone UIs: **Roulette**, **Pachisi** and **Hold'em**. Decisions are recorded in [`docs/decisions.md`](docs/decisions.md).

## Quick start

Requires Node.js 26 (TypeScript runs natively, no build step).

```sh
npm install
npm test                 # the automated tests: lobby, cloud, sign-in and each game's rules
TABLE_KEY=dev npm run host
```

Open `http://localhost:8080/board/` on the table PC (full screen, 1920 × 1080 or 4K). Phones on the same WiFi scan the QR code, or type the URL shown under it.

With Docker: `docker compose -f deploy/docker-compose.yml up --build` starts a cloud service and a table host. The table shows a 6-character pairing code; approve it in the admin portal at `http://localhost:8081/admin` (in local development it asks for `ADMIN_TOKEN`), or with

```sh
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:8081/admin/api/tables/pair/<CODE>
```

## Layout

| Path | What it is |
| --- | --- |
| `packages/protocol` | Message envelope, manifest schema (zod), seat layouts and edges, lobby types |
| `packages/sdk` | `defineGame`, seeded RNG, the `GameContext` games receive |
| `apps/table-host/src` | HTTP + WebSocket server, lobby (`table.ts`), game runtime and replay (`runtime.ts`), logs, simulation, cloud link, remote-play gateway (`remote.ts`, WebRTC) |
| `apps/table-host/public` | Board and deck pages (plain HTML/CSS/JS) |
| `apps/cloud/src` | Cloud service: pairing, heartbeat, metrics, log upload/download, download tokens, invites and WebRTC signaling |
| `apps/cloud/public` | Admin portal (`/admin`) and the remote player's invite page (`/i/CODE`) with its service worker |
| `games/roulette` | European roulette, 1–6 players, simultaneous betting, three AI styles |
| `games/pachisi` | Ludo-style race with dice and captures, 2–4 players, two AI levels |
| `games/holdem` | Fixed-limit Texas Hold'em, 2–6 players, private hole cards, side pots, two AI styles |
| `games/coin-flip` | Stub game: 1–8 players, simultaneous, AI, dynamic players, timers |
| `games/quartet` | Stub game: exactly 4 humans, no AI, sequential turns, ends if a player leaves |
| `scripts/e2e/` | Browser end-to-end checks (Playwright): `run-all.sh` runs them all, `play.py` per game, `layout.py`, `admin.py` for the portal and sign-in, `remote.py` for remote play |
| `scripts/sync-secrets.sh` | Puts the values from your local `.env` into GitHub and the cluster, without printing them |
| `scripts/release-notes.sh`, `release.sh` | The release step of the deploy |
| `scripts/soak.ts` | AI-only soak run over every game and player count |
| `docs/` | Decision log; the request to the kube-setup session for the cluster side |
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
| `REQUIRE_CLOUD` | 0 | `1` blocks new games while the cloud is unreachable (production) |
| `GRACE_MS` | 60000 | How long a disconnected deck keeps its seat |
| `AI_DELAY_MS` | 800 | Pause before an AI player acts |
| `MAX_REMOTE_PLAYERS` | 4 | Remote seat limit (phase 1c) |
| `ALLOW_REMOTE_BOARD` | 0 | Serve the board to non-loopback clients (development only) |
| `DATA_DIR`, `GAMES_DIR` | `./data`, `./games` | Logs and table identity; installed games |

## Board control API

Everything the board can do is available over HTTP on the table PC, for tests and for local AI agents (for example a Claude session) running simulations.

```sh
K="X-Table-Key: dev"; H=http://localhost:8080/api/v1
curl -s -H "$K" $H/state                                   # lobby state
curl -s -H "$K" -X POST $H/join/new                       # new join code (the board's QR code changes)
curl -s -H "$K" $H/games                                   # games, selectable + reasons
curl -s -H "$K" -X POST $H/ai -d '{}'                      # add an AI seat
curl -s -H "$K" -X POST $H/rotate -d '{"degrees":180}'
curl -s -H "$K" -X POST $H/game/select -d '{"gameId":"coin-flip","settings":{"rounds":5}}'
curl -s -H "$K" -X POST $H/simulation -d '{"gameId":"coin-flip","players":4,"games":100,"seed":42}'
curl -s -H "$K" $H/logs/<id>.zip -o run.zip                # JSONL game logs
```

Full list: `GET /state, /join, /games, /metrics, /game/board, /logs, /logs/{id}.zip` and `POST /layout, /rotate, /seats/move, /ai, /game/select, /game/start, /game/end, /game/close, /game/resume, /game/save, /simulation, /players/{id}/ai-options, /invites, /remote`, `GET /saves, /qr?text=URL`, `DELETE /players/{id}`.

Decks speak JSON envelopes over `/ws`: `system.hello {joinToken, name}` or `{sessionToken}`, then `lobby.ready {ready}` and `game.intent {name, payload}`. The host answers with `lobby.state`, `game.view` (this seat only) and `system.ack | reject | error`.

## Writing a game

A game is a folder with `manifest.json` (validated by `packages/protocol`), `rules.ts`, and optionally its own UI: `board.js`, `deck.js`, CSS files and an `assets/` folder. The host serves the UI files to boards and decks but never the rules. `rules.ts`:

```ts
import { defineGame } from "../../packages/sdk/src/index.ts";
export default defineGame<State>({
  setup(ctx, settings) { ... },               // ctx.random(), ctx.setTimer(), ctx.seats
  onIntent(state, seat, intent, ctx) { ... }, // return { state, events } or { reject }
  view(state, seat) { ... },                  // private, per seat
  boardView(state) { ... },                   // public
  isOver(state) { ... },                      // summary { text, highlights } or null
  onTimer, onSeatJoined, onSeatLeft, ai,      // optional
});
```

The UI modules export `mount(root, ctx)` returning `{ update(view, events, info), destroy() }`. `info` carries the players, seat positions, the front edge and rotation, settings, and host timer deadlines for countdowns; the deck's `ctx.send(name, payload)` submits an intent and resolves with `{ ok, reason }`. `/shared/board-kit.js` has helpers for seat plates, rotation and countdowns, and `packages/sdk/src/cards.ts` has a deck, seeded shuffle and poker hand evaluation.

Rules must be deterministic: all randomness through `ctx.random()`. The host logs the seed and every input (intents, timer firings, seat changes), so `replay()` rebuilds any game exactly; the tests check this for live games and simulations.

## Remote play

A remote player gets an invite link (`https://games.skylar.technology/i/CODE`) from the board (*Invite…*). Opening it asks for a name, then connects the browser **directly to the table** over WebRTC; the service only relays the connection offer and answer. The browser shows the same board as the table, with the player's private deck beside it.

```
 remote browser ──(1) /api/remote/ws: offer──▶ service ──(2) /api/tables/ws──▶ table host
        ◀──────────────(3) answer─────────────          ◀──────────────────────
        ◀═════════(4) WebRTC data channel "gt": board/deck files, API, live sockets═════════▶
```

- The service's `ICE_SERVERS` (JSON) sets STUN/TURN for both sides; without it, Google's public STUN is used. Add a TURN server for players behind strict NATs.
- The table needs outbound UDP; the table PC kit uses host networking. In bridged Docker (the dev `docker-compose.yml`) remote play only works with a TURN server.
- The remote board turns so the remote player's own seat is at the bottom of their screen.
- `POST /api/v1/remote {"boardControl": false}` (or the checkbox in the invite dialog) makes the board read-only for remote players.

## Cloud service configuration

In the cluster these come from the `games-oauth` Secret (created by `scripts/sync-secrets.sh` from your `.env`) and the Deployment.

| Variable | Meaning |
| --- | --- |
| `PUBLIC_URL` | `https://games.skylar.technology`; an https URL requires Google sign-in |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | The service's own OAuth client, in Google Cloud project `skylar-technology` |
| `GOOGLE_REDIRECT_URI` | Exactly `PUBLIC_URL/auth/google/callback`; the service refuses to start otherwise |
| `ALLOWED_EMAILS` | Comma-separated admin allow-list, checked at sign-in and on every request |
| `COOKIE_SECRET` | Signs the session cookie (`openssl rand -hex 32`). Replace it and restart to end every session |
| `ADMIN_TOKEN` | Optional bearer token for scripts (`Authorization: Bearer …`); in local development it is the portal sign-in |
| `TRUST_PROXY` | `1` = trust `X-Forwarded-For` from loopback and the k3s pod/service networks, or a CIDR list |
| `LOG_RETENTION_DAYS`, `ICE_SERVERS` | Log retention (default 90); STUN/TURN for remote play |
| `APP_VERSION` | Stamped into the image by the deploy (`YYYY.MM.DD.N`); `/health` reports it, `dev` otherwise |

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
npm test                                   # rules, fuzzing, lobby, concurrency, API limits, platform, cloud, sign-in, remote play (Vitest)
npm run typecheck                          # tsconfig.check.json: apps, packages, games, tests, scripts
node scripts/soak.ts 100                   # 100 AI-only games per game and player count
scripts/e2e/run-all.sh out/                # every browser check, as CI runs them (pip install -r scripts/e2e/requirements.txt)
# single checks; play.py and layout.py need a running host on port 8090 with TABLE_KEY=devkey
python3 scripts/e2e/play.py roulette out/  # also: pachisi, holdem, coinflip, dialogs
python3 scripts/e2e/admin.py out/          # admin portal, sign-in and logout (starts its own cloud and host)
python3 scripts/e2e/remote.py out/         # remote play in a second browser (starts its own cloud and host)
python3 scripts/e2e/layout.py out/         # decks at 4 phone sizes x 3 games, the board at 5 screen sizes
```

## Known limits

- Game rules run in-process; the isolated sandbox for third-party games comes later.
- The cloud keeps its state in memory: one replica, and a restart (every deploy) forgets paired tables, invites and uploaded logs. A persistent store comes next.
- Tables authenticate to the cloud with an issued bearer token, not yet a key pair or certificate.
- Host-side AI configuration (`ai.hostConfig`, e.g. API keys) is parsed but has no screen yet.
- werift waits up to 5 s for STUN during connection setup when STUN is unreachable.
