# Writing a game for Game Table

This is the contract between a game and the Game Table platform: what a game provides, what the platform does for it,
and the rules both sides keep. It is written for people and for language models that write games. If something here
and the code disagree, the code in this repository is right and this page is wrong: say so in an issue or a pull
request.

- **Platform:** this repository, `games-service` (public): the Table Host that runs games, the board and phone pages,
  the SDK, the cloud service at `https://games.skylar.technology`.
- **Short index for language models:** [`/llms.txt`](../../llms.txt), also served at
  `https://games.skylar.technology/llms.txt`; this whole page at `https://games.skylar.technology/llms-full.txt`.
- **Example game repository:** [`klaushofrichter/extra-games`](https://github.com/klaushofrichter/extra-games) (public): Chess, Liar's Dice, Backgammon, Mexican Train and Last Card in a repository of their own, with
  the test setup and CI against this repository (section 15).
- **Reference games in this repository:** `games/coin-flip` (the smallest complete game: simultaneous turns, timers,
  statistics, players joining mid-game), `games/pachisi` (turns, dice, moves made by touching the board),
  `games/holdem` (private cards, AI styles, a skippable wait, sounds), `games/roulette` (simultaneous betting, AI
  styles). Read one of them next to this page.

## Contents

1. [The table in one minute](#1-the-table-in-one-minute)
2. [Principles](#2-principles)
3. [A game's folder](#3-a-games-folder)
4. [The manifest](#4-the-manifest)
5. [The rules (`rules.ts`)](#5-the-rules-rulests)
6. [Players and seats: what the platform does, and what a game hears](#6-players-and-seats)
7. [AI players](#7-ai-players)
8. [The end of a game: summary, table, awards](#8-the-end-of-a-game)
9. [The board UI (`board.js`)](#9-the-board-ui-boardjs)
10. [The phone UI (`deck.js`)](#10-the-phone-ui-deckjs)
11. [Rules for players (`how-to-play.md`)](#11-rules-for-players-how-to-playmd)
12. [Logs, replay and the Game Viewer](#12-logs-replay-and-the-game-viewer)
13. [Versions](#13-versions)
14. [Testing](#14-testing)
15. [A game repository of your own](#15-a-game-repository-of-your-own)
16. [Checklist before a pull request](#16-checklist-before-a-pull-request)

## 1. The table in one minute

- **The board** is a touchscreen lying flat on a table (1920 × 1080 logical pixels), seen from all sides. It shows the
  lobby and, during a game, the game's public view.
- **The decks** are the players' phones. Each shows that player's private view and sends their moves.
- **The Table Host** (a PC under the table) runs the lobby and the game's rules, keeps the log, and serves the board
  and phone pages over the local network.
- **Remote players** join through an invite from the cloud service. They get the same board (turned towards their own
  seat) and the same phone page, through a peer-to-peer channel to the table. **Watchers** get the board only: no seat,
  no phone page, not in `info.players`; a game needs to do nothing for them, beyond keeping secrets out of `boardView`.
- **AI players** sit in seats like people. The platform asks the game's `ai()` for their moves.
- Up to 8 seats, on the four edges of the table (`north`, `east`, `south`, `west`). Seat layouts have 2, 4, 6 or 8
  seats.

A game is **rules** (pure functions on a state, run by the host) plus **two UIs** (the board and the phone, plain
browser JavaScript modules that draw what the rules' views say). Everything else is the platform's: lobby, seats,
joining, names and colours, phones going away and coming back, exchanging players, pausing, AI scheduling, logs,
replay, statistics, rules for players, settings and remote play.

## 2. Principles

1. **One way for the same thing, in every game.** The platform owns everything about players: joining, leaving, a
   phone that goes away, replacing a player, names, colours, turning the board, pausing. A game never invents its own
   timeout, its own "replace a player" or its own lobby. It reacts to the hooks below.
2. **A running game keeps all its players.** The number of seats never changes during a game; a seat is never emptied.
   Who plays a seat can change (the board *exchanges* a player for another person or an AI); the game is told.
3. **Rules are deterministic and pure.** Same state, same inputs, same random numbers: same result. Every game can be
   replayed exactly from its log, and the tests check it.
4. **Views are honest and private.** A seat's view shows only what that player may know. The board's view is public.
   Phones never get another seat's secrets, not even hidden in data.
5. **The rules decide, the UIs only draw.** A UI never decides what is legal; it shows what the view says and sends
   intents. The rules check every intent again.
6. **People first at a real table.** The board is read from every side and from a distance; phones are small. Short
   texts, large touch targets, nothing important only by colour.

## 3. A game's folder

A game is one folder; the folder name is the game's id (`a-z`, `0-9`, `-`).

| File | Required | What it is |
| --- | --- | --- |
| `manifest.json` | yes | The game's facts and options, checked against the schema in `packages/protocol/src/index.ts` (`manifestSchema`). |
| `rules.ts` | yes | `export default defineGame({ … })`: the rules. Runs on the Table Host only; never sent to browsers. |
| `board.js` | no | The board UI module. Without it the board shows the public view as JSON. |
| `deck.js` | no | The phone UI module. Without it the phone shows the seat's view as JSON. |
| `board.css`, `deck.css` | no | Styles; load them from the module with `useStyles("/games/<id>/board.css")`. |
| `how-to-play.md` | yes, in practice | Rules for players, opened from **Rules** on every phone (section 11). |
| `assets/` | no | Images, SVG, sounds, extra CSS or JS the UIs load, at `/games/<id>/assets/…`. `ctx.assetUrl(path)` takes the path inside `assets/`: `assetUrl("img/hex.svg")` is `/games/<id>/assets/img/hex.svg` (not `assetUrl("assets/img/hex.svg")`). |

The host serves exactly `board.js`, `deck.js`, their CSS, `how-to-play.md` and `assets/` to browsers, never `rules.ts` or the manifest. Built-in games import
the SDK by path (`../../packages/sdk/src/index.ts`); games in other repositories import it by name
(`@game-table/sdk`, `@game-table/sdk/cards`), which the host maps to its own SDK.

## 4. The manifest

```json
{
  "id": "coin-flip",
  "name": "Coin Flip",
  "version": "2026.10.23.1",
  "sdk": "^0.1",
  "description": "Everyone guesses heads or tails, then the coin flips. Most correct guesses wins.",
  "players": { "min": 1, "max": 8 },
  "turnModel": "simultaneous",
  "seatLayouts": [2, 4, 6, 8],
  "edges": ["north", "south", "east", "west"],
  "dynamicPlayers": true,
  "settings": [
    { "key": "rounds", "type": "int", "min": 1, "max": 20, "default": 3, "label": "Rounds" },
    { "key": "roundSeconds", "type": "int", "min": 0, "max": 120, "step": 5, "default": 15, "label": "Seconds to guess (0 = no limit)" }
  ],
  "ai": { "supported": true, "options": [] },
  "simulation": { "supported": true, "headless": true },
  "viewer": { "columns": [{ "key": "round", "label": "Round" }, { "key": "guess", "label": "Guess" }, { "key": "coin", "label": "Coin" }, { "key": "score", "label": "Score" }] }
}
```

(Coin Flip's manifest, shortened: fields at their defaults are left out.)

| Field | Meaning |
| --- | --- |
| `id`, `name`, `description` | Id (= folder name), the name shown everywhere, one sentence for the game menu. `{key}` in the description names a setting and shows its value: the default on the game's tile, and the value being chosen in the window that chooses the game ("be the first to {target} points", D-238). |
| `version` | Calendar version `YYYY.MM.DD.N` (section 13). |
| `sdk` | The SDK version range the game is written for (`"^0.1"` today). |
| `players` | `{ "min", "max" }` or a list of allowed counts, 1–8. |
| `turnModel` | `"sequential"` or `"simultaneous"`. The rules decide who may act; the platform uses it to schedule AI players (in a simultaneous game an AI waiting out its pause keeps its place when someone else moves). |
| `seatLayouts` | Table layouts (2, 4, 6, 8 seats) the game can be played in. |
| `edges` | Edges seats may be on; must include `north` and `south`. |
| `localSeat` | Optional edge for a single person at the table when everyone else is remote or AI (they are moved there at the start). For games whose board has a front, like chess. |
| `dynamicPlayers` | `true`: people who join during a game get a free seat and `onSeatJoined` is called. Default `false`: newcomers wait for the next game. |
| `settings` | Game options set on the board before the start: `{ key, type: "int" \| "number" \| "string" \| "bool" \| "enum", min?, max?, step?, values?, default?, label?, when?, random?, hints?, labels? }`. `when: { other: value \| [values] }` makes a setting apply only with those values of others (hidden otherwise, kept at its default); `random: true` gives an int a fresh value from max(min, 1) to max whenever it comes to apply (a board's seed). `hints: { value: text }` says what each value means; the text for the one chosen shows under the setting (a board's description). In the description, `{key.hint}` adds that text as a paragraph when choosing the game (`\n\n{board.hint}`). `labels: { value: text }` says how each value reads ("Beginner" for `beginner`); the rules still get the value. Whole numbers take digits only; one with a wide range (more than 1000 values) is typed on the board's number pad, in the window that chooses the game and in the settings window, by touch or a keyboard, with at most the digits of `max`. The rules get them in `setup`. |
| `ai` | `{ supported, options, timeoutSeconds = 20 (1–600), worker = false, hostConfig = [], notice? }`. `options` uses the settings format (e.g. a play style), plus `random: true` on an enum to give each new AI player a random value (D-226); each AI player has its own values, shown beside its name in the board's settings. `notice` (up to 600 characters, plain text, `https://` links become links) shows under the AI player's options on the board: credit and licence for an engine the AI uses (D-224). Section 7. |
| `simulation` | `{ supported, headless }`: AI-only games for testing, without a board. |
| `boardIntents` | Intent names players may also send by touching the board (section 9). |
| `skipTimers` | Timer ids the board may fire early, e.g. a pause after a hand (section 9). |
| `lobbyButton` | Corner of the board's *Lobby* button during the game: `top-left`, `top-right`, `bottom-left`, `bottom-right` (default). |
| `facing` | `north-south` (default): a running game faces north or south, the turn button flips it. `any`: for games played from all four edges; the lobby's corner arrows stay during the game and face it toward any edge, there is no turn button, and the *Lobby* button sits beside its corner (D-227). |
| `viewer` | `{ columns: [{ key, label }] }`: up to four extra columns in the Game Viewer, filled by `describe` (section 12). |
| `remoteBoardControl`, `saveGame`, `deck`, `permissions`, `seatConstraints`, `test` | Rarely needed; see the schema. `test: true` hides a game unless the table shows test games. |

## 5. The rules (`rules.ts`)

```ts
import { count, defineGame, list, mostAward } from "@game-table/sdk";

interface State { /* plain JSON: numbers, strings, booleans, arrays, objects, null */ }

export default defineGame<State>({
  setup(ctx, settings) { … return state; },
  onIntent(state, seat, intent, ctx) { … return { state: next, events } /* or */ return { reject: "not your turn" }; },
  view(state, seat) { … },            // what this seat may see
  boardView(state) { … },             // what everyone may see
  isOver(state) { … },                // null while playing; a summary at the end
  onTimer(state, id, ctx) { … },      // optional
  onSeatChanged(state, seat, ctx) { … }, // optional: another player plays this seat now
  onSeatJoined(state, seat, ctx) { … },  // optional: only with "dynamicPlayers": true
  canContinueWithout(state, seat) { … }, // optional: can the game go on while this player's phone is away?
  ai(view, seat, ctx, options) { … },     // optional: an AI player's move
  aiFallback(view, seat, ctx, options) { … }, // optional: a quick move when an AI is out of time
  describe(step) { … },               // optional: one step in words, after the game
});
```

### The state

- Plain JSON only. The host hashes `JSON.stringify(state)` to check replays, and copies it for views and logs. No
  classes, `Map`, `Set`, `Date`, functions or `undefined` values that matter.
- Treat the state you are given as read-only. Build and return a new one (copy what you change). Never mutate the
  input: a rejected intent must leave the game exactly as it was.
- Keep it reasonably small: it is copied often. Keep only what the rules need.

### The context (`ctx`)

| Member | Meaning |
| --- | --- |
| `ctx.random()` | A number in `[0, 1)` from the game's logged seed. **The only source of randomness.** |
| `ctx.randomInt(min, max)` | An integer in `[min, max]`, from the same stream. |
| `ctx.setTimer(id, ms)` | Call `onTimer(state, id)` after `ms`. Setting an id again replaces it. Timers stop while the game is paused. |
| `ctx.clearTimer(id)` | Cancel a timer. |
| `ctx.now()` | Game time in ms since the start, pauses left out, logged with every input (for chess clocks and the like). **The only clock.** |
| `ctx.seats` | `SeatInfo[]`: `{ seat, playerId, name, kind: "human" \| "ai", edge }` for the seats at the start (and as they change). |

Never use `Math.random()`, `Date.now()`, `new Date()`, `performance.now()`, the network, files or global mutable state
in rules. Views (`view`, `boardView`) must not draw random numbers or set timers. Do not set timers in a step you then
reject.

### The hooks

**`setup(ctx, settings)`** → the first state. `settings` has every manifest setting with its default filled in. Seats
are in `ctx.seats`; the seat numbers are the table's (they may have gaps, e.g. seats 0, 2, 4 at a six-seat table).

**`onIntent(state, seat, intent, ctx)`** → `{ state, events? }` or `{ reject: reason }`. An intent is
`{ name, payload }`, sent by a phone (`ctx.send` in `deck.js`), by the board for a player (`ctx.act`, only names in
`boardIntents`) or by an AI player. Check everything: whose turn, the payload's shape and range, the phase. The reject
reason is shown to the player, so write it for people ("Wait for your turn", not "E_TURN"). Phones may send an intent
for a view they saw a moment ago: include a version in the payload if order matters, and reject stale ones politely.

**Events** are `{ name, data? }` describing what just happened, for the UIs to animate (a card played, a die rolled, a
token moved). They go to the board and to every phone with the new views, and into the log. They are not state:
everything a UI needs to draw the current position must be in the views.

**`view(state, seat)`** → what one seat may see: their own cards, their legal moves, whose turn it is, the public
position. Put `myTurn: true` in it while the game waits for this player: the phone then brings the game forward
(section 10). Never include other seats' private data.

**`boardView(state)`** → what everyone may see. Shown on the table's board and on remote boards.

**`isOver(state)`** → `null` while the game runs, else the summary (section 8). Called after every step.

**`onTimer(state, id, ctx)`** → like `onIntent`, for a timer the game set. Turn timers, a pause on a hand's result,
an automatic move when a player runs out of time.

**`onSeatChanged(state, seatInfo, ctx)`** → `{ state, events? }`; `seatInfo` is `{ seat, playerId, name, kind, edge }`, the
new player. Another player plays this seat from now on (section 6). Update what the state
keeps about the seat's player (the name; whether it is a person, if the rules care). The seat's cards, score and
position stay. Logged and replayed like an intent.

**`onSeatJoined(state, seatInfo, ctx)`** → `{ state, events? }`, with `seatInfo` as above; only with `"dynamicPlayers": true`: someone took a free seat during the game.
Add them to the state.

**`canContinueWithout(state, seat)`** → `true` (the default) or `{ wait: "text for the board" }`. Asked often
(whenever the table's state is sent, and when a phone goes away), so keep it cheap; the text is cut to 300
characters, and an error counts as `true`. With `{ wait }` the game pauses until the phone is back or the board exchanges the player;
the board shows the text (e.g. "Partners can't go on without a full team."). A question about the state: it must not
change anything.

**`onSeatLeft(state, seat, ctx)`** → kept for old logs only. A running game never loses a player (section 6), so the
platform does not call it during games. Do not build game logic on it.

**`ai`, `aiFallback`** → section 7. **`describe`** → section 12.

### The SDK

`@game-table/sdk` (`packages/sdk/src/index.ts`): `defineGame`, the types above, `createRng(seed)` (the same generator
for tests and AI search), `count(n, "die", "dice")` → "one die", "three dice", `list(["Ann", "Bob", "Cleo"])` →
"Ann, Bob and Cleo", `isReject(result)`, `mostAward`, `leastAward` (section 8).
`@game-table/sdk/cards` (`packages/sdk/src/cards.ts`): a 52-card deck, a seeded `shuffle(items, ctx.random)`, poker
hand evaluation (`bestHand`, `compareScores`, `HAND_NAMES`).

## 6. Players and seats

The platform owns everything about players. A game must not reimplement any of this; it only answers the hooks.

| What happens | What the platform does | What the game gets |
| --- | --- | --- |
| Players join, take seats, pick colours, change names, move seats | In the lobby, before the game. Seats are fixed when the game starts. | `ctx.seats` in `setup`. |
| Someone joins during a game | Seated only if the manifest says `"dynamicPlayers": true` and a seat is free; else they wait for the next game. | `onSeatJoined`. |
| A player's phone goes away (locked, out of range, closed) | Their seat **waits, with no time limit**; the game goes on and simply waits when it is their move. After 15 s the board shows "… is away" at their seat with **Exchange …**. The phone rejoins by itself when it is back. With the table rule *A player away this long is replaced by an AI player* (3 or 5 minutes; off by default, D-236), an AI player takes the seat once that time is up, as an exchange would. | Nothing (the state does not change). If the game answers `{ wait }` in `canContinueWithout`, the game pauses meanwhile. |
| A player taps **Leave the game** on their phone | Their phone is done with this game. The seat is handled like an away player's at once: "… left the game" with **Exchange …**. Scanning the join code again with the same name brings a player at the table back to their seat; a remote player's browser keeps watching. | Nothing until the seat is exchanged. |
| The board exchanges a player (Settings › Players › tap the name, **Exchange …** on the away card, the in-game Lobby) | For anyone, away or connected: a person at the table (a QR code for this seat), a remote player (an invite; only with a remote place free), a watcher or an AI player (in games with AI players; for a seat an AI already plays, its options change instead) takes the seat, with its colour. Whoever had it goes; their phone is told, and a remote player's browser keeps watching. One exchange is open at a time; a new one replaces it, and it ends with the game. | `onSeatChanged(state, { seat, playerId, name, kind })`. |
| Every seat is taken | Nobody else joins: phones with the join code, + AI player and player invites are refused with the reason. During a game the way in is an exchange; someone remote can still come as a watcher. | — |
| Someone remote watches | They see the board only, take no seat and have no phone page; remote players and watchers together use at most the table's remote places (4 by default). | Nothing. |
| An AI player's options change during the game (Settings › Players, its options beside its name, or the exchange window) | From its next move. | Nothing (options reach `ai()` as its `options`). |
| Removing a player during a game | **Not possible.** The game always has the same players' seats. | — |
| A timeout that hands a seat to an AI | **Does not exist.** Replacing a player is always a choice made at the table. | — |
| The table loses its service connection, or an AI runs over its time | The game pauses (timers stop, nobody moves) and resumes by itself or from the board. | Nothing. |

What this means for a game:

- Keep player names in the state only if the game shows them from the state (end-of-game texts, "it is Ann's turn").
  Then implement `onSeatChanged` and update them, or the old name stays until the game ends.
- If the rules treat people and AI players differently (an acknowledgement only people must give, a choice the rules
  make for an AI seat), keep that flag per seat and update it in `onSeatChanged`. Release anything still owed by a
  seat that becomes an AI, so the game cannot wait forever for a phone that is gone.
- Whether a person is at the table or remote is not part of the rules' seat information; the UIs know it from
  `info.players` (`location`). Rules should not need it.
- Never pause, end or change a game because a player is away: the platform shows it and the people at the table
  decide. If the game truly cannot go on without someone (a team game whose partners must both act), answer
  `canContinueWithout` with `{ wait }` and the platform pauses for you.

## 7. AI players

`ai(view, seat, ctx, options)` → an intent, `null` (nothing to do now), or a promise of either.

- **It sees only the seat's view**, never the state: the same information a person in that seat has. If the AI needs
  more to plan (what it has seen so far), put it in that seat's view (e.g. an `observer` field only AI seats get), never
  other seats' secrets.
- **It is asked after every change**, for every AI player: answer `null` quickly when it is not this seat's turn. A
  newer change cancels an older question (`ctx.signal` is aborted and the answer is dropped; in a worker the thread
  is stopped instead, and `ctx.signal` never fires there).
- **Randomness:** `ctx.random()` / `ctx.randomInt()` (the AI's own stream, not the game's). The move itself is logged,
  so replay never runs the AI again.
- **Time:** answer synchronously for quick choices. For a search or a language-model call return a promise; the table
  keeps running. `ctx.deadline` (ms since the epoch) is when the table expects the move (`ai.timeoutSeconds`, default
  20). Past it, an AI that answers with a promise (or runs in a worker) pauses the game and the board offers
  **Play now**, which plays `aiFallback()`: a quick synchronous move (without one, the AI is asked again). A
  synchronous `ai()` in the host thread is not timed and holds the table while it runs: keep it quick. `"ai": { "worker": true }` runs `ai()` in a worker thread per AI player,
  with the view and options as plain data, so a long synchronous search never blocks the table.
- **Errors:** if `ai()` throws or its worker fails, the platform plays `aiFallback()` at once (nothing without one); a
  rejected AI intent is asked for once more after a pause.
- **Options** come from `ai.options` in the manifest, per AI player, e.g. `{ "key": "style", "type": "enum", "values":
  ["cautious", "bold"], "default": "cautious", "label": "Play style" }`. With `"random": true` (an enum with
  `values`), each new AI player gets one of the values at random instead of the default, picked by the table when the
  AI player comes to a table with the game chosen (or the game is chosen) and kept until changed (D-226); with the
  table rule *AI players get different play styles* (on by default, D-237) the pick leaves out values other AI players
  at the table have, while any are left. Simulations still use the default unless given. The board's settings window shows every AI player's option values beside its name (label and value on hover);
  a tap changes them, during a game from the AI's next move on.
- **Pace:** the platform pauses about 0.8 s before an AI acts (`AI_DELAY_MS`), lets it move only once the table's
  board has shown everything so far (section 9), and phones get an AI's move once the board has shown it. Do not add
  artificial delays in `ai()`; let the board stage moves.
- **Simulations** (`"simulation": { "supported": true }`): AI-only games without a board, for testing and AI tuning;
  `scripts/soak.ts` runs many of them. They must finish: make sure AI players always find a move or `null` that lets a
  timer move the game on.

## 8. The end of a game

`isOver(state)` returns `null` while the game runs, and at the end:

```ts
{
  text: "Ann and Cleo win with all eight marbles home after 14 rounds.", // one or two sentences
  highlights: { winners: ["Ann", "Cleo"], rounds: 14 },                  // machine-readable facts
  table: { columns: ["Player", "Captures", "Moves"], rows: [["Ann", 3, 41], ["Ben", 1, 39]] }, // optional
  awards: [{ id: "killer", icon: "💀", title: "The Killer", blurb: "Captured the most marbles.", seats: [0], value: "5 captures" }], // optional
}
```

- **`text`** is the result screen's headline and the log's result. Use `count` and `list` for natural texts.
- **`table`** (optional): per-player statistics, shown on the result screen and in the statistics window. Put the
  player's name in the first column, so the platform can mark a seat that changed hands.
- **`awards`** (optional): the statistics window's trophies. `mostAward(base, scores, value?)` and
  `leastAward(base, scores, value?)` build one from `[{ seat, score }]` and return `null` when nobody stands out: one
  player or everyone tied, and for `mostAward` also a best score of 0 or less. The platform drops awards that nobody or every player holds.
  **Offer 12 or more** (D-231): only those where someone stands out are shown, so a game needs many to have a few
  for every player at the end. There is no limit; the window shows them all.
- **The platform adds** each seat's final player (`players`), a moves-and-thinking-time table (`play`) read from the
  log, and two pace awards for people (*Quick Draw* and *Deep Thinker*; a game award with the id `quick-draw` or
  `deep-thinker` replaces the platform's). A seat another player took over during the game shows the last player's name
  with *; a note explains it.

The board keeps the game's final screen until someone taps **Awards and Results**, so the end can be seen. That
opens the awards and statistics (`isOver`'s awards and table), whose *Done* leads to the results in the lobby; a game
without awards or a table shows **Show result** instead, straight to the results (D-216). If the board UI replays
moves (section 9), the button waits for it.

## 9. The board UI (`board.js`)

A plain ES module, loaded by the board page (no build step, no framework required). It draws the public view and
animates events.

```js
import { esc, html, playerColor, seatPlates, remainingMs, playSound, useStyles } from "/shared/board-kit.js";

export function mount(root, ctx) {
  useStyles("/games/my-game/board.css");
  // ctx: { gameId, assetUrl(path), act(seat, name, payload), skipTimer(id) }
  return {
    update(view, events, info) { /* draw boardView; animate events */ },
    destroy() { /* stop timers, remove listeners */ },
    whenIdle() { return Promise.resolve(); }, // optional: resolves once everything sent so far has been shown
    gesture(seat, data) { /* optional: a phone's live gesture, e.g. a card being slung (section 10) */ },
  };
}
export function settings({ info, setPrefs }) { return []; } // optional: items for the board's settings window
```

- **The surface** is 1920 × 1080 logical pixels, scaled to the screen; `root` covers it. Seats sit around the edges
  (`info.seatPositions`), so keep the middle for the game and the edges for seat plates (`seatPlates()` draws them
  with names, colours and whose turn it is).
- **Facing:** a game on the table's board faces `north` or `south` (the turn button switches), or any of the four
  edges with `"facing": "any"` (the corner arrows, D-227); remote boards turn to
  their player. Draw for `info.frontEdge` / `info.rotation` (degrees: south 0, west 90, north 180, east −90). Text
  should face the reader it is for.
- **Platform buttons:** the gear, the turn button, the *Advanced* button and (while anyone watches) the watchers'
  eye sit along the bottom edge from the bottom-left corner, up to about 300 px (from the bottom-right when
  `lobbyButton` is bottom-left); the *Lobby* button is in the manifest's `lobbyButton` corner. With `"facing": "any"`
  the four corner arrows (58 px, 32 px from each corner) stay too, and the *Lobby* button sits beside its corner,
  about 100–220 px along the edge. Keep those clear.
- **`update(view, events, info)`** is called with every change (and when `info` changes, with `events` empty). Make
  it cheap and idempotent: redraw from `view`, animate only `events` you have not shown yet.
- **`whenIdle()`** (strongly recommended if you animate): resolve when every event sent so far has been shown. The
  platform waits for it before an AI player moves, before phones see an AI's move, and before **Awards and Results**; the
  table's own board paces the game (remote boards don't), and after 20 s without an answer the platform goes on. Without
  it the platform assumes the board shows everything at once. Never let it wait forever (resolve when nothing is
  queued).
- **Moves on the board:** list intent names in `boardIntents`; `ctx.act(seat, name, payload)` sends one for a seat in
  `info.controlSeats` (people at the table on the table's board; a remote board only for its own player) and resolves
  with `{ ok, reason }`; a rejection is shown as a toast by the platform. The rules decide as for any intent.
- **Skipping a wait:** list timer ids in `skipTimers`; `ctx.skipTimer(id)` fires it now when `info.boardControl` is
  true (not while the game is paused) and resolves with `{ ok, reason }`. Use it for a pause on a result ("Next hand").
- **Settings:** `settings({ info, setPrefs })` returns items `{ type: "toggle" | "choice" | "swatches" | "button" |
  "text", label, value, options, onChange }`: a `choice` takes `options: [{ value, label, hint? }]` (a pulldown above three; the chosen option's `hint` shows under it),
  `swatches` takes `options: ["#rrggbb", …]`, a `button` shows `action` (or `label`) and calls `onChange()`, a
  `text` only shows its `value` (e.g. a board's seed), and a `number` shows its `value` and opens the board's number pad
  (digits, Clear, Enter; `min`, `max`), calling `onChange(n)`. Any other item may carry a `hint`, shown under its label. During a game the manifest's locked settings show no `hints`: the game's items say what a value means now. `setPrefs(patch)` stores display choices for this game (`info.prefs`), never
  rules.
- **Sound:** `playSound(info, name, make)` from the board kit plays only when the table's sound is on (`info.sound`).
  A browser other than the table's kiosk plays it only after the board has been touched; the platform wakes it on the
  first tap and shows *Tap to turn the sound on* until then (D-195), so a game does nothing about it.
- **Performance:** the board may be a modest PC driving a large screen. Avoid endless CSS animations on large layers
  and rebuilding big SVG or DOM trees per frame; split static and moving layers, update only what changed, and move
  pieces with transforms or the Web Animations API (one animation along the whole path, not a step per frame).

### Badges on seat plates

A **badge** is a small tab on a player's seat plate that names something lasting about that player: *Winner* at the
end, and later perhaps *Dealer*, *Leader* or *Last round*. It is a convention, not platform code yet (D-235): a game
that wants one draws it on its own seat plates, following these rules, so every game's badges look and behave alike.
The platform will take it over (an option of `seatPlates()`) once a second game needs one.

- **Where:** on the plate's top edge (the edge toward the middle of the board), near its right end: 22 px from the
  right, sticking out 18 px above the plate. It belongs to the plate, so it turns with it and faces the player.
- **How it looks:** one word, with a small inline SVG icon before it if it helps (a trophy for *Winner*); 13 px bold
  system font, dark ink (`#1b1407`) on a filled tab; top corners rounded 10 px, bottom 4 px; a small shadow. Gold
  (`#ffd23f`) is for *Winner* only; other badges use the brass of the board's titles or the player's own colour.
- **At most one** per plate. If two apply, show the one that matters more now.
- **From the view, not from events:** draw it from the board view (for example the winner's seat in the final view),
  so a reloaded board, a remote board and the game's last screen show it too.
- **Keep clear of it:** anything the game draws near a seat plate (boxes, scores, logs) stays at least 6 px from where
  a badge would be, in every facing, also on plates that don't carry one yet. Test it by putting a badge on every plate
  and checking for overlaps in each facing.
- **Not on the lobby's plates:** badges are part of a game, and the lobby's seat plates are the platform's.

```css
/* A badge: inside the plate (position: absolute), so it turns with it. */
.my-badge { position: absolute; top: -18px; right: 22px; display: flex; align-items: center; gap: 5px;
  padding: 3px 10px 2px; border-radius: 10px 10px 4px 4px; background: #ffd23f; color: #1b1407;
  font: 700 13px system-ui, sans-serif; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5); }
.my-badge svg { width: 15px; height: 15px; }
```

With `seatPlates(layer, info, extra)`, return the badge from `extra(seat)`: `.kit-plate` is positioned, so the badge
places itself on the plate.

### `info` on the board

| Field | Meaning |
| --- | --- |
| `players` | Everyone at the table: `{ id, name, kind: "human" \| "ai", location: "local" \| "remote", seat, connected, ready, color, aiOptions? }`. |
| `seatColors` | Always empty since a running game keeps all its players; kept so older UI code still works. Use `playerColor(info, seat)` for a seat's colour. |
| `seatEdges`, `seatPositions` | Each seat's edge; each seat's position on the surface. |
| `frontEdge`, `rotation` | Which way the game faces on this board. |
| `controlSeats`, `boardControl` | Seats this board may act for; whether it may use table controls. |
| `settings`, `prefs` | The game's settings for this game; display choices. |
| `timers`, `now`, `receivedAt` | Timer deadlines in host time, the host's clock and when the message arrived: `remainingMs(info, id)` gives a countdown. |
| `over` | The game has ended. |
| `aiThinking` | AI players thinking for more than a moment: `{ playerId, seat, since, deadline }`. |
| `sound` | Sound effects on. |

## 10. The phone UI (`deck.js`)

```js
export function mount(root, ctx) {
  // ctx: { gameId, seat, send(name, payload) → Promise<{ ok, reason? }>, gesture(data), toast(text), vibrate(ms), assetUrl(path) }
  return { update(view, events, info) { … }, destroy() { … } };
}
```

- **The phone during a game** has a slim tab bar at the top (the player's own tab and the game's tab, about 60 px);
  the game's module gets the rest of the screen. Design for 360 px wide and for short screens (an iPhone with its
  toolbars shows about 400 × 680). Large touch targets.
- **`ctx.send(name, payload)`** submits an intent and resolves with `{ ok, reason }`; a rejection is shown to the
  player as a toast by the platform. `ctx.toast(text)` floats a message over the top of the screen for 3 s;
  `ctx.vibrate(ms = 40)` buzzes (the phone also vibrates by itself when `myTurn` comes).
- **`update(view, events, info)`** is called with every change, and again when `info` or the lobby changes, then
  with `events` empty (as on the board): each message's events come once.
- **`myTurn: true`** in the seat's view brings the game's tab forward when it becomes true.
- **Staging:** phones get an AI player's move once the board has shown it; then `info.shownOnBoard` is true. Apply such
  updates at once rather than animating the move again.
- **Facing:** `info.viewEdge` (the edge this player looks from) and `info.boardEdge` (the edge the board's game faces)
  let a phone turn a map the way the player sees the table.

### Slinging things from the phone to the board

A player can push a card (a die, a token…) up and off the top of their phone and see it come onto the board at their
seat (D-189). The platform does the gesture and the animation; the game draws the thing, says where it lands and what
the move means. The test game `games/card-sling` is the smallest example; Last Card in extra-games a full one.

- **Live gestures:** `ctx.gesture(data)` on the phone sends a small JSON object (at most 512 characters as JSON) to every board,
  local and remote, where the game's `gesture(seat, data)` hook gets it. No rules run, nothing is logged or replayed,
  nothing reaches other phones; only the sling's own fields reach the boards (`id`, `f`, `x`, `a`, `end`, and `item` as a flat object of
  short strings, numbers and booleans; D-202), so draw an `item` only through code that accepts known values; the
  host drops gestures while no game is active (also while paused), from players without a seat, and more
  than one per 8 ms from a phone. The move itself is still an intent.
- **On the phone,** `slingDeck(area, ctx, opts)` from `/shared/sling.js` makes every element with `data-sling="<id>"`
  in `area` draggable. `area` clips its content; its top edge is where things leave the phone. Letting go with half
  of it out (`threshold`), or a flick (`flick`, an upward speed, 0.8 px/ms by default), calls `onSling(id, { direction })`, where the game sends its intent and returns
  whether it was accepted; `direction` (`"left"`, `"middle"`, `"right"`) says where the flick went. `canSling(id)`
  returning false or a reason lets the thing peek out and bounce back (a reason shows as a toast). `line()` (a page height, e.g. the bottom of
  a status box) lets players play a thing by letting go above it, toward the middle, without pushing it all the way
  off; above the line, the thing and `area` have the class `sling-armed`. The thing leans with sideways movement
  (`tilt`), and the board shows the same angle. `reveal: "move"` (default) shows the board only the back while
  dragging; `"drag"` sends `item(id)`, so the board shows the face at once. `receive(el, { delay? })` lets a drawn
  thing come in at the top, after the board has thrown it (timed by `speed()`); `busy()` is true while something is
  dragged or on its way out (re-render after); call `sling.destroy()` in your own `destroy()`.
- **On the board,** `slingBoard(root, { render, size, speed, spread })` draws what comes in at each seat's edge of the board,
  above the seat plates, and the flights. Pass gestures on with `sling.gesture(seat, data)` and keep `sling.info(info)`
  current in `update`. When the move's event arrives, `sling.fly(seat, { id, item, to })` flies the thing face up from
  where the drag left it (or from the seat, for AI players) to `to = { x, y, angle, scale? }`, and resolves when it lands;
  `sling.toSeat(seat, { item?, from })` throws one to a seat (a drawn card; no item: its back), where it slips off the
  edge. `render(item, { back })` returns the thing's markup at `size` (default 120 × 180, a card); `spread` (160 px)
  is how far the phone's sideways position moves it along the edge; `sling.edgeAt(seat)` gives `{ x, y, rot }`; `speed()` slows everything down (1 = normal, offer it as a
  board setting); `sling.flight(markup, from, to)` flies anything between two poses; `sling.destroy()` in `destroy()`.

### `info` on the phone

| Field | Meaning |
| --- | --- |
| `seat`, `me` | This player's seat and their entry from `players`. |
| `players`, `seatColors`, `seatEdges` | As on the board. |
| `viewEdge`, `boardEdge` | How this player sees the board. |
| `settings`, `prefs`, `timers`, `now`, `receivedAt`, `over`, `aiThinking` | As on the board. |
| `shownOnBoard` | This update's moves have been shown on the board already. |

## 11. Rules for players (`how-to-play.md`)

Every phone has a **Rules** button while the game is chosen or running; it shows this file in a sheet, with the
table's settings (by their manifest labels) on top.

- Start with a one-sentence goal, then `## In short` with two to five bullets (the tests require it), then details.
- Name every setting by its manifest `label`.
- A small, safe Markdown subset (`/shared/markdown.js`): `#`, `##`, `###`, paragraphs, `-` and `1.` lists (one
  level), `**bold**`, `*italic*`, `` `code` ``, `> tip`, `---`, simple tables, `https` links, and images from
  `assets/` (`![alt](assets/board.svg)`: SVG, PNG, JPEG, WebP, GIF). Everything else shows as plain text.
- Write for a 360 px phone: short sentences, short tables, illustrations 360–720 px wide.

## 12. Logs, replay and the Game Viewer

- The host logs the seed and every input (intents, accepted or refused, timer firings, seats joining or changing
  hands) with its game time. `replay()` rebuilds the game from that, and the host checks every finished game this way.
  A game that does not replay exactly has a bug: usually randomness or time outside `ctx`, or a mutated input state.
- Each log is a zip with `game-001.jsonl` (records), `game-001.moves.jsonl` (readable rows) `run.json`, the final state and a `README.md`
  (`apps/table-host/src/log-format.md`). `node scripts/game-log.ts <zip>` reads one from the command line (`info`,
  `moves 40-45`, `move 43` with the state before and after); `--games DIR` adds game folders from other repositories.
- **`describe(step)`** (optional) says what a step meant, for the Game Viewer on the board, the move list and readers
  of logs. `step` has `kind` (`intent`, `timer`, `seatJoined`, `seatLeft`, `seatChanged`), `seat`, `intent` and `by`
  (`human`, `ai`, `board`), `timer`, `accepted`, `reason`, `events`, `names` (seat → name) and the state `before` and
  `after`. Return `{ text, columns?, details?, steps? }` or `null` for the generic line: `text` without the player's
  name ("plays a Seven: 4 steps for marble 3"); `columns` for the manifest's `viewer.columns`; `steps` for things that
  happened within the step for other seats (`{ seat?, text, auto? }`). Pure, and only used after the game.

## 13. Versions

A game's `version` is `YYYY.MM.DD.N` (America/Chicago date; `N` counts that day's versions from 1). It changes when,
and only when, something in the game's folder changes (rules, UI, styles, assets, rules for players, the manifest), in
the same pull request. Platform changes never change it. `node scripts/check-game-versions.ts --base origin/main
--fix` sets it for you (in a game repository of your own: `node .games-service/scripts/check-game-versions.ts --base
origin/main --fix`); the pull request checks enforce it.

## 14. Testing

Tests use Vitest and run against the real host code.

- **Rules:** `tests/harness.ts` in this repository loads a game folder and runs it on the real runtime with virtual
  time: `const { rt, clock } = start(await loadGame("my-game"), 3, settings, seed)` (three seats: Ann, Ben, Cleo); drive it with `rt.submit(seat, intent, "human")`,
  `clock.advance()` (fires due timers) and `rt.seatChanged(seatInfo)`, read `rt.view(seat)`, `rt.boardView()`,
  `rt.state` and `rt.over`, and check `expect(expectReplay(game, rt)).toBe(true)` once the game has ended.
- **Host:** `tests/helpers.ts` starts a real Table Host (`testHost()`) with fake phones (`joinDeck(name)`,
  `deck.request("game", "intent", …)`, `deck.waitView(…)`) and the board API (`t.ok("POST", "/game/start")`).
- **A table on your computer:** `scripts/local-table.sh` (macOS or Linux, Node 26, no containers) starts a Table
  Host from this repository and opens the board; phones on the same WiFi join with the QR code (D-188). It first
  brings the checkout up to the latest `main`; `--branch NAME` runs another branch (`production`, a feature branch),
  `--no-pull` runs the checkout as it is. `--extra ../my-games` adds the games of another checkout, so you can play a
  game from your own repository before it is released; start it with `CLOUD_URL=` to leave the live service out (it
  would otherwise also install its own extra games). `--all-games` adds every checkout with games beside this one
  (updated like it unless `--no-pull`), and `--offline` leaves the service and its console out: `--offline --all-games`
  plays every game you have checked out at a table of its own (D-247). `--code ABCD-EFGH` connects the table to a game service with an
  access code. The table keeps its identity and key in `~/.gametable-local`. To see the board on an iPad or a TV
  while the table runs on your computer, use the board's settings › *Board on another screen…* (a QR code and link
  for any screen on the same network, D-190). A table in Docker instead:
  [`docs/runbooks/local-docker.md`](../runbooks/local-docker.md).

  ```
  scripts/local-table.sh                                   # latest main, against the live service
  scripts/local-table.sh --branch my-feature               # a branch
  CLOUD_URL= scripts/local-table.sh --extra ../my-games    # your own games, no service
  scripts/local-table.sh --offline --all-games             # every checked-out game beside this one, no service
  ```

- **By hand, without a phone:** *Developer settings › Play from the board* on the board (the tools button) (or `BOARD_DECK=1`) puts one
  player's deck beside the board, as on a remote player's page, so you can play your game at one screen with AI players
  (D-175). Only one person plays at the table meanwhile, since the deck is private; remote players can still join.
- **Browser:** `scripts/e2e/` drives a board and phones in Chromium with Playwright; `common.py` has the helpers.
- What every game should test: a whole game to the end with AI players or scripted moves, that it replays exactly,
  that a seat's view never contains another seat's secrets, that illegal intents are rejected with a reason, an
  exchange mid-game (`onSeatChanged`) if the game keeps names, and `how-to-play.md` (the `rules.test.ts` checks run on
  every game folder in this repository).

## 15. A game repository of your own

Games can live in their own GitHub repository (private or public). The service fetches its `games/` folder as one
bundle, and an administrator ticks the repository for the tables that should get its games. [`klaushofrichter/extra-games`](https://github.com/klaushofrichter/extra-games) is a working
example of everything below: copy its `scripts/games-service.sh`, `games-service.ref`, `tsconfig.json`,
`vitest.config.ts`, tests and CI workflow.

```
my-games/
  games/<id>/…              one folder per game, exactly as in section 3
  games-service.ref         the games-service branch, tag or commit the games are tested against (e.g. "main")
  scripts/games-service.sh  clones games-service at that ref into .games-service/ (git-ignored) and installs it
  tsconfig.json, vitest.config.ts   map "@game-table/sdk" to .games-service/packages/sdk/src/index.ts
  tests/                    helpers from .games-service/tests/helpers.ts, and a small harness.ts of your own that
                            loads your games/ on .games-service's runtime (copy extra-games' tests/harness.ts)
```

- Rules import `@game-table/sdk` by name. The host maps it to its own SDK, so the same code runs on every table.
- A game id must not be a built-in game's or another repository's.
- Test against games-service `main` regularly (a weekly scheduled check is a good idea): platform changes show up
  there first.
- An optional hook a game uses must be one the tables have. New hooks are optional, so an older host simply does not
  call them; do not import SDK names that older hosts do not export.
- Add the repository to the service: an administrator adds `owner/name` and a branch in the console (or in
  `deploy/game-repos.json` by pull request), and gives the service read access to a private repository.

## 16. Checklist before a pull request

- [ ] `manifest.json` validates; `version` bumped for any change in the folder.
- [ ] Rules use only `ctx.random()`, `ctx.randomInt()` and `ctx.now()` for chance and time; no input state is mutated.
- [ ] Every intent is checked (turn, phase, payload) and rejections have a sentence for people.
- [ ] `view(state, seat)` holds no other seat's secrets; `boardView` holds nothing private.
- [ ] `isOver` returns a summary with a readable `text`; `table` has the player's name first; 12 or more awards.
- [ ] Names kept in the state are updated in `onSeatChanged`; nothing about leaving, replacing or timeouts is
      implemented by the game.
- [ ] AI players answer `null` quickly when it is not their turn and only read their view.
- [ ] The board UI animates events, keeps the corners clear, and implements `whenIdle()` if it replays moves.
- [ ] The phone UI fits 360 px wide and about 400 × 680, sends intents with `ctx.send`, and uses `myTurn`.
- [ ] `how-to-play.md` starts with the goal and `## In short`, and names settings by their labels.
- [ ] Tests: a whole game, exact replay, private views, rejections, an exchange mid-game.
