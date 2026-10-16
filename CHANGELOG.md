# Changelog

Curated notes for the next release go under **[Unreleased]**. The deploy copies them into the GitHub release,
followed by the commit list and what the deploy verified, so this file needs no version headings: the releases
page is the history. Leave it empty if there is nothing to add beyond the commit list, and empty it again after a release.

## [Unreleased]

- The board's access code badge shows how long the code is valid (*valid forever*, *valid for 12 weeks*, … *valid
  for 30 minutes*), and *expired* in red once it has run out, while the table keeps working.
- The board's access code keypad takes a pasted code (Ctrl/⌘+V, or its **Paste** button), with or without the
  dash; the console now copies a new code without the dash.
- Game logs for analysis: every game's log, simulations included, now reaches the service. A table writes the log
  as the game is played and uploads it when the game ends, retrying until the service has it; a game the table stopped
  in the middle of is uploaded after the next start, marked interrupted. Each log carries its metadata (game, table,
  players, when, how it ended), a README describing the format, the final state and any errors the rules threw, and
  is checked by replaying it. The console lists logs with that metadata and filters, and download tokens can be
  limited to a game, a table and dates. The board's simulation dialog says how the games ended.
- Access codes approve a table without a pairing code, and the service keeps its state on a persistent volume, so
  tables, codes and logs survive a deploy.
- First deployment to the cluster: the cloud service at https://games.skylar.technology with Google sign-in for
  administrators, and the table-host image for table PCs.
- Extra-game repositories: the console lists GitHub repositories with games (private ones too, with
  `GAME_REPO_TOKEN`), and an administrator ticks them per table, at approval or later. Tables install those games
  between games, and remote players see them too. Games in such a repository import `@game-table/sdk`.
- The repository list survives restarts: `deploy/game-repos.json` is baked into the cloud image (shown as *deploy
  config* in the console); repositories added in the console are kept too (D-114).
- Rules for every game on the phones: a **Rules** button opens the chosen game's rules, with illustrations and the
  settings chosen at this table. Games provide them as `how-to-play.md` with images in `assets/`.
- Games on the board face north or south only, using the long sides; a turn-around button left of the gear turns a
  game 180° without moving the players. Remote players on an east or west seat can show the board upright, at full
  width. The seat plates now sit the same distance from the edge on all four sides, and each phone shows the
  player's colour in its seat badge.
- Pachisi: sound effects (rolling, moving, a six, a token sent back); a **Pieces** setting (icons or
  numbers); and tokens can be moved by tapping them on the board, for players at the table and remote players on their
  own board. Games can allow such board moves with `boardIntents` in their manifest.
- An AI player's window has a **Remove** button, and opens before a game is chosen too.
- **Access codes** (D-113): the console creates codes that approve a table at once, without a pairing code, valid
  for a week, a month, a year or forever, with a choice of games (built-in only, all repositories, or chosen ones).
  A table takes a code from `TABLE_CODE`, `--code` or a keypad in the board's settings. A code serves one table;
  the console lists codes with their table and last use, and can edit, release, revoke and delete them. The code
  itself is shown once and stored only as a hash.
- **The service keeps its state** (D-114): with `DATA_DIR` (the PVC at `/data` in the cluster) paired tables, access
  codes, repository ticks, console-added repositories, logs, invites and the retention setting survive restarts and
  deploys, so tables no longer need approving again after a deploy. SQLite, with an hourly snapshot the service
  starts from if its database is missing or damaged. Storage stays within a budget (`DATA_LIMIT_MB`, 1 GiB): the
  oldest logs make way, and the console's Overview shows how full it is.
- The console can delete records (D-115): a disconnected table (optionally with its logs), single logs or all
  simulation logs, and it lists download tokens with a Revoke button. Runbooks in `docs/runbooks/` reset the
  service's state or restore it from a backup.
- The phones' *At the table* list shows each player's colour before their name.
- Scrollbars in the console (e.g. Game logs), the invite page and the sign-in pages use the green felt colours instead of white.
- Player colours are a board setting for every game (gear → Player colours), shown on the board as the card's border
  and a dot before each name, in the lobby and in games. Pachisi no longer has its own colour setting.
- Pachisi with two players puts them on opposite sides of the board.
- Pachisi's pieces show icons by default; *Pieces → Numbers* shows 1–4.
- The terms of service open in a window with ✕ on the phones and the board (also remote), not in a new tab.
