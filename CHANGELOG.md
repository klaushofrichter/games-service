# Changelog

Curated notes for the next release go under **[Unreleased]**. The deploy copies them into the GitHub release,
followed by the commit list and what the deploy verified, so this file needs no version headings: the releases
page is the history. Leave it empty if there is nothing to add beyond the commit list, and empty it again after a release.

## [Unreleased]

- **Run Game Table locally with Docker** (D-165): `docs/runbooks/local-docker.md` and `deploy/local/`: the Table Host
  with the built-in games on one machine, phones on the LAN, no cloud service, DNS or HTTPS; written for coding agents.
- Settings › Players during a game: tap a player's name to exchange them (no more *Exchange…* buttons); an exchange
  for a remote player shows the invite's QR code too (D-166).
- Fix: a remote player who was exchanged, left or was removed could still operate the table from their board; that
  board now only watches (D-167).
- games-service and extra-games are under the MIT licence (D-162); the terms of service say so and that there is no
  warranty (D-163).
- The public example of a game repository, [`klaushofrichter/extra-games`](https://github.com/klaushofrichter/extra-games)
  (Chess, Liar's Dice, Backgammon), is linked from the README, the developer guide and `llms.txt` (D-161).
- **Developer guide for game authors and LLMs** (D-160): `docs/developers/game-development.md`, published at
  `https://games.skylar.technology/llms.txt` (index), `/docs/game-development.md` and `/llms-full.txt`.
- **Exchange a player during a game** (D-159): Settings › Players › Exchange… puts someone at the table (QR code), a
  remote player (invite) or an AI player in a seat; the window closes once they have taken it. A running game keeps
  all its players: no removing during a game, and no more leaving after a minute away. Statistics name a seat's last
  player, marked with *.
- **Leave the game** on the phone (D-158): on the Ready screen and on the own tab during a game; in a game the board
  then offers to hand the seat to an AI player.
- *Advanced › Developer › Live status…* (D-157) shows what holds a game up: the board's progress, each AI player
  (pause, waiting for the board, thinking), phones held back, and recent AI answers.
- Roulette (D-150): the betting layout no longer jumps between "Place your bets" and "No more bets"; the countdown is a
  ring that empties with the seconds left in its middle, red and beating in the last five; "Bet from your phone" only
  when someone at the table bets from a phone; sounds for chips, clearing bets, betting opening, the last seconds, the
  spin (the wheel's rumble, the ball's rattle and its bounces into a pocket) and the number (a fanfare if someone won).
  The end has statistics: awards (*Odd Man*, *Seeing Red*, *Night Owl*, *Bullseye*, *Hot Hand*, *Jackpot* and more),
  a table per player and what the wheel did (longest red and black streaks, zeros, the hottest number). AI players
  each have a favourite bet and a lucky number, and bet on numbers and dozens too.
- AI players in games everyone plays at once (Roulette) move at the same time (D-150). They used to go one after
  another in the order they joined, so at a full table the last ones ran out of betting time and never played.
- End screens with eight players and long names (D-149): Coin Flip shows its results beside the coin, the corner
  buttons sit closer to the edge and to each other, long AI names fit on the lobby's seat cards, and Roulette's last
  screen shows the number instead of "No more bets".
- A game setting typed out of range (D-146) is caught in the settings window: a message names the setting and what it
  can be, waits for OK, and the window stays open on that field.
- Player names (D-148): at most 12 characters, and each name once at a table (ignoring upper and lower case); a
  taken name is refused on the phone with the reason, and a remote player's gets a number ("Ann 2"). **Change name**
  on the phone, between games.
- Player colours are the classic set (D-147): yellow, sky, red, green, purple, pearl, orange and pink. Green and teal were
  too close, and sky and violet looked the same to red-green colour-blind players.
- A remote player on a north seat (D-145): *Show result*, *Statistics* and *Lobby* sit in the game's corner as they
  see it, with upright text, the tools stay at their lower left, and the statistics window and other dialogs open the
  right way up on their screen.
- A player whose phone goes away during a game keeps their seat (D-144): after a moment the board shows them as
  away with **Hand … to an AI**. Leaving after a minute, as before, is a setting (Settings › Players).
- Phones follow the board (D-143): "Waiting for …" names the AI the board is showing, and "your turn" comes when
  the board gets to you. An AI answering its own follow-up question in the same turn (a card, then the marble) no
  longer pauses first.
- The finished screen keeps to the middle of the board (D-142): a long statistics table (six-player Loopy)
  scrolls in a smaller font instead of running over the seats.
- Hold'em sounds (D-139): a riffle shuffle and the deal at each hand, chips for calls, bets and raises (a cascade
  for all-in), knuckle taps for a check, a soft slide for a fold, a snap per shared card, and the pot raked in with a
  chime for the winner. They follow the table's sound setting.
- Board sounds no longer go missing right after the board loads (all games): they used to be dropped while the
  browser's audio was still starting.
- Hold'em: the street (flop, river…), the hand number and how many hands are left show in two corners of the board
  (D-138), upper left facing north and lower right facing south, instead of one line in the middle that faced south. The Lobby button moved to the top
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
