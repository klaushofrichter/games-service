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

## run.json

- `format`: `gametable-log/2`. `kind`: `game` (people at the table) or `simulation` (AI players only).
- `id`, `tableName`, `tableId` (null without the service), `platform` (`version` of the table software, `protocol`).
- `gameId`, `gameName`, `gameVersion`, and `gameSource` for a game from another repository (repository, commit, bundle).
- `startedAt`, `endedAt` (ISO 8601, UTC), `durationMs`, `timeZone` of the table (for local times of day).
- `settings`: the game's settings, as the rules received them. `seed`: the simulation's seed (each game's own seed is
  in its `start` record).
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
simulation). Seats are numbers from 0; the `start` record maps them to players, and `run.json` lists the players.

- `start`: `gameId`, `version`, `seed` (all randomness in the rules comes from it), `settings`, `seats` (`seat`,
  `playerId`, `name`, `kind`, `edge` of the board), `aiOptions` per seat, `simulation`.
- `intent`: a move. `seat`, `by` (`human` from a phone, `board` by touching the board, `ai`), `intent` (`name`,
  `payload`), `accepted`. A refused move has `reason`. An accepted one has `events` (what the game announced, e.g. a
  die roll, for animations and sounds). AI moves may carry `ai`: `ms` thinking time, `fallback` (the game's quick move
  was played because the AI ran out of time or failed), `worker`, `error`. A move the rules threw on has `error`
  (`message`, `stack`) and `accepted: false`; the game went on without it.
- `timer`: a timer the game set fired (`id`), with `events`, or `error`.
- `seatJoined`: a player took a seat during the game (`seat` as in `start`). `seatLeft`: a player left (`seat`);
  `ended` says whether the game ended because of it.
- `error`: an exception in the game's code outside a move, e.g. while drawing a player's view (`where`: `view`,
  `boardView`, `isOver`; `seat` if it was one player's view). Only the first 20 are recorded; `counts.errors` has all.
- `snapshot`: the complete state after `inputs` accepted inputs (only if the table was set to take snapshots).
- `end`: `reason` as above, `summary` (`text` and `highlights`, the game's own result; null when interrupted) and
  `stateHash` (a fingerprint of the final state; null if it could not be rebuilt).

## Reading a log

The state after any record can be rebuilt exactly: start the game's rules with the `start` record's seed, settings
and seats, and feed the `intent`, `timer`, `seatJoined` and `seatLeft` records in order (the refused ones too). The
table does this to verify every log. To understand a game without the rules, follow the records: who moved what, what
was refused and why, which events followed, and compare with `game-NNN.state.json` at the end.
