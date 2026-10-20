# Game Table log

This zip is the complete record of one game, or of one AI-only simulation run, on a Game Table
(https://github.com/klaushofrichter/games-service). It is written to be read without the platform: to find out what
happened in a game, why a rule misbehaved, or why an AI made a move.

## Files

| File | What it is |
| --- | --- |
| `README.md` | This description. |
| `run.json` | Metadata: which game and version, which table, when, who played, settings, how it ended, counts, verification. |
| `game-001.jsonl` | Every record of game 1, one JSON object per line, in order. A simulation has `game-002.jsonl` and so on. |
| `game-001.state.json` | The game's complete state when the log ended (the rules' own state object). Absent if it could not be rebuilt. |
| `game-001.moves.jsonl` | The move list: every record of game 1 as a readable row, player moves numbered (see *Moves* below). Absent in simulations and older logs. |

## run.json

- `format`: `gametable-log/2`. `kind`: `game` (people at the table) or `simulation` (AI players only).
- `id`, `tableName`, `tableId` (null without the service), `platform` (`version` of the table software, `protocol`).
- `gameId`, `gameName`, `gameVersion`, and `gameSource` for a game from another repository (repository, commit, bundle).
- `startedAt`, `endedAt` (ISO 8601, UTC), `durationMs`, `timeZone` of the table (for local times of day).
- `settings`: the game's settings, as the rules received them. `seed`: the simulation's seed (each game's own seed is
  in its `start` record).
- `developer`: present only when a developer setting was on when the game started, e.g. `allowNoLocalPlayer` (the game
  could start without a player at the table: remote and AI players only, or AI players only).
- `players`: `seat`, `name`, `kind` (`human` or `ai`), `location` (`local` at the table, `remote` over the internet,
  null for AI players) and `aiOptions` (AI players' play style and similar).
- `endReason` (one game) or `endReasons` (a simulation: how many games ended each way): `finished` (the game ended by
  its rules), `terminated` (ended from the lobby, saved and exited, or stopped by the simulation), `seatLeft` (a player
  left and the game could not go on), `interrupted` (the table stopped during the game; the log was closed at its next
  start). `result`: the end-of-game text.
- `counts`: `intents` (moves sent, accepted or not), `rejected` (moves the rules refused), `timers` (timer firings),
  `errors` (exceptions thrown by the game's code).
- `verify`: the log was replayed after the game: `checked` games, `ok` games that replayed to the same final state,
  `failed` (game numbers that did not), or `skipped` with the reason. A failure means the rules are not deterministic
  (randomness or the clock used outside `ctx.random()`), or the log is incomplete.

## Records (`game-NNN.jsonl`)

Every record has `t` (its type) and `at` (milliseconds: epoch time in a played game, virtual time from 0 in a
simulation). Inputs (`intent`, `timer`, `seatJoined`, `seatChanged`, `seatLeft`) also have `gt`: the game time the rules saw, ms
since the start with paused time left out (games use it for clocks; replay uses it). Seats are numbers from 0; the `start` record maps them to players, and `run.json` lists the players.

- `start`: `gameId`, `version`, `seed` (all randomness in the rules comes from it), `settings`, `seats` (`seat`,
  `playerId`, `name`, `kind`, `edge` of the board), `aiOptions` per seat, `simulation`.
- `intent`: a move. `seat`, `by` (`human` from a phone, `board` by touching the board, `ai`), `intent` (`name`,
  `payload`), `accepted`. A refused move has `reason`. An accepted one has `events` (what the game announced, e.g. a
  die roll, for animations and sounds). AI moves may carry `ai`: `ms` thinking time, `fallback` (the game's quick move
  was played because the AI ran out of time or failed), `worker`, `error`. A move the rules threw on has `error`
  (`message`, `stack`) and `accepted: false`; the game went on without it.
- `timer`: a timer the game set fired (`id`), with `events`, or `error`.
- `seatJoined`: a player took a seat during the game (`seat` as in `start`). `seatLeft`: a player left (`seat`);
  `ended` says whether the game ended because of it. Only in older logs: since D-159 a running game keeps its players.
- `seatChanged`: another player took over a seat (D-159, the board's exchange): `seat` as in `start` with the new
  player's `playerId`, `name` and `kind`, `aiOptions` when the new player is an AI, and the game's `events` (its
  `onSeatChanged`) or `error`. The seat's cards and score stay.
- `aiOptions`: an AI player's options changed during the game (`seat`, `aiOptions`), from its next move. Not an input.
- `error`: an exception in the game's code outside a move, e.g. while drawing a player's view (`where`: `view`,
  `boardView`, `isOver`, `canContinueWithout`; `seat` if it was one player's view). Only the first 20 are recorded; `counts.errors` has all.
- `disconnected`: a player's phone went away (`seat`); `waiting` is the game's text when it could not go on without
  them (the game was paused until they were back). `reconnected`: the phone came back. Not inputs; replay skips them.
- `aiTakeover`: the board handed an away player's seat to an AI player (`seat`, the AI's `name` and `aiOptions`,
  D-144); its moves follow as ordinary intents `by: "ai"`. Not an input; replay skips it. Only in older logs: since
  D-159 an exchange is a `seatChanged` input.
- `pause`: the game stood still, `reason` `cloud` (the connection to the service was lost), `ai` (an AI player, `seat`,
  ran over its time) or `player` (waiting for a player who went away). `resume`: it went on, `reason` `cloud`, `ai` (the
  AI answered), `playNow` (the AI's quick move was played) or `player` (everyone is back). Not inputs; replay skips them.
- `snapshot`: the complete state after `inputs` accepted inputs (only if the table was set to take snapshots).
- `end`: `reason` as above, `summary` (`text` and `highlights`, the game's own result; null when interrupted) and
  `stateHash` (a fingerprint of the final state; null if it could not be rebuilt).

## Reading a log

The state after any record can be rebuilt exactly: start the game's rules with the `start` record's seed, settings
and seats, and feed the `intent`, `timer`, `seatJoined`, `seatChanged` and `seatLeft` records in order (the refused ones too). The
table does this to verify every log. To understand a game without the rules, follow the records: who moved what, what
was refused and why, which events followed, and compare with `game-NNN.state.json` at the end.

## Moves (`game-NNN.moves.jsonl`)

The same game as rows a person or an LLM can follow, one JSON object per line, as the table's Game Viewer shows it.
**Player moves are numbered from 1** (`n`), refused ones too, in the order they were sent: "move 43" means the row with
`n: 43`. Every other record (a timer, a player joining or leaving, a pause) is a row with `n: null` between the moves.
Each row has:

- `line`: the record's line in `game-NNN.jsonl` (the `start` record is line 1), to find the raw record.
- `kind`: `move`, `timer`, `seatJoined`, `seatChanged`, `seatLeft`, `disconnected`, `reconnected`, `aiTakeover`, `aiOptions`, `pause`, `resume`, `error`,
  `snapshot`, `start`, `end`, or `gap`: no record for at least two minutes without a pause to explain it (its `line` is
  the record after the silence).
- `at` (as in the record) and `t` (milliseconds since the start); `seat` and `player` (name); for moves `by`, `intent`,
  `accepted`, `reason`, `ai` as in the record; `error` (the message) if the rules threw; `events` (how many).
- `text`: what happened, in words. Games describe their own steps (`flags` has `described`); otherwise it is a generic
  line made from the record.
- `columns`: game-specific values for the viewer's columns (e.g. round, die, card), `details`: more from the game.
- `steps`: what happened within this row for other players or by the rules alone, e.g. a coin flipped once everyone
  had guessed, a move a turn timer made, a forced move; `auto: true` marks a move nobody chose.
- `flags`: `rejected` (refused), `error`, `fallback` (an AI's quick move), `auto` (the rules moved by themselves).

`node scripts/game-log.ts <zip> move 43` in the games-service repository prints a move in full, with the state before
and after it rebuilt by replay (`moves 40-45` for a range, `info` for an overview).
