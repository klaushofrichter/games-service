# games-service

Game Table platform: a touchscreen **board** lying flat on a table, players' phones as private **decks**, a Linux **Table Host** that runs the games, and a **cloud service** at `games.skylar.technology` that enrolls tables, collects metrics and logs, and (from phase 1c) brokers remote players.

This repository implements phases 1a and 1b of the *Game Table — Concept & Architecture* document: lobby, seats, game selection, the game runtime with replayable logs, AI-only simulation, the board control API, automated tests, and three playable games with their own board and phone UIs: **Roulette**, **Pachisi** and **Hold'em**. Remote play (phase 1c) builds on it. Decisions are recorded in [`docs/decisions.md`](docs/decisions.md).

## Quick start

Requires Node.js 22.18 or newer (TypeScript runs natively, no build step).

```sh
npm install
npm test                 # 80 automated tests: lobby, cloud, and each game's rules
TABLE_KEY=dev npm run host
```

Open `http://localhost:8080/board/` on the table PC (full screen, 1920 × 1080 or 4K). Phones on the same WiFi scan the QR code, or type the URL shown under it.

With Docker: `docker compose -f deploy/docker-compose.yml up --build` starts a cloud service and a table host. The table shows a 6-character pairing code; approve it with

```sh
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:8081/admin/api/tables/pair/<CODE>
```

## Layout

| Path | What it is |
| --- | --- |
| `packages/protocol` | Message envelope, manifest schema (zod), seat layouts and edges, lobby types |
| `packages/sdk` | `defineGame`, seeded RNG, the `GameContext` games receive |
| `apps/table-host/src` | HTTP + WebSocket server, lobby (`table.ts`), game runtime and replay (`runtime.ts`), logs, simulation, cloud link |
| `apps/table-host/public` | Board and deck pages (plain HTML/CSS/JS) |
| `apps/cloud/src` | Cloud service skeleton: pairing, heartbeat, metrics, log upload/download, download tokens, invite codes |
| `games/roulette` | European roulette, 1–6 players, simultaneous betting, three AI styles |
| `games/pachisi` | Ludo-style race with dice and captures, 2–4 players, two AI levels |
| `games/holdem` | Fixed-limit Texas Hold'em, 2–6 players, private hole cards, side pots, two AI styles |
| `games/coin-flip` | Stub game: 1–8 players, simultaneous, AI, dynamic players, timers |
| `games/quartet` | Stub game: exactly 4 humans, no AI, sequential turns, ends if a player leaves |
| `scripts/e2e/play.py` | Browser end-to-end check per game (Playwright): board plus phone decks, screenshots |
| `scripts/soak.ts` | AI-only soak run over every game and player count |
| `docs/` | Decision log, hand-off for deploying the cloud on Kubernetes |
| `tests/` | Vitest suites that drive a real host through the board control API and fake decks |
| `deploy/` | Dockerfiles, docker-compose, Kubernetes manifest for the cloud |

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
curl -s -H "$K" $H/games                                   # games, selectable + reasons
curl -s -H "$K" -X POST $H/ai -d '{}'                      # add an AI seat
curl -s -H "$K" -X POST $H/rotate -d '{"degrees":180}'
curl -s -H "$K" -X POST $H/game/select -d '{"gameId":"coin-flip","settings":{"rounds":5}}'
curl -s -H "$K" -X POST $H/simulation -d '{"gameId":"coin-flip","players":4,"games":100,"seed":42}'
curl -s -H "$K" $H/logs/<id>.zip -o run.zip                # JSONL game logs
```

Full list: `GET /state, /join, /games, /metrics, /game/board, /logs, /logs/{id}.zip` and `POST /layout, /rotate, /seats/move, /ai, /game/select, /game/start, /game/end, /game/close, /simulation`, `DELETE /players/{id}`.

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

## Testing

```sh
npm test                                   # rules, lobby, cloud and host integration (Vitest)
node scripts/soak.ts 100                   # 100 AI-only games per game and player count
# browser end-to-end (needs Python Playwright and a running host on port 8090 with TABLE_KEY=devkey)
python3 scripts/e2e/play.py roulette out/  # also: pachisi, holdem, coinflip
```

## Known limits

- Game rules run in-process; the isolated sandbox for third-party games comes later.
- The cloud keeps its state in memory: one replica, data lost on restart, until PostgreSQL is added.
- Tables authenticate to the cloud with an issued bearer token, not yet a key pair or certificate.
- AI seat configuration (`ai.options`) and host-side AI configuration (`ai.hostConfig`) are parsed but not yet shown.
- Pausing on a lost cloud connection during a game is not implemented yet; new games are blocked when `REQUIRE_CLOUD=1`.
