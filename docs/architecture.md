# Architecture overview

A high-level picture of Game Table: its parts, how a game is set up, and how a game's code and the platform work
together. The details are in the [developer guide](developers/game-development.md) (the contract for games) and the
[README](../README.md) (configuration, APIs); the words are in the [glossary](glossary.md).

## The parts

```
   at the table                                                    elsewhere
 ┌──────────────────────────────────────────────┐
 │  Board (browser, 1920 × 1080, lying flat)     │        ┌───────────────────────────────┐
 │    lobby · the game's board UI · settings     │        │ Remote player's browser       │
 └───────────────▲──────────────────────────────┘        │   remote board + their deck   │
                 │ HTTP + WebSocket (LAN)                 │ Watcher's browser: board only │
 ┌───────────────┴──────────────────────────────┐        └──────────────▲────────────────┘
 │  Table Host (Node, the PC under the table)    │   WebRTC data channel  │ (peer to peer)
 │    lobby and seats · game runtime (rules)     ◀════════════════════════╝
 │    AI players · timers · logs · replay        │
 │    serves the board, deck and game files      ├──── WebSocket ────▶ ┌────────────────────────┐
 └───────────────▲──────────────────────────────┘                      │ Game service (cloud)   │
                 │ HTTP + WebSocket (LAN)                               │  pairing, access codes │
 ┌───────────────┴──────────────────────────────┐                      │  invites, signaling    │
 │  Decks (each player's phone browser)          │                      │  extra-game repos      │
 │    the game's deck UI: private view, moves    │                      │  log upload, console   │
 └──────────────────────────────────────────────┘                      │  website               │
                                                                        └────────────────────────┘
```

- **The Table Host** is the centre. It owns the lobby (seats, names, colours, the QR code), runs the game's rules,
  schedules AI players, keeps every game's log and serves the board, the decks and the game files. Everything that is
  true about a game is in the Table Host's state; the screens only show it.
- **The board and the decks** are plain web pages. They load the platform's page (lobby, settings, seat plates) and,
  during a game, the game's own UI modules. They hold no rules.
- **The game service** is optional for play at the table. It enrolls tables (pairing codes, access codes), offers
  extra-game repositories to them, collects logs and metrics, has the console, and relays the first handshake of
  remote play. Game moves never pass through it: a remote browser talks to the table directly over WebRTC.

## A game is a folder

```
games/<id>/
  manifest.json     what the platform needs to know: players, seat layouts, settings, AI, version
  rules.ts          the rules: pure functions on a JSON state (runs on the Table Host)
  board.js          the board UI: draws the board view, animates events (runs in the board's browser)
  deck.js           the phone UI: draws one player's view, sends their moves (runs in each phone's browser)
  how-to-play.md    the rules for players, shown on the phones and the board
  assets/           images, sounds, shared code for both UIs
```

Games come from this repository (`games/`, the built-in games) or from **extra-game repositories** with the same
layout. A table at home is pointed at their folders; a table connected to a game service gets them from the service,
which fetches each repository as one bundle. Either way the Table Host loads every game folder it is given; the rules
import the SDK by name (`@game-table/sdk`), and the host provides it.

## How a game runs

```
 phone (deck.js)        Table Host                                   board (board.js) and all decks
 ───────────────        ─────────────────────────────────────        ───────────────────────────────
 ctx.send("play",  ──▶  intent ──▶ rules.onIntent(state, seat, …)
   { id: 12 })                      ├─ reject: { reason } ──▶ back to that phone ("That card doesn't match")
                                    └─ accept: new state + events
                                         │  log the intent (for replay)
                                         ├─ view(state, seat)  ──▶ each deck:   update(view, events, info)
                                         ├─ boardView(state)   ──▶ each board:  update(view, events, info)
                                         └─ isOver(state)?     ──▶ the end: result, awards, statistics
```

1. **Setup.** The lobby fixes the seats and the game's settings; the host calls `setup(ctx)` with them, and the
   state is born. `ctx.random()` gives the randomness, `ctx.now()` the time: nothing else, so the log can replay it.
2. **Intents.** A player acts on their phone (`ctx.send(name, payload)`), by touching the board for a seat it may
   control (`ctx.act`), or an AI player chooses one (`ai()`). All of them reach `onIntent`, which checks everything
   (whose turn, the payload, the phase) and either rejects with a reason for people or returns the new state and
   **events** (what just happened, for animation).
3. **Views.** After every change the host sends each seat its `view` (private: their cards) and every board the
   `boardView` (public), with the events. The UIs redraw from the view and animate the events; they never compute
   rules.
4. **Timers.** The rules set timers (`ctx.setTimer`) for turn limits and pauses; when one fires, the host calls
   `onTimer`. The board may fire a listed timer early ("Next hand", `skipTimers`).
5. **AI players** are asked for an intent when it is their move, at the board's pace: the host waits for the
   board's `whenIdle()` (its animations) first, so they feel like people. They read only their seat's view; a slow
   AI can run in a worker thread (`ai.worker`).
6. **The end.** `isOver(state)` returns the result text, a table, and awards; the platform adds each player's moves
   and thinking time, shows the result on the board and the statistics window, and stores the log. Every finished
   game is **replayed** from its log, and must reach the same state.

## What the platform owns, and what the game owns

| The platform | The game |
| --- | --- |
| Lobby, seats, seat layouts, names, colours, the QR code, joining | Which seat layouts and edges suit it (`manifest.json`) |
| Phones going away and coming back, *Leave*, exchanging a player, watchers | `onSeatChanged`: update names kept in the state, nothing more |
| Remote players and watchers (invites, WebRTC), the remote board's turning | Nothing: it draws for `info.frontEdge` like any board |
| AI scheduling, its time limit, pausing when something is wrong | `ai()`: one intent for one seat, from that seat's view |
| Timers' clock, pauses, the turn countdown in `info.timers` | Which timers exist and what happens when they fire |
| Seat plates, the board's settings window, sound on or off, rules window | The board UI inside: the game's look, its preferences, its sounds |
| Logs, replay checks, the Game Viewer, simulations, statistics | `describe` (readable moves), `isOver` (result, table, awards) |
| The sling: dragging on the phone, live gestures, flights on the board | What can be slung, what it means (an intent), what it looks like |

A game never reimplements a row's left side: it reacts to the hooks (developer guide, *Players and seats*).

## How the screens get the game

The board page and the deck page are the platform's. When a game starts they import the game's `board.js` and
`deck.js` from the Table Host (`/games/<id>/…`) and call `mount(root, ctx)`; from then on the platform calls
`update(view, events, info)` with every change. `info` carries what the platform knows and the game may use: the
players and their seats, colours and where each sits on the board (`seatPositions`), timers, which seats this board
may act for, the table's sound setting, the game's preferences. Both UIs are plain browser modules: no build step,
no framework required; the board kit (`/shared/board-kit.js`) and the sling (`/shared/sling.js`) are there to use.

A remote player's browser gets the same pages and modules from the table, through the WebRTC data channel, so a game
needs nothing special for remote play.

## Where to look in the code

| Part | Path |
| --- | --- |
| The rules API games use | `packages/sdk/src/index.ts` |
| The manifest schema and lobby types | `packages/protocol/src/index.ts` |
| Lobby and seats | `apps/table-host/src/table.ts` |
| Game runtime, replay | `apps/table-host/src/runtime.ts` |
| AI players | `apps/table-host/src/ai.ts`, `ai-worker.ts` |
| Logs, the Game Viewer's moves | `apps/table-host/src/logs.ts`, `moves.ts` |
| The board and deck pages | `apps/table-host/public/board/`, `public/deck/`, `public/shared/` |
| Remote play (table side) | `apps/table-host/src/remote.ts` |
| The game service and its console | `apps/cloud/src/`, `apps/cloud/public/admin.html` |
| The smallest complete game | `games/coin-flip/` |
