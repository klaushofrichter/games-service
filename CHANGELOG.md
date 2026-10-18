# Changelog

Curated notes for the next release go under **[Unreleased]**. The deploy copies them into the GitHub release,
followed by the commit list and what the deploy verified, so this file needs no version headings: the releases
page is the history. Leave it empty if there is nothing to add beyond the commit list, and empty it again after a release.

## [Unreleased]

- Hold'em: the hand number and how many hands are left show in two corners of the board (D-138), upper left facing
  north and lower right facing south; the middle of the felt names the street only. The Lobby button moved to the top
  right. "… to act" sits right under the pot, clear of the south seat's cards.
- Hold'em: **Next hand** on the board under each hand's result (D-136), with the seconds left, starts the next hand
  at once instead of waiting out *Seconds to show each result* (**Finish** after the last hand). Remote boards show it
  too while the table gives remote players board control. Games list such skippable waits in the manifest
  (`skipTimers`).
- Hold'em: every player's cards and bet lie on the felt (D-137). The north and south seats' cards used to sit on the
  rail and their bets off the table; the dealer button sits beside the dealer's cards, on the felt too.
- **Show join code** in the board's settings (D-130): the QR code, the address and the code in a large window, also
  during a game, when the lobby's QR panel is not on the screen. A phone that lost its seat rejoins with it; the
  phone's "scan the QR code" messages say where to find it.
- A full table (D-129): when no seat is free, *+ AI player* and *Invite* are greyed out, the board's QR panel says
  *No free seat* with what would help (more seats, or removing a player), and a phone that scans the code is told so
  instead of getting the name form; it shows the form by itself once a seat is free. Nobody joins without a seat any
  more.
- **Advanced** on the board (D-128): a hammer-and-wrench button beside the gear opens *Simulation…*, *Game logs…*
  and the developer setting *Games without a player at the table*. They are no longer in the lobby's toolbar or the
  settings, which keep what players need. The DEV tag is on this button now. On a remote board with board control it
  offers the game logs only.
- Board: during a game the gear and the turn-around button stay where they are when the game is turned (D-127). In
  Loopy they had landed on the round and deck displays when the game faced north.
- A player removed during a game leaves their colour on the seat (D-125): in Loopy the AI that takes over keeps it,
  instead of switching to the seat's default colour (which could be someone else's).
- Phones: during a game the header is a slim tab bar (D-123), so the game gets the screen: your own tab (colour, name,
  seat) has Rules, everyone at the table and the terms; the game's tab opens by itself when it is your turn. The
  lobby looks as before.
- Player colour 6 is pearl instead of citron, which looked too much like amber (D-124).
- Board: **Escape** closes the topmost window (settings, lobby, dialogs), like a tap beside it; in a confirmation it
  means Cancel (D-122). The settings and lobby windows no longer rebuild while a game runs: in a game of AI players the
  settings jumped back to the top several times a second, so *Done* could not be reached. *Done* now stays at the bottom
  of the settings.
- Hold'em and Roulette use the players' lobby colours (D-121): the winner's name and the bets in Hold'em, the chips in
  Roulette, as on the seat plates. Before, they used the seat's colour, so a colour picked in the settings did not show.
- Roulette: chips sit on their cells again. Their drop-in animation moved every chip to the layout's top-left corner;
  now only new chips drop in, in place.
- **Game Viewer** on the board (D-120): *Game logs* under *Advanced* lists the finished games on this
  table. A game opens as a table of its moves, numbered, with the time, the player and what happened in the game's
  own words (Coin Flip and Pachisi describe theirs), filters for a player, moves only and problems, *Move #* to jump to
  a move, and each move in full with the state before and after and a reference to copy for a developer or Claude
  ("…-pachisi-9908 #74"). Remote players with board control can open it too.
- Game logs now say when a game stood still and why (the service lost, an AI over its time, a player away, Play now),
  and each finished game's zip has a readable move list (`game-001.moves.jsonl`). `scripts/game-log.ts` reads a log
  zip from the command line: an overview, a range of moves, one move in full.
- SDK: games may describe their steps for the viewer and the logs with `describe(step)`, with extra columns in the
  manifest (`viewer.columns`).
- Players lost during a game: a game that can't go on without a player now waits while their phone is away, with a
  card at their seat on the board (the game's reason and End game), and goes on when they are back. Removing such a
  player ends the game with its reason, and the board says so first. Games can give their own reason when a player
  leaves. Today's games go on as before.
- A player's colour stays with them when they move to another seat (D-117); before, the default colour changed
  with the seat.
- A developer setting on the board (now under *Advanced*), *Games without a player at the table*: off at every start, it allows
  games with remote and AI players only, or AI players only, for testing. While it is off, the board no longer removes
  the last player at the table once a game is chosen or running. *Advanced* shows DEV while it is on.
- Board, Up next screen: each player's chip is framed in their colour, with a ring that fills once they are ready;
  a player whose phone dropped shows no dot on a red background. Tapping a chip offers **Remove**, online or not.
- Board lobby: a selected player's card shows its thicker border in the player's colour instead of brass.
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
