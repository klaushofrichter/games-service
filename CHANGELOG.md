# Changelog

Curated notes for the next release go under **[Unreleased]**, one line (or a few wrapped lines) per change worth a
note. The deploy puts the lines added here since the previous release into that release's notes on GitHub, followed
by the commit list and what the deploy verified (`scripts/release-notes.sh`), so each note is published once even if
the section is not emptied; empty it now and then. The file needs no version headings: the releases page is the
history.

## [Unreleased]

- Developer guide: "What a game needs" says what is required of a game (follow the platform, touch alone) and what is expected (AI players, results and awards, rules for players, tests); the website's questions and answers link to it (D-320).
- Website: a page of questions and answers at `/faq`, in three groups (getting started, developer knowledge, gameplay), linked from the top bar and the foot of every page (D-320).
- A table can be started with `--screensaver N` (minutes, 0: off), `--pointer on|off` and `--sound N` (percent) for its own screen: they hold for that start and win over the board's saved settings without changing them; the settings show them, and only a change made there is saved. In the packages' starter and the table host (`TABLE_SCREENSAVER`, `TABLE_POINTER`, `TABLE_SOUND`); the installation guides list every option (D-319).
- Board: "Hide the mouse pointer in fullscreen" is off to begin with again; a table with a touchscreen starts with `--pointer off` (D-319, replaces D-318).
- Board: a browser that shows nothing but the board (Chrome's kiosk mode, F11) counts as full screen: the mouse pointer hides there with the setting on, and the settings say so instead of offering Fullscreen (D-317).
- Packages: a start no longer hangs when the GitHub CLI waits for a locked keyring (as after automatic login): after 30 s the starter says so and goes on; the Linux guide shows a read-only token for such a table (D-316).
- FreeCell: the Linea design's corners are plain red or black, so a card's colour reads at a glance; the faces keep their suits' colours (D-310).
- Website: four links in the foot (The table, Game service, Game repositories, About) led nowhere from /build; fixed, and every link within the website is now checked with each change (D-312).
- Packages: `--repos all` takes every game repository of klaushofrichter the GitHub sign-in can read (named …-game or …-games), so a new one needs no naming (D-314). In the packages once they are built again.
- Board: Advanced › Quit the table, on a table started by the packages' starter: it stops Game Table on that computer, the way out of a kiosk browser (D-315).
- Website: the developers' part is a page of its own, /build, reached from the top bar; the landing page keeps a short way in and is about 30 % shorter. Old links to parts that moved are taken along (D-312).
- Website: pages are sent compressed (the landing page's text was 150 KB, now about 40 KB on the wire) (D-312).
- Website: FreeCell's card designs change every 3 seconds while in view, start with the flowers, and go on from where they were when you come back to the section (D-311).
- Website: a section on FreeCell's card designs, the six fading into each other, with how to ask your AI for more and the image model that drew them (D-311).
- FreeCell: six card designs, chosen on the phone with a preview and changed at any time (Classic, Plain, Mosaic, Botanical, Linea, Speakeasy); the table keeps the choice (D-310).
- FreeCell: a house rule, on by default, lets a foundation's top card be taken back to a column or a free cell; a switch in the board's settings, kept on the table (D-310).
- Phone: an old or wrong join code no longer ends in a refusal: the page says the code is not current and takes the code the board shows now, typed; so does a page opened without a code (D-309).
- FreeCell: the board's settings show the deal's number during a game; type another on the number pad to play that deal (asked first: the game that is on ends) (D-308).
- A game's board settings can ask in the board's own dialog (`confirm`).
- Website: FreeCell among the games, as the example of a single-player game on the board; "Ten games, and more" (D-308).
- FreeCell: the results table has no Player and Result columns (one player, and the headline says both), so it fits a phone without scrolling sideways (D-308).
- New built-in game: FreeCell, a solitaire for one player played on the board: drag cards or tap them, undo, a hint, only deals that can be solved, awards at the end (D-308).
- Awards and Results: a game for one player keeps the awards its player earned (D-308).
- Board: every window and list that scrolls has the wide scrollbar and follows one finger or two: all windows, the finished screen's results, the game logs, Live status. The deck beside the board scrolls by dragging (no wide bar); phones scroll by touch as before (D-306).
- Board: Awards and Results scrolls with the wide scrollbar and by finger, like the settings windows (D-306).
- Board: "Hide the mouse pointer in fullscreen" also hides it over the deck beside the board (Play from the board) (D-296).
- Board: the Settings, Advanced and Game data windows show one scrollbar, not the browser's thin one beside the wide one (D-306).
- Phone: a name the player gave is kept on that phone and is in the name field the next time, instead of "Player N"; the table's proposal is never kept (D-307).
- Board: the Settings, Advanced and Game data windows scroll for a finger: a wide scrollbar of their own (twice the old one) and the content follows one finger or two (D-306).
- The dependency check lets one advisory through until 2026-12-17 (picomatch, test tools only, no fixed version yet); everything else at high severity still blocks (D-305).
- Review fixes: the screensaver comes back after its first time; "Tap to return to fullscreen" works with a finger; a game's data on the table is never taken for empty when it could not be read, and a screen that was away reads it again; an imported file keeps to the limits for display choices; the master volume scales a game's own audio levels instead of replacing them (D-304).
- Simplify pass: the Game data window no longer asks the table on every lobby message, a game's data is read without copying all of it, changes made in a burst are written once, and the lobby swipe measures the board's turn once per swipe (D-303).
- Game data: a game can keep data on the table between games (`storage` in the manifest, `ctx.store` on the board and the phones), on the table's own computer, with no service needed. Advanced › Game data exports, imports and deletes it per game. Display choices now survive a restart (D-302).
- Website: the GE150 Pro card no longer ends with its repository line and the Mooer disclaimer (D-301).
- Website: the games section's heading is "Nine games, and more, and room for yours."; the synthesizer and the guitar pedal stay in the section (D-300).
- Board: switching Play from the board on or off in fullscreen asks for one tap to return to fullscreen; that tap does nothing else (D-299).
- Board: a screensaver after an hour without input, a dark window with a slowly drifting clock; a touch brings the board back. Settings › Display, on by default (D-298).
- Board settings: hide the mouse pointer in fullscreen (D-296), and a master volume for the screen (D-297).
- Lobby: swipe across the game tiles to see the next or previous three, with a slide; the pages go round (D-295).
- Board: no context menu on the table's touchscreen (long press, two-finger tap) (D-294).
- Review fixes: no markup from a table in the console, the Table Host survives a malformed socket message and a game's timer error, log uploads never lose a log, remote boards show only what they may do, Hold'em short all-ins and Roulette bet types (D-293).
- Simplify pass: the table's files are cached by the browser until they change, an AI move draws the board once, a local table recognises its own checkout by path, shared rate limiting in the service (D-293).
- The website shows GE150 Pro, a guitar pedal's remote control for electric guitar players, with the phone as a second screen (D-292).
- The extra-game repository ge150pro-game (GE150 Pro) is listed for tables (D-291).
- A local table's notice shows each game's version instead of commit hashes (D-290).
- A local table's notice also lists the repositories its other games come from (the service's, or downloaded at start), with branch and commit (D-289).
- Play from the board can't be switched on when every seat is taken: "Game is full, first remove a player." (D-288).
- Lobby: a game tile names the repository it comes from instead of "extra"; games from private repositories have a red border (D-287).
- Board: an open pulldown has a light green frame; only the chosen option is brass (D-286).
- Console: the Refresh button of a game repository says what it does (D-285).
- synth-game (FM-1 Synth) is installed by the packages like extra-games; the website shows FM-1 Synth, solo games and credits fm1-emu (D-284).
- Remote boards: a watcher's view stays upright when the table turns its board, in the lobby and during a game (D-283).
- Solo games: a one-seat layout; player counts in words ("needs exactly one player"); a game the seated players don't fit offers to make room (remove players, remote players become watchers) before it is chosen (D-282).
- The extra-game repository synth-game (FM-1 Synth) is listed for tables (D-281).
- Board: Lobby, Show result and Awards and Results turn to read from the north, in their corner, when the game faces north on the table's own board (D-280).
- Code review fixes: a re-uploaded log keeps its earlier copy when refused; extra-game repositories with a README or hidden files in games/ work; remote requests are bounded; AI options are checked before a game is chosen; the invite page is never framed (D-279).
- Phone: *Leave the game* on the result screen too, so a player can leave right after a game (D-278).
- Code cleanup: board control decided once by the server, one remote-place test, shared code alphabet and generator, the invite QR fetched once, players sent as an allow list, smaller tidy-ups (D-277).
- Release notes of the packages: extra-games linked and added automatically, the checksums named; a notes-only run rewrites them without a new build (D-276).
- The website: the package cards' ".pkg" and ".tar.gz" keep the tails of their g (D-275).
- The website: the captions under the hero's table each stay at least 1.2 s, also on a fast scroll (D-274).
- The website: new text for the four numbers under the ticker (D-273).
- Board: names in their colour on the away and waiting cards; the exchange offers an AI player on a board opened during a game; Versions name the game being played and its source; Live status shows clock times and no longer redraws while nothing happens (D-272).
- The packages' publish step works again, and a test parses every bash step of the workflows (D-271).
- Install guides and llms.txt: hints for AI agents about ports (firewalls) and the GitHub sign-in, and a Troubleshoot section; the starter saves the private repositories only when it asked (D-270).
- Install guides, website and release notes: exact wording for a taken port, what an agent reports, comparable versions, network instead of WiFi (D-269).
- Packages: a program on 127.0.0.1 counts as holding the port; macOS: close the window and click Terminate; guides say to stop before updating, which package they describe, and that --service sends earlier logs (D-268).
- Packages: a start without a desktop, or on a locked one, no longer crashes or opens a browser; a taken port says what holds it; the version names its release; clearer starter lines and guide links; the sound pill clears the north seat (D-267).
- Packages: a failed GitHub sign-in starts the table with the public games; the sign-in's Enter step is explained; --repos no longer changes the saved list; the release has a checksum file the guides check against (D-265).
- A local table without the service shows no invite button; links on the board wrap between their parts; two e2e checks no longer race the coin or hide why the AI wasn't ready (D-264).
- Packages: --smoke-test fails on a missing named repository and keeps the saved private repositories; build times in the package versions; install guides take in the second macOS and Linux reviews (D-263).
- The website: a game's close-up no longer shows another game's phone (Chess, Backgammon, Pachisi), those three have phone screenshots taken from the same game as their board, and every screenshot is taken again from the current release (D-261, D-262).
- Packages and the Windows script: game repositories of other organizations (owner/name) are explained in the install guides and kept apart from same-named ones (D-260).
- The website: About comes first, Start here on the Gamers card, the packages' missing remote players and the public host on request explained, current counts, and one agent prompt fewer (D-259).
- The website: the Docker section's agent prompt is about creating new games.
- The macOS package installs for the current user, into ~/Applications, without administrator rights (D-258).
- The website: a Download section for the Windows, macOS and Linux packages, with the install guides served at /docs/install/ and a prompt for an AI agent; each guide has a section for agents (D-257).
- Packages for one computer: a Windows installer, a macOS .pkg and a Linux .tar.gz with their own Node.js, published on the release local-table, with install guides in docs/install/; they can join the service later with --service (D-256).
- Windows 11: one script downloads the games (the private ones by name), installs Node.js 26 and the GitHub CLI if needed, and starts a table without the service; checked on GitHub's Windows hosts (D-255).
- The deck's At the table list: names in the players' colours, one's own in bold, places as "South" (D-254).
- Players' names in the result tables in their colours (D-253).
- A local table says once that it is local: no remote players without the service, and the checkouts and branches its games run from (D-251).
- Every number and text field on the board opens the board's pads; dialogs turn with the board while open (D-252).
- One shell for the board's pads; the number pad takes a keyboard and opens from the window that chooses a game too (D-250).
- `{key.hint}` in a game's description: a paragraph on the chosen setting's meaning when choosing the game (D-249).
- Pulldowns on the board turn with their window; a setting that doesn't apply is hidden when choosing a game; `labels` for how values read (D-248).
- `scripts/local-table.sh --offline --all-games` plays every game checked out beside games-service at a table without the service or console (D-247).
- A choice can describe its options (`hints`, a choice item's `hint`): the chosen one's text shows under the setting (D-246).
- Game settings can depend on others (`when`) and draw a fresh value (`random`, a seed); whole numbers take digits only, and a wide one is typed on the board's number pad, also a game's own `number` setting. Deck: Change name at the top, Leave beside it, a default name beside the board (D-245).
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
