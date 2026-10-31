# Changelog

Curated notes for the next release go under **[Unreleased]**, one line (or a few wrapped lines) per change worth a
note. The deploy puts the lines added here since the previous release into that release's notes on GitHub, followed
by the commit list and what the deploy verified (`scripts/release-notes.sh`), so each note is published once even if
the section is not emptied; empty it now and then. The file needs no version headings: the releases page is the
history.

## [Unreleased]

- A phone joining by QR code, and a player's invite, start with the name "Player N", which they can change; a game's settings may show a line of text (D-244).
- `scripts/local-table.sh` says phones must be on the computer's WiFi and warns when the QR code's address does not answer; a new e2e check opens that address on a phone page (D-243).
- Awards and Results: "," and "and" between award holders in white; the sections read *Results* and *Statistics* (D-242).
- A board that lost its table (stopped or restarting) hides the join code until the table answers with its new one; a phone with an old code is told at once why it no longer works (D-241).
- Played from the board, the lobby's side panel reads *Single local player* and has no second invite button (D-240).
- Awards and Results shows the award holders in their players' colours, also after a colour changes (D-239).
- A game's description can show its settings: `{key}` becomes the setting's value on the game's tile and in the window that chooses the game (D-238).
- Table rules in the board's settings: an away player can be replaced by an AI player after 3 or 5 minutes (off by default, D-236), and AI players get different play styles (on by default, D-237).
- Developer guide: *Badges on seat plates*, the convention for a tab such as *Winner* on a player's seat plate, and the cookbook's request for it (D-235).
- In the lobby, an AI player's seat plate shows its play style or strength after *Ready*, on the same line (D-234).
- Awards and Results, opened from a game's last screen, has *Back to game* beside *Done*: it shows the game's last screen again (D-233).
- Awards and Results scrolls inside its rounded corners: its head stays, the rest scrolls; every board window keeps its scrollbar inside its corners (D-229).
- In the lobby, a tap beside the seats deselects the selected player, and so does leaving an AI player's Configure window (D-230).
- The console's Refresh for a game repository stays disabled while it fetches, and after 30 s without an answer says so and works again (D-232).
- The lobby's game tiles are all as tall as the tallest game, so paging through the games no longer moves the pager (D-228).
- A game played from all four edges (`"facing": "any"`) keeps the corner arrows during the game to face any edge,
  without the turn button; its Lobby button moves beside the corner (D-227).
- A game can give its AI players a random play style when they are added (`"random": true` on an AI option), and the
  board's settings window shows each AI player's style beside its name, with a tap to change it, also during a game (D-226).
- The website lists Chess's AI engines: its own, Stockfish (via stockfish.online) and the Lichess cloud.
- The console marks repositories added there "console" (kept across restarts, D-114), no longer "until restart", and every label in it explains itself on hover (D-225).
- The board's messages name the developer settings as the board shows them, "Developer settings", not "Advanced › Developer".
- The website mentions drag and drop in Chess and Backgammon, and Backgammon's wildbg AI players.
- A game can show a notice under its AI players' options, e.g. an engine's licence (`ai.notice`, D-224).
- Exchanging the last player at the table asks first and switches on games without a player at the table (D-223).
- A player whose seat went to an AI player gets it back, with their name, by joining again as themselves; beside the
  board, *Take your seat back* does it in one tap (D-222).
- *Awards and Results* sits in the game's corner of the board, where *Show result* was (D-217).
- Play from the board: the deck beside the board no longer warns "session expired" before its name form (D-218).
- The access code moves from the board's settings to Advanced (the tools button) (D-219).
- The lobby warns when the access code has less than 3 hours left, counting down in minutes (D-220).
- A watcher can change their name and go fullscreen from the eye's window, which now says how they could play (D-221).
- Cleanup pass: the service reads and writes stored logs without blocking other tables, the console doesn't refresh
  in a hidden tab, the Game Viewer opens a simulation's log without replaying every game again, and repeated code in
  the table host, the cloud service, the board and the phone is folded into shared helpers. Seat plates are rewritten
  only when they change, so their animations no longer restart on every update.
- The board's settings window shows a game's switch change at once (it waited for a reopen), and dims the game settings
  that are locked during a game (D-215).
- At the end of a game, one button: *Awards and Results* opens the awards and statistics, and its *Done* leads to the results (D-216).
- The console shows remote players and watchers connected right now, per table and in total (counts only, D-214).
- Tests: the Pachisi game played through two decks no longer fails now and then on the intent limit, nor the AI
  options test under load (D-213).
- `docs/runbooks/remote-play-relays.md`: when remote players need a relay and how to set one up and check it; the
  service checks its Cloudflare key at start (D-211).
- The board, the phones and the website show their icon in Safari too (PNG, `favicon.ico` and an Apple touch icon besides the SVG, D-212).
- A long deck, such as a remote player's, no longer shows a seam in its background (D-210).
- Remote players on a phone's hotspot or cellular data can connect: with a Cloudflare TURN key the service hands out
  short-lived relay credentials, used only when a direct connection fails (D-209).
- `scripts/mac-table.sh` is gone: use `scripts/local-table.sh`, which keeps a table set up under the old name (D-207).
- A Windows PC with Docker Desktop: `deploy\local\setup.ps1 -Start` writes the settings, starts the table and opens
  the board, in PowerShell; the PR checks run it and the Table Host on Windows (D-208).
- `scripts/local-table.sh` starts on a Mac again: its start-up text no longer trips macOS's bash 3.2.
- A local cloud service in Docker starts on a fresh volume again (the image creates `/data` for its user), and
  offers only the public extra games (D-206).
- The console is at https://games-console.skylar.technology; the documentation, the table PC kit and
  `scripts/sync-secrets.sh` say so (D-205).
- The console can have a host of its own (`CONSOLE_URL`, games-console.skylar.technology): its sign-in and session
  live only there, out of reach of the pages a table sends to remote players; `/admin` on the website's host sends
  people there (D-204).
- Security: a phone can pass only the sling's own fields to the boards and card faces draw only real cards; board access, served files, idle connections, move rates, remote messages, token comparison, uploaded logs and invites are hardened (D-202). Clean-ups without a change in behaviour (D-203).
- A phone no longer repeats a game's last events when the lobby changes; each move animates once (D-201).
- The cluster's deployment request leaves this repository, and private games are named without their details (D-200).
- The documentation checked against the code: README, developer guide, runbooks, rules for players and decision records; the console is called *Console* on the website too; table PCs keep a lobby seat for five minutes as intended (D-199).
- Terms of service for the website at `/terms`, linked beside the version at the foot of the page (D-197).
- `docs/glossary.md`: the words for the platform's parts, their names in the code, and how seats are named (D-197).
- `docs/cookbook.md`: what to ask an AI agent to play, build a game, keep games private, run a game service, complete a game and ship a change; `docs/architecture.md`: how a game works with the platform (D-198).
- The public website shows Last Card (nine games), and a new block shows the sling: an animated schematic of a card
  pushed off a phone, coming onto the board at that seat and flying onto the pile, the real screenshots of that
  moment, and the few lines a game writes for it. *Play at home* mentions an iPad as a small game board (D-196).
- A board opened in another browser (an iPad, another computer, the table's network address) plays sound after the
  first tap: a finger's tap on a touchscreen now counts, and until then the board shows *Tap to turn the sound on*
  (D-195).
- Slung and drawn cards no longer jump at the player's seat on the board (D-194).
- The sling can have a release line: let go of a card above it and it is played toward the middle (`line()`, D-193).
- A phone that lost its connection keeps its seat in the lobby for five minutes instead of one (`DECK_GRACE_MS`, D-192).
- A phone's short messages (a refused move) float over the top of the screen instead of pushing the game down (D-191).
- The board on another screen (D-190): the board's settings show a QR code and link that move the board to an iPad,
  a TV or another computer on the same network, which is then remembered; the table's window says where it went and
  can take it back.
- Sling (D-189): games can let players push a card off the top of their phone and see it come onto the board at
  their seat while they drag, then fly to the pile; drawn cards fly the other way (`/shared/sling.js`,
  `ctx.gesture`, the board's `gesture` hook). Card Sling is a test game for it.
- `scripts/local-table.sh` (was `mac-table.sh`, which still works) runs a table on macOS or Linux from the latest
  `main`, or from any branch with `--branch production` or `--branch experiment/card-sling`; `--no-pull` runs the
  checkout as it is (D-188).
- The public website: the developer section says the platform is made for agentic coding (*You prompt your AI
  agent*), and a new About section at the end tells where the project and its code come from (D-187).
- The public website: the Mexican Train picture changes to a second look (Lava lamp, numbers) as one scrolls,
  and a new section at the end shows the game service's admin console and what a service needs and adds (D-186).
- The public website shows Mexican Train from extra-games, eight games in all, and a *Demo game* block in the
  developer section on what the game customises within the platform (D-185).
- With *Play from the board*, Fullscreen takes the whole page, so the deck beside the board stays on screen (D-184).
- The website's Game Viewer screenshot is taken again with D-181's simulation times, at the start of the second
  hand (D-183).
- The board's Advanced window (hammer and wrench) shows the versions of the platform and of every game on the
  table at its bottom, also on remote boards; `GET /api/v1/version` returns the platform's (D-182).
- The Game Viewer shows a simulation's move times from its start (`+8.0 s`), in the list and a move's detail, as
  `scripts/game-log.ts` does; they were `+0.0 s` or huge negative numbers (D-181).
- The public website's developer section shows how to test without players and debug with an AI: AI-only
  simulations, game logs an AI can read, the Game Viewer's move references and the board control API (D-180).
- The public website: on a phone, a game's close-up scrolls by itself and the page behind it no longer moves (D-179).
- The public website has a section on statistics and awards, with a real screenshot of the window after a game of
  Hold'em and the awards of Hold'em, Chess and Backgammon (D-178).
- The public website shows a PREVIEW / DRAFT sash in its top right corner while the service is not live;
  `PREVIEW_BANNER=0` removes it (D-177).
- A new public website at `games.skylar.technology`: local play around one touchscreen, the seven free games with
  real screenshots, the lobby's player and watcher handling, a developer section on building games with AI
  (Backgammon as the example), game repositories, installing at home, and the table hardware to come; the admin
  sign-in is a small link in the top right corner (D-176). The README was checked against the code and corrected.
- *Play from the board*, a developer setting under Advanced: one player at the table plays from a deck beside the
  board, laid out like a remote player's page, without a phone; no QR code meanwhile; remote players, watchers and AI
  players as usual (D-175, `BOARD_DECK=1`).
- Local installation: `llms.txt` points to the runbook, now also at `/docs/local-docker.md`; it needs no cloud
  service, also not for games from private repositories, which are cloned (D-174).
- The release notes take only the CHANGELOG lines added since the previous release; the section was emptied of 67
  notes that every release had repeated (D-173).
