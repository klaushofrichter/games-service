# Decision log

Decisions that shape the Game Table platform, newest last. Each entry records what was decided, why, and who decided. "Klaus" marks product decisions from the project owner; "Claude" marks implementation choices made while building, which Klaus can overrule. The full reasoning lives in the *Game Table — Concept & Architecture* document.

Format: **D-nnn · date · decided by** — decision. *Why:* reason.

Records are history: an older record is not edited when a newer one changes it. Where that happened:

| Earlier | Changed by | What changed |
| --- | --- | --- |
| D-004, D-005 | D-118, D-175 | Developer settings: games without a player at the table, playing from the board |
| D-013 | D-080 | Corner buttons replace the 90° and 180° buttons |
| D-029 | D-096 | The repository is public |
| D-031 | D-068 | Node 26 instead of Node 22 |
| D-036, D-071, D-097, D-098 | D-114 | The service's state is SQLite on a volume, not in memory or PostgreSQL |
| D-044 | D-084 | Roulette's seats |
| D-046 | D-079 | Hold'em for up to 8 players |
| D-057, D-106 | D-159 | Remote boards with control change colours, AI options and settings |
| D-088 | D-106, D-127 | Player colours; the gear stays put during a game |
| D-091, D-102, D-107 | D-127b | Calendar versions for games |
| D-102 | D-109 | Pachisi's pieces default to icons |
| D-112 | D-135 | A language-model AI player is postponed |
| D-118, D-120 | D-128 | Simulation, game logs and the developer setting move to *Advanced* |
| D-118, D-119, D-144 | D-159, D-171 | Nobody leaves a running game by timeout; `onSeatLeft` is no longer called; `replace-with-ai` is gone |
| D-125 | D-171 | `seatColors` is always empty |
| D-134 | D-141 | No two-minute limit on *Show result* |
| D-159 | D-166 | Tappable names replace the *Exchange…* buttons in the settings |
| D-167 | D-168 | Watching is a mode of its own |
| D-171 | D-172 | Rejoining by name |
| D-172 | D-222 | A seat handed to an AI player comes back to the person who joins with their name |

## Product (concept phase, 12 Oct 2026)

- **D-001 · 2026-10-12 · Klaus** — The board is the shared control surface. Every local player may operate it; there is no privileged player and no login. *Why:* the table is about people playing together in one room.
- **D-002 · 2026-10-12 · Klaus** — Players join with any display name. Saved profiles (PIN or password) may come later. *Why:* zero-friction joining.
- **D-003 · 2026-10-12 · Klaus** — No real or virtual money in the lobby. Games may use points or virtual money with no real-world value. *Why:* keeps the platform out of gambling regulation.
- **D-004 · 2026-10-12 · Klaus** — A game needs the board and at least one physical player. Fully AI games are allowed only through the simulation menu, for testing and AI training. *Why:* optimise for the in-person experience.
- **D-005 · 2026-10-12 · Klaus** — Every human player needs a private deck (phone first; tablet or PC work). No board-only play. *Why:* private information such as cards must stay private.
- **D-006 · 2026-10-12 · Klaus** — Remote players may operate the board by default; this can be restricted per table or session. Remote players are capped (default 4). *Why:* local experience first, remote as guests.
- **D-007 · 2026-10-12 · Klaus** — The simulation menu is open to anyone, protected only by a confirmation dialog.
- **D-008 · 2026-10-12 · Klaus** — Every game is logged with its configuration, seeds and every action, so it can be replayed. Logs are a zip of JSONL files, stored on the table and uploaded to the service, not encrypted, downloadable by admins or with admin-issued tokens. *Why:* replay, debugging and AI training data.
- **D-009 · 2026-10-12 · Klaus** — Log retention is a service setting (default 90 days), synced to tables so local and cloud copies expire together.
- **D-010 · 2026-10-12 · Klaus** — Terms of service are readable on the deck; no acknowledgement is required.
- **D-011 · 2026-10-12 · Klaus** — Games use the full board in their own style; a small platform-owned lobby button stays on top for player management, rotation and game changes.
- **D-012 · 2026-10-12 · Klaus** — Board is 16:9 (1080p or 4K), lying flat. Edges are North/South (long) and East/West (short), no diagonals. Every game supports North and South; East/West are optional. Seat layouts are 2, 4, 6 or 8.
- **D-013 · 2026-10-12 · Klaus** — Rotate 90° / 180° buttons turn only the orientation of text and controls; seat-to-player association never rotates.
- **D-014 · 2026-10-12 · Klaus** — Seats are auto-assigned and can be changed on the board; games may add seating constraints in the manifest.
- **D-015 · 2026-10-12 · Klaus** — No offline play. A lost service connection pauses the game with a graceful exit (wait, save if the game supports it, or terminate). Lost decks and remote boards can reconnect or be evicted; whether a game continues is up to the game.
- **D-016 · 2026-10-12 · Klaus** — Third-party games may come later; they must be installed through the service and use the common API.
- **D-017 · 2026-10-12 · Klaus** — No voice or video in the platform; players use their own tools.
- **D-018 · 2026-10-12 · Klaus** — Scale: one game at a time per table, up to 8 players, a library of 20–50 games. Metrics start with number and duration of games played.
- **D-019 · 2026-10-12 · Klaus** — Plain HTTP on the venue LAN; the table PC has no public certificate. Only the table ↔ cloud link and remote clients use TLS.
- **D-020 · 2026-10-12 · Klaus** — Remote players connect peer-to-peer (WebRTC) to the table PC, brokered and authenticated by the cloud, with TURN as fallback. The table PC is the sole game server for remote boards.
- **D-021 · 2026-10-12 · Klaus** — The deck is a full HTML page served by the table PC; no iframe sandbox for now.
- **D-022 · 2026-10-12 · Klaus** — Replay features (speed, steps, fast-forward) are game-specific and come later; the platform only guarantees complete logs.
- **D-023 · 2026-10-12 · Klaus** — Phases: 1a platform and lobby, 1b roulette, 1c remote play. Follow-up demo games: a dice/token race (Pachisi/Sorry! style) and a simple poker variant.
- **D-024 · 2026-10-12 · Klaus** — The lobby does not control game mechanics. Games expose a lifecycle (Loading, Ready, Active, Paused, Terminating, Finished) and hand a summary (prose plus JSON highlights) back at the end.
- **D-025 · 2026-10-12 · Klaus** — A game manifest declares capabilities and constraints (player counts as range or list, AI support, settings). Games requiring more players than seated humans and without AI cannot be selected.
- **D-026 · 2026-10-12 · Klaus** — Invite tokens are at most 8 characters, upper-case letters and digits, easy to read out loud.
- **D-027 · 2026-10-12 · Klaus** — AI-only games are driven through a board remote-control API, so a local AI agent (e.g. a Claude session) can run tests and simulations.
- **D-028 · 2026-10-12 · Klaus** — AI players may need host-side configuration (LLM API key, model, cost limit), declared in the manifest, kept only on the table and never sent to the service. The configuration screens come in a later phase.
- **D-029 · 2026-10-12 · Klaus** — Table PC components run in Docker; the service runs on the Kubernetes cluster maintained with `klaushofrichter/kube-setup`. Code lives in the private repo `klaushofrichter/games-service`; other games in their own repos.
- **D-030 · 2026-10-12 · Klaus** — Automated testing of the lobby from the start of phase 1a.

## Implementation (phase 1a, 12 Oct 2026)

- **D-031 · 2026-10-12 · Claude** — TypeScript end to end, run natively by Node 22.18+ (type stripping, no build step). *Why:* one language for host, SDK, games and cloud; simpler containers.
- **D-032 · 2026-10-12 · Claude** — Rules are pure functions; all randomness comes from a seeded RNG in the game context, and the host logs every input (intents, timer firings, seat changes). `replay()` rebuilds a game and the tests compare state hashes. *Why:* D-008 and D-022 need exact replay.
- **D-033 · 2026-10-12 · Claude** — Join codes and invite codes use a 32-character alphabet without 0/O and 1/I. Join codes are single-use and rotate every 5 minutes. *Superseded by D-066.*
- **D-034 · 2026-10-12 · Claude** — The board page is served only to loopback clients and receives the table key there; everything else needs `X-Table-Key`. *Why:* decks on the LAN must not be able to drive the board API.
- **D-035 · 2026-10-12 · Claude** — Phase 1a runs game rules in-process. The isolated sandbox is deferred until third-party games (D-016).
- **D-036 · 2026-10-12 · Claude** — The cloud skeleton stores state in memory (single replica) and tables authenticate with an issued bearer token. PostgreSQL and key-pair authentication come before production.
- **D-037 · 2026-10-12 · Claude** — Seat numbering: South edge first, then North, then East, then West; numbered left to right as seen from that edge.

## Phase 1b and demo games (12 Oct 2026)

- **D-038 · 2026-10-12 · Claude** — Games ship their own UI: `board.js` and `deck.js` exporting `mount(root, ctx) → { update(view, events, info), destroy() }`, plus optional CSS and `assets/`. The host serves only those files, never `rules.ts` or the manifest. A shared board kit (`/shared/board-kit.js`) provides seat positions, seat plates, rotation and countdowns. *Why:* D-011, games own the board; the platform owns seats and the lobby button.
- **D-039 · 2026-10-12 · Claude** — During a game the platform hides its own seat boxes; games draw players with the kit's seat plates (or their own). *Why:* the game owns the whole surface (D-011).
- **D-040 · 2026-10-12 · Claude** — The host sends timer deadlines and its own clock with every game message, so boards and decks show countdowns without trusting device clocks. Rules stay time-free.
- **D-041 · 2026-10-12 · Claude** — Seats carry their board edge into the game, so games can orient a player's area (Pachisi gives each player the side of the board they sit at).
- **D-042 · 2026-10-12 · Claude** — AI options are per seat, defaulting to the manifest; simulations accept one option set for all seats or one per seat, to compare play styles in training data. The configuration screens stay deferred (D-028).
- **D-043 · 2026-10-12 · Claude** — Every AI player gets one pending move after any change to the game (intent, timer, join, leave), replaced on each change; a rejected AI move is retried once. In simulations a rejected AI move counts as no move. *Why:* review found AI players stalling after timers.
- **D-044 · 2026-10-12 · Claude** — Roulette: European single zero; straight, red/black, odd/even, low/high, dozens and columns (no split/corner bets yet); everyone bets at once in a timed window, "Done" closes it early; 1–6 players on North/South edges only, so no 90° rotation; decks reveal the result only after the board's wheel stops. Three AI styles: conservative, aggressive, erratic.
- **D-045 · 2026-10-12 · Claude** — Pachisi (a Ludo-style race): 40-cell track on an 11 × 11 grid, 4-cell home columns, a 6 leaves the base and earns another roll, three sixes lose the turn, landing on opponents sends all of them home except on the four safe start squares, exact count to finish, first player home wins. 2–4 players, 1–4 tokens each. A turn timer rolls and moves automatically. AI levels: beginner (random) and average (heuristic; wins ~75% head-to-head).
- **D-046 · 2026-10-12 · Claude** — Hold'em: fixed limit (bet size doubles on turn and river, four bets per street), 2–6 players, blinds of half/one small bet, heads-up dealer posts the small blind. A short all-in under half a bet is treated as a call and does not reopen betting. Side pots per contribution level; odd chips to the first winner left of the dealer. Hole cards exist only in their owner's view until showdown. AI styles: tight and loose. The cards library (deck, seeded shuffle, hand evaluation) lives in the SDK for future card games.
- **D-047 · 2026-10-12 · Claude** — Testing has four layers: rules tests per game with virtual time, host integration tests with fake decks, a Playwright browser script per game (`scripts/e2e/play.py`) that fails on any console error, and an AI-only soak run (`scripts/soak.ts`) that checks completion, exact replay and point conservation.
- **D-048 · 2026-10-12 · Claude** — CI publishes container images to GitHub Container Registry on pushes to `main`, so the Kubernetes deployment can pull them. *Superseded by D-069.*

## Phase 1 gaps and table PC kit (12 Oct 2026)

- **D-049 · 2026-10-12 · Claude** — When the service connection drops during a game, the host pauses it: timers freeze with their remaining time and intents are refused. The board offers *Continue* (once the service is back), *Save and exit* (games with `saveGame: true` in the manifest) and *End game*. A save is the game's replayable input log, so resuming means replaying it. *Why:* D-015.
- **D-050 · 2026-10-12 · Claude** — Game settings and AI player options are edited in dialogs on the board, generated from the manifest's settings and `aiOptions` declarations. Host-side AI configuration (API keys) stays out of these screens and out of the service (D-028).
- **D-051 · 2026-10-12 · Claude** — The admin portal is one static page served by the cloud at `/admin`. It signs in with the admin token (held in the browser tab's session storage only) and covers metrics, table approval and revocation, log downloads, download tokens and retention. *Sign-in superseded by D-067.*
- **D-052 · 2026-10-12 · Claude** — Table PC kit: Debian 12 recommended, the Table Host in Docker with host networking, and a kiosk service (`cage` + Chromium) that opens the board at boot. Test games are hidden unless `SHOW_TEST_GAMES=1`.

## Phase 1c: remote play (12 Oct 2026)

- **D-053 · 2026-10-12 · Claude** — An invite is created on the board (*Invite…* in the lobby and the in-game lobby overlay). The table asks the service for it; the board shows the link, the 8-character code and a QR code. An invite is single-use: the first browser that connects through it claims it at that moment, from then on only that browser's session can reconnect, and the table seats one player per session. Invites expire after their time-to-live.
- **D-054 · 2026-10-12 · Claude** — Signaling runs over two WebSockets on the service: `/api/tables/ws` (the table, authenticated with its table token) and `/api/remote/ws` (the remote browser, authenticated by invite or session). The service only relays one offer and one answer per connection (non-trickle ICE); it never sees game traffic. ICE servers come from the service's `ICE_SERVERS` setting (default: Google STUN; add TURN for players behind strict NATs).
- **D-055 · 2026-10-12 · Claude** — The table answers with werift, a pure-JavaScript WebRTC stack, so the host image stays native-dependency free. One reliable data channel carries everything: HTTP-style requests for the board and deck files and the board API, and virtual WebSockets for the live board and deck connections. On the table these enter the normal request and socket handlers, so remote players get exactly the board and deck local players get. *Why:* D-020 (table is the only game server, P2P).
- **D-056 · 2026-10-12 · Claude** — In the remote browser, the invite page (`/i/CODE`) holds the WebRTC connection and a service worker routes the board's and deck's requests to it. The board fills the window and the remote player's private deck sits beside it (below it on phones) and can be hidden. *Why:* D-021, the deck is a full page, not a special embed; games need no changes for remote play.
- **D-057 · 2026-10-12 · Claude** — What remote players may do on the board is an allowlist: change the seat layout, and select, start, end and close games. Turning the table's board, seating, removing players, AI seats and options, saves, resuming, simulations, logs, invites, the remote settings and the local join code stay with the people at the table (remote players never see the join code). *Why:* an independent review found that a deny list let a remote guest remove every local player. The table can switch off board control for remote players (*Remote players can use the board controls* in the invite dialog); they then see the board read-only. A game can also forbid it in its manifest. At most `MAX_REMOTE_PLAYERS` (default 4) remote players (D-006).
- **D-058 · 2026-10-12 · Claude** — werift waits up to 5 s for its STUN probe, which adds that much to connection setup when STUN is unreachable. Behind the ingress the service takes client addresses from `X-Forwarded-For` (`TRUST_PROXY=1`) so rate limits are per client.
- **D-059 · 2026-10-12 · Claude** — A remote player's board turns so their own seat is at the bottom of their screen (a quarter turn for east and west seats), and games get that seat's edge as `frontEdge` and `rotation`, so their text faces the remote player. This changes only the remote copy; the table's own orientation and rotate buttons belong to the people at the table, so remote boards don't show them. Until the remote player has a seat, their board follows the table.

## Test round 4 (12 Oct 2026)

- **D-060 · 2026-10-12 · Claude** — A game package's folder name must equal its manifest id, and `players.min` may not exceed `players.max`. *Why:* new tests found that two folders could claim one id (the first listed on disk won) and that an unplayable player range was accepted.
- **D-061 · 2026-10-12 · Claude** — Retention covers saved games as well as logs. The table prunes at start, once a day, and immediately when the service shortens the period. *Why:* saves were never pruned, and a running table kept old logs until its next restart.
- **D-062 · 2026-10-12 · Claude** — The service treats a missing, non-numeric or non-positive invite or download-token lifetime as the default (2 hours, 24 hours), and a log id belongs to the table that first uploaded it. *Why:* nonsense lifetimes crashed invite creation or made tokens never expire, and one table could overwrite another's log.
- **D-063 · 2026-10-12 · Claude** — The table pings each remote player over the data channel every 5 s and drops the connection after 20 s of silence; the remote page reconnects after 25 s without a ping. *Why:* a browser that vanishes without closing (lid shut, network lost) otherwise stayed "connected" forever.

## Test round 5 (12 Oct 2026)

- **D-064 · 2026-10-12 · Claude** — AI-only simulations hand the table's thread back every ~15 ms. *Why:* a 1,000-game Hold'em simulation froze the board, decks, game timers and liveness pings for about 14 s; now the longest pause is under 0.5 s (packing the log zip at the end).
- **D-065 · 2026-10-12 · Claude** — Deck UIs must work from a 320 × 568 phone up, checked in a real browser by `scripts/e2e/layout.py`: no sideways scrolling, nothing sticking out of its panel, buttons at least 40 px high, and on your turn an action button on screen without scrolling. Hold'em's community cards now shrink with the screen, its hole cards scale with the screen height, and its action bar stays pinned to the bottom. *Why:* on small phones the five cards overflowed and Fold/Call/Raise sat below the fold.

## Join code (12 Oct 2026)

- **D-066 · 2026-10-12 · Klaus** — One join code and QR code for all players at the table, replacing the single-use, rotating codes of D-033. The code is new at every start of the Table Host (the table PC is powered down often) and otherwise changes only when someone taps *New code* on the board; the old code stops working at once, players already in stay in. No expiry. Remote players still need their own single-use invite.

## Cluster conventions (13 Oct 2026)

Klaus asked for the repo to follow kube-setup's conventions (its Obsidian vault and `docs/repository-baseline.md`, `docs/cluster-deployment-requirements.md`). These decisions apply them; where a choice was needed, it is marked Claude.

- **D-067 · 2026-10-13 · Klaus** — Administrators sign in with Google, using the service's own OAuth client in project `skylar-technology` and an `ALLOWED_EMAILS` allow-list; the redirect URI is `https://games.skylar.technology/auth/google/callback`. *Implementation (Claude):* the cluster's OAuth pattern (state cookie, ID token verified against the client ID, HMAC-signed session cookie with `COOKIE_SECRET`, 7 days); the allow-list is checked on every request, not only at sign-in, so removing an address takes effect at once; logout lands on a 200 page with a Sign in link, never a bounce through Google; cookie-authenticated changes must carry our own `Origin`. `ADMIN_TOKEN` stays as an optional bearer token for scripts; an https `PUBLIC_URL` refuses to start without Google sign-in. Supersedes the token sign-in of D-051.
- **D-068 · 2026-10-13 · Claude** — Node 26 everywhere (Dockerfiles, workflows, `@types/node`), matching the cluster's current runtime major; images end with a numeric `USER 1000:1000`. The first audit found a critical and two high advisories, fixed by vitest 3 → 5 and werift 0.22 → 0.25 (remote play re-verified in a browser).
- **D-069 · 2026-10-13 · Claude** — The cluster's three workflows: `production-checks.yml` (PR checks `test`, `e2e`, `codeql`), `build-push.yml` (`:main` only), `deploy-production.yml` (push to `production`, in-cluster runner). `main` is built but never deployed. Each image tag has one writer. Supersedes D-048.
- **D-070 · 2026-10-13 · Claude** — Versions are calendar versions `YYYY.MM.DD.N` (America/Chicago) generated at deploy time from the release tags; nothing in the sources carries a version (the `package.json` version is gone). Tags carry `v`, `/health` reports the bare value; any build outside the deploy reports `dev` (or `main`).
- **D-071 · 2026-10-13 · Claude** — The cloud service runs on the cluster as a plain Deployment with its own Ingress (like cams-admin), not a Knative Service, because Knative's DomainMapping breaks the tables' long-lived WebSockets. One replica, `Recreate`, while state is in memory (D-036 still applies). Requested from the kube-setup session in `docs/kube-setup-request.md`, which replaces the ingress-nginx hand-off.
- **D-072 · 2026-10-13 · Claude** — The table-host image is released with the cloud image, by the same deploy and with the same version; table PCs keep pulling `:latest`.
- **D-073 · 2026-10-13 · Claude** — The e2e suite is the existing Python Playwright checks, run by `scripts/e2e/run-all.sh` in the required `e2e` job on GitHub's runners. CodeQL scans JavaScript/TypeScript, Python and the workflows, and fails on any finding not listed in `.github/codeql-accepted.tsv`.
- **D-074 · 2026-10-13 · Claude** — Secrets go from the repo's local, git-ignored `.env` to GitHub and the cluster only through `scripts/sync-secrets.sh`, which never prints a value and rejects inline comments, quoted values and a redirect URI that does not match `PUBLIC_URL`.
- **D-075 · 2026-10-13 · Claude** — CodeQL's `js/clear-text-storage-of-sensitive-data` on the `Set-Cookie` lines of `apps/cloud/src/auth.ts` is accepted in `.github/codeql-accepted.tsv`: putting the signed admin session and the OAuth state into HttpOnly, Secure, SameSite=Lax, `__Host-` cookies is the sign-in design, not a leak. Hardening from a review before the first deploy: a request target that is not a URL answers 400 (it used to exit the process), badly encoded foreign cookies are ignored, table hellos are rate limited and waiting tables capped, the deploy publishes `:v<version>` and `:latest` only after the smoke test, and `MAX_REPLICAS=1` is passed by the manifest and checked at startup.
- **D-076 · 2026-10-13 · Klaus** — The console's top bar shows the Game Table icon (also the favicon), "Game Table Console" linked to the GitHub repository, and the running version. *Implementation (Claude), following steps-service:* the version is shown bare (never `v`-prefixed), once, filled in by the server; a release version links to its GitHub release, `main` to the main branch's history. The public page carries the same version label, which the deploy's smoke test now checks. HEAD is answered like GET (the cluster's uptime monitor sends only HEAD), and an invalid `TRUST_PROXY` entry stops the service with a clear message instead of crashing on first use.
- **D-077 · 2026-10-13 · Claude** — Dependabot's three first PRs (TypeScript 5.9 → 7, zod 3 → 4, Playwright 1.56 → 1.63 for the e2e scripts) are taken together on current main. TypeScript 7 (the native compiler) type-checks the project in under a second and still fails on a planted error. Zod 4 parses every game manifest and eight edge cases (partial AI block, missing optionals, unknown keys, each refine failure, empty layouts) to exactly the same result as zod 3, compared side by side.
- **D-078 · 2026-10-13 · Klaus** — Game first: a game can be chosen at any time, also before anyone has joined, and the table adapts to it; the lobby also says in plain words what each game still needs ("needs 2 more players"). *Implementation (Claude):* choosing is refused only by real blockers (a running game, an offline table that requires the service, more players seated than the game takes, AI seats in a game without AI, a front edge the game cannot face). Choosing switches to the current layout if the game supports it, else to the smallest supported layout with room for the game's maximum player count, and moves anyone on an edge the game does not use. While a game is chosen, the seat buttons offer only its layouts, a full game seats no newcomers and refuses more AI players, and Start waits for the player count, a player at the table and everyone's Ready. With no game chosen, the seat buttons offer only layouts some visible game supports (8 seats disappear while only the test games use it).

## Table layout and board controls (13 Oct 2026)

- **D-079 · 2026-10-13 · Klaus** — Six seats are two on each long side plus one at each end (east and west), the usual six-seat table; Hold'em takes up to 8 players (layouts 2, 4, 6, 8, no rule changes, soak-tested at 7 and 8); Coin Flip is no longer a test game, so the lobby shows four games. *Implementation (Claude):* a manifest's `edges` now means only the edges its seats may sit on. It used to double as "edges the table may face", which blocked every game while facing east or west, yet no game reads the front edge: only the lobby, the centre panel and dialogs turn. That blocker in D-078 is gone.
- **D-080 · 2026-10-13 · Klaus** — Four small corner buttons turn the board's lobby to a side: upper left north, upper right east, lower right south, lower left west (`POST /face {edge}`). They replace the 90° and 180° buttons; the in-game Lobby overlay has the same four choices. They are hidden on remote boards and while a game is running (shown while paused). The game tiles page three at a time, with ‹ › and dots. The board and decks have their own favicon (two fanned cards), distinct from the console's die. `POST /rotate` stays in the API. Facing east or west, the centre panel is 620 × 900 (was 760 × 760, which left 10 px to the north and south seat plates) with the QR code beside the join text; `layout.py` checks at least 20 px to every plate.
- **D-081 · 2026-10-13 · Klaus** — AI players get a random short name from a fixed list of 24 (12 female, 12 male), shown as "Mia (AI)", never a name someone at the table already has; remove and re-add for another. *Why:* "AI 1", "AI 2" were numbered by count, so removing AI 1 and adding one gave a second "AI 2". Simulations keep numbered names.
- **D-082 · 2026-10-13 · Klaus** — The admin console uses the full window width.
- **D-083 · 2026-10-13 · Klaus** — A new download-token link in the console has a copy button beside it; it shows a check mark once copied and, if the browser refuses the clipboard, selects the link instead. `admin.py` checks that the clipboard holds exactly the shown link.
- **D-084 · 2026-10-13 · Klaus** — Four seats are one on each side (south, west, north, east, clockwise), not two south and two north. Pachisi and Quartet now allow east and west seats too: Pachisi gives each player the side of the board they sit at, and no shipped game limits its edges any more. Moving players off edges a game does not use stays, for games that do; its test uses a copy of Quartet limited to north and south. Checked on the board with four players in Pachisi, Hold'em and Roulette.
- **D-085 · 2026-10-13 · Klaus** — A disconnected table can be reconnected from the console: a Reconnect button replaces Disconnect on its row and approves the same table again, with no new pairing code; it gets a new token at its next hello (a disconnected table now asks every 10 s, was 30 s). Only a disconnected table can be reconnected (409 otherwise). The board's message says an admin can reconnect it.
- **D-086 · 2026-10-13 · Klaus** — End-of-game texts read naturally: "Klaus wins with one correct guess." The game SDK has `count(n, singular, plural?)` (small numbers in words, noun matching the number) and `list(names)` ("Ann, Bob and Cleo"); Coin Flip, Hold'em and Roulette use them ("after one hand", "Nobody guessed right."). In the lobby the seat layout stays on the left and player management on the right (+ AI player, Invite, Simulation); a selected player's Configure and Remove sit on their own row below, also on the right.
- **D-087 · 2026-10-13 · Klaus** — Players never see seat numbers: seats have compass names. One seat on an edge is that edge ("North"); two are its halves ("Southwest", "Southeast"); three add the plain edge in the middle. The names are unique in every layout and used on the board's seat plates, the board's player list and the deck ("Southwest seat", badge "SW"). Names already carry "(AI)", so lists no longer add "· AI". Seat numbers stay in the API.

## Board settings (13 Oct 2026)

- **D-088 · 2026-10-13 · Klaus** — The board has a settings button, a gear beside the corner at the left end of the edge the board faces, turned to that edge (in a game it moves to the other end if the game's Lobby button is in that corner). It opens a modal facing the front edge, in the lobby and during games: Fullscreen first, then whatever the chosen game adds. Settings are only on the table's own board, not on remote boards, and `POST /game/prefs` is not on the remote allow-list. *Implementation (Claude):* a game adds settings by exporting `settings({ info, setPrefs })` from its board.js (items: toggle, choice, swatches, button). `setPrefs` stores display choices per game on the table, in memory, and sends them to the board and every deck as `info.prefs`; they are not part of the rules, the game log or replay. Pachisi is the first user: each player's colour, and picking a colour another player has swaps the two. `playerColor(info, seat)` in the board kit applies the choice on the board, the seat plates and the decks.

## Coin Flip and the end of a game (13 Oct 2026)

- **D-089 · 2026-10-13 · Klaus** — AI players show Ready on the board like everyone else: on their seat plate and in the ready list. The phone shows the current status ("You are ready" / "You are not ready yet") apart from the button, which says what it switches to ("Switch to not ready" / "Switch to ready"). The yellow ◆ before AI names is gone, since names carry "(AI)".
- **D-090 · 2026-10-13 · Klaus** — The chosen game's own settings are in the board's settings modal: changeable with − / + (the board has no keyboard) until the game starts, shown read-only during it. `POST /game/settings` changes only the keys given and keeps everyone's Ready. Manifest settings may have a `step`. Coin Flip's time limit is now "Seconds to guess (0 = no limit)" (`roundSeconds`, step 5; old logs with `roundMs` still replay).
- **D-091 · 2026-10-13 · Klaus** — Coin Flip shows "Round 2 of 3" on the board, everyone's pick while the coin is in the air (✓/✗ once it lands), a countdown with a draining bar on the board and the phones when there is a time limit, and per-player statistics at the end (correct guesses, heads %). Version 0.2.0. For every game: when a game ends by itself, the board keeps its last screen with a **Show result** button in the Lobby button's corner; a game ended from the lobby goes straight to the result. A game's summary may carry a `table` (columns and rows), which the result screen and the phones show.
- **D-092 · 2026-10-13 · Klaus** — Sound effects, switched on and off in the board's settings (on by default). It is a table-wide display choice (`POST /display {sound}`, in the state as `display.sound`) that every board follows, including remote players' boards, which have no settings of their own and cannot change it. Sounds are synthesised with Web Audio (no files): the board kit has `playSound(info, name, make)` and `ping()` for struck-metal tones; the board wakes audio on the first touch, the table PC's kiosk browser allows it from the start, and the remote page's board frame now allows autoplay. Coin Flip plays a ringing whirr while the coin is in the air and a clink with two bounces when it lands. *Found on the way:* the step that ended a game never delivered its events, so every game lost its final animation (the last coin flip, the winning move). The runtime now passes them on with the game-over.
- **D-093 · 2026-10-13 · Klaus** — The phone shows the seat once: a compass badge ("SW") right-aligned on the line with the player's name, and the "At the table" list says where everyone sits. The separate seat card is gone; a player without a seat sees "No seat yet". Sound effects are confirmed as a board setting: games read `info.sound` and cannot change it (their `setPrefs` writes only their own per-game values). New tests: Coin Flip never shows a pick before the flip (checked to fail if it did), missed picks, statistics adding up, old 0.1 settings, sound vs. game prefs, a remote board following the sound setting, and a browser scenario for the phone header, a full table, a game with sound off, and a game ended from the lobby (no held screen).
## Copy buttons and the remote deck window (14 Oct 2026)

- **D-094 · 2026-10-14 · Klaus** — The board's join link (under the QR code) and the remote-player invite link each have a copy button that shows a check mark once copied. The board kit's `copyText()` uses the clipboard API, with the older copy command as a fallback outside a secure context (the board itself is only served on localhost, so it always has the API). Browser checks confirm the clipboard holds exactly the shown link in both places.
- **D-095 · 2026-10-14 · Klaus** — On the remote player's page the deck window sits top right (16 px margin) and takes the height of its content, up to the window, so it shows a scrollbar only when the content really doesn't fit; it re-measures as the deck changes. Phones keep the bottom sheet. Scrollbars on the board, decks and the remote page are felt green (dark colour scheme), not white. The remote-play browser check measures both cases: room to spare (no scrollbar) and a short window (fills it and scrolls).

## Public repository and extra-game repositories (14 Oct 2026)

- **D-096 · 2026-10-14 · Klaus** — games-service is public (since 13 Oct 2026; its ghcr packages `games-cloud` and `games-table-host` too). Supersedes "private repo" in D-029; the README badges now render.
- **D-097 · 2026-10-14 · Klaus** — Games can live in other repositories, private ones included (first: `klaushofrichter/extra-games`), for private games and early releases. The console keeps the list of repositories; each repository's games are one bundle; an administrator ticks repositories per table, when approving its pairing code or later on its row. Remote players of such a table see those games too. *Implementation (Claude):*
  - **Service.** A repository is `owner/name@ref`; the service downloads its GitHub tarball (private ones with `GAME_REPO_TOKEN`, a fine-grained token with Contents: read), keeps only `games/`, checks every path (plain names, no `..`, no hidden files, at most 6 deep), every manifest (valid, id = folder name, rules present) and the sizes (5 MB a file, 20 MB a bundle, 500 files; 100 MB for the download), and packs it as gzipped JSON whose SHA-256 is the bundle's identity. It refetches hourly and on *Refresh*; a failed fetch keeps the last good bundle and shows why. `GAME_REPOS` lists repositories from the start. Game ids that two repositories share are flagged.
  - **Tables.** Every approved hello and heartbeat carries the table's bundles (repository, commit, hash, games). The table downloads a missing bundle from `/api/tables/bundles/<hash>` with its own token (the service serves only bundles of that table's repositories), checks the hash again, refuses unsafe paths and gzip bombs, unpacks next to the final folder and renames it into `<DATA_DIR>/extra-games/<hash>/`, and loads the games. Changes wait while a game runs and apply when it ends; an updated game stays chosen if its settings still fit. A built-in game always wins over an extra game with its id. Bundles no longer listed are deleted. At start the table offers what it installed last time, before the service answers. A disconnected table drops its extra games; reconnecting brings back the ticks.
  - **Games.** Extra games import the SDK by name, `@game-table/sdk` (and `/cards`); a module resolve hook in the host maps the name to its own SDK, so a game repository carries no copy. A game log names the exact code it ran (`gameSource`: repository, commit, bundle hash). The board marks extra games' tiles.
  - **Trust.** Extra games run in-process like built-in ones (D-035): ticking a repository for a table trusts its code on that table PC, and anyone with that PC can read it. "Private" means which tables get it, not secret code. The sandbox for untrusted games is still deferred (D-016).
  - **Limits.** The repository list and the ticks are in memory with the rest of the service's state (D-036): a deploy forgets them (pairings too); `GAME_REPOS` restores the list.
  - **Checks.** `tests/extra-games.test.ts` (bundles, tar reading, the console API, tables installing, updating, deferring and dropping games, a malicious or corrupted bundle, broken rules, size limits, concurrency) and `scripts/e2e/extra.py` (a fake GitHub serving a private repository; the console adds it and ticks it at approval; the board shows the game; a remote player chooses and plays it with a local phone; unticking and removing take it away).
- **D-098 · 2026-10-14 · Klaus** — The repository list survives restarts: for now it is set at deploy time, later it moves to a PVC. *Implementation (Claude):* `deploy/game-repos.json` (`{ "repos": [{ "repo": "owner/name", "ref": "branch" }] }`) is baked into the cloud image, so changing the list takes a PR and a deploy, like any other change; it starts with `klaushofrichter/extra-games@production`. The service lists those repositories at every start, marked *deploy config* in the console, where they can be ticked and refreshed but not removed (the next restart would bring them back; the API answers 409). Repositories added in the console are marked *until restart*. `GAME_REPOS` still adds repositories (local development); it is no longer synced to the cluster, and `sync-secrets.sh` rejects it in `.env`. A malformed file, or a `GAME_REPOS_FILE` that can't be read, stops the service at start with the reason, so a broken list fails the deploy's smoke test rather than starting short. The per-table ticks are still in memory, like pairings, which a restart forgets anyway. **Next:** the persistent store already planned for pairings (D-036, D-071: SQLite on a PVC, replicated to S3 with Litestream, as cams-admin does) takes the repository list and the ticks too, and the deploy-time file then only seeds an empty store. It is a separate request to kube-setup.
- **D-099 · 2026-10-14 · Klaus** — Every game provides rules for players, readable on the phones in a modal, with images and not only text. *Implementation (Claude):* the game API is a file: `how-to-play.md` in the game's folder, with images and diagrams in its `assets/` folder (SVG, PNG, JPEG, WebP, GIF), so built-in and extra games (D-097) provide rules the same way, and rules travel in the same bundle. The host serves `how-to-play.md` and assets with `nosniff` and a content security policy that keeps an SVG from running script; nothing else in the folder is served. `GET /games` and the lobby state carry `howToPlay` (the URL or `null`), and the lobby state also has `settingsShown` (the chosen settings with their manifest labels). Every phone, local or remote, shows a **Rules** button beside the player's name while a game is chosen or running; it opens a sheet with *At this table* (the settings) and the rules, closed by ✕, Close, the backdrop or Escape. The renderer (`/shared/markdown.js`, also run by the tests) escapes everything and turns only a small Markdown subset into markup: headings, paragraphs, one-level lists, bold, italic, code, a tip, a rule, simple tables, `https` links in a new tab, and images from the game's own `assets/`; anything else stays visible as text. All five built-in games ship rules written from their code (roulette, pachisi and hold'em with SVG illustrations), and the browser check opens each on a 320 × 568 phone and checks its images load, nothing is wider than the screen, and every way of closing works. Coin Flip's description no longer calls it a stub game (D-079).
- **D-100 · 2026-10-14 · Klaus** — Every game's rules start with short instructions. *Implementation (Claude):* after the one-sentence goal, an `## In short` section of two to five bullets (at most about 90 words) says how a turn works and how to win; the full rules follow. All six games have one (Liar's Dice in extra-games too), and the tests in both repositories require it.

## Board orientation and player colours (14 Oct 2026)

- **D-101 · 2026-10-14 · Klaus** — A game on the table's board faces north or south only, so it uses the long sides of the screen; a **turn-around** button left of the gear turns it 180°, and the seat plates stay where they are. A remote player on an east or west seat may show the board upright, using the full width with their seat at the side; there is no upside-down view for remote players. The seat plates sit the same distance from the board's edge on all four sides. The phone's seat badge shows the player's colour, with readable letters. *Implementation (Claude):*
  - **Facing.** The lobby still turns to any edge with the corner buttons (`POST /face`). A game takes the last north or south facing: turning the lobby east or west keeps the game where it was, and a game started from an east-facing lobby faces south unless the table faced north before. The turn-around button shows only during a game on the table's own board (not remote boards) and toggles `POST /face` between north and south. Games get the facing as `info.frontEdge`/`info.rotation` as before, which is now always 0 or 180 on the table; menus and dialogs still face the lobby's edge.
  - **Remote side seats.** *Use the full width* / *Put my seat at the bottom* in the corner of the remote board frame, remembered in the browser per invite. It changes only that player's view (the table's facing is untouched). Games then see `info.frontEdge` "south".
  - **Margins.** The wooden frame was a 10 px border inside the 1920 × 1080 surface, so with `box-sizing: border-box` everything positioned from the edges started inside it: the north plates measured 42 px from the board's outer edge and the south plates 22 px. The frame is now an inset shadow and every edge offset includes it: 32 px from the outer edge on all four sides, at every screen size (checked by `scripts/e2e/layout.py`).
  - **Deck colour.** The badge with the seat initials is filled with `playerColor` (the game's colour choice, e.g. Pachisi's, else the seat's), the same colour as the frame of the player's plate on the board. The letters are near-black or white, whichever has more WCAG contrast; every seat colour gets at least 6:1 (`tests/player-color.test.ts`).

## Pachisi on the board, AI players and colours in the lobby (14 Oct 2026)

- **D-102 · 2026-10-14 · Klaus** — Pachisi gets sound effects (rolling the die, moving a token, a six, a token sent back), a **Pieces** setting (numbers by default, or icons: a smiley, a five-pointed star, a bullseye and a moon, the same set for every player, in the player's colour, on the board and the phones), and tokens can be moved by tapping them on the board, as at a real table. Only tokens that may move answer, and only for players at the table; rolling stays on the phone. A remote player moves their own tokens on their phone or on their copy of the board. *Implementation (Claude):*
  - **Platform.** A manifest's `boardIntents` (default none) names the intents a board may send. The board socket takes `game.intent { playerId, name, payload }` and answers ack or reject like a phone's. `Table.boardIntent` refuses names not listed (403), players other than humans at the table when sent from the table's board (403), and on a remote board anyone but the player who joined through that remote session (403), then hands the intent to the game, which applies its own rules; the log records `by: "board"`. Games get `ctx.act(seat, name, payload)` and `info.controlSeats`. Every phone sees the result in the next view, so a tap on the board and a tap on the phone are the same move.
  - **Pachisi.** `"boardIntents": ["move"]` (version 1.1.0). Tokens that can move and belong to a seat in `info.controlSeats` answer a tap: the nearest such token within about a finger's width of the touch is moved, so a token under someone else's in a shared cell, or one bobbing away from the finger, still answers (a browser-check run caught that). A tap sends `move` once; more taps wait for the answer. The hint reads "tap a token to move it" when the board can move for the player whose turn it is. The sounds are made with Web Audio in `board.js` (no files): a rattle of filtered noise knocks for the 0.6 s roll, a rising four-note chime after a 6 lands, one soft step per cell moved, and a falling slide with a bump for a capture; they follow the table's sound setting (D-092). The icons are inline SVG drawn in the same dark ink as the numbers; `deck.js` imports them from `board.js`, so both always match. In the settings modal the chosen option of a choice now has dark text on brass (it was brass on brass, so unreadable).
  - **Checks.** `tests/board-intents.test.ts` (who may move from which board, only listed intents, game rules still apply, a paused game, a game without board intents, the manifest field); `play.py pachisi` switches to icons and checks them on the board and both phones, makes every other move by tapping the board, checks that only that player's movable tokens answer and that board and phone offer the same tokens, and that the roll, move, six and capture sounds play; `remote.py` has Rita tap on her board and Ana on the table's, and checks neither board offers the other's tokens.
- **D-103 · 2026-10-14 · Klaus** — An AI player can be removed from its own window (*Configure*): a **Remove** button, after a confirmation. *Implementation (Claude):* the AI window also opens before a game is chosen (it then has no options to set, only Remove and Done). `play.py dialogs` cancels once and then removes, with and without a game chosen. The toolbar's Remove for the selected player stays.
- **D-104 · 2026-10-14 · Klaus** — The phones' *At the table* list shows a dot in each player's colour before their name. *Implementation (Claude):* the colour is `playerColor` (the game's choice, e.g. Pachisi's, else the seat's), so it matches the player's plate on the board and their seat badge (D-101); a player without a seat gets a hollow ring. `play.py dialogs` compares the dots with the seat colours.
## Scrollbars on the service's pages (15 Oct 2026)

- **D-105 · 2026-10-15 · Klaus** — Scrollbars everywhere fit the green felt; the console's *Game logs* box had a white one. *Implementation (Claude):* the table's pages (board, phones, terms) already had felt scrollbars from `theme.css`; the cloud's pages did not. The console (`admin.html`) now sets `color-scheme: dark` and `scrollbar-color` with a green thumb (#2f6457) on a track the colour of what it scrolls over, the page or a panel, plus `::-webkit-scrollbar` rules for browsers without `scrollbar-color`. The invite page got the same `::-webkit-` rules, and the sign-in and landing pages `color-scheme: dark` and `scrollbar-color`. `scripts/e2e/admin.py` fills the Game logs box until it scrolls and checks its colours.

## Player colours, Pachisi seating and the terms (15 Oct 2026)

- **D-106 · 2026-10-15 · Klaus** — Player colours are a setting of the board, not of a game: chosen in the board's settings, used in the lobby and by every game, shown on the board as each player's card border and a dot before the name. Pachisi no longer has a colour setting of its own. *Implementation (Claude):* supersedes the colour part of D-088. The table keeps an optional chosen colour per player and gives every seated player an effective one, all distinct: choices first (in seat order), then the seat's colour (`PLAYER_COLORS[seat % 8]`, now in the protocol), else the first free one. It is in the lobby state as `player.color` (`null` without a seat), so the board, the phones and every game get it with the players; `playerColor(info, seat)` reads it and no longer looks at a game's `prefs.colors`. `POST /players/{id}/color {color}` takes a palette colour (400 otherwise, 409 without a seat); if another player has it, the two swap. A choice holds when the player moves seat and through games, can change during a game (display only, not in the log), and goes when the player leaves. Remote boards cannot change colours (403), like seating. The settings modal has a *Player colours* group whenever someone is seated, game or not. The lobby's seat cards and the board kit's seat plates (every game) show the colour as the border and a dot before the name. Checks: `tests/player-color.test.ts` (defaults, swapping, validation, seat moves, games, leaving), `tests/remote.test.ts`, `play.py dialogs` (in the lobby: cards, dots, a change reaching the phone) and `play.py pachisi` (in a game: swap, plates' borders and dots, Pachisi's own settings down to Pieces).
- **D-107 · 2026-10-15 · Klaus** — In Pachisi, two players always sit on opposite sides of the board, for balance: on neighbouring sides one player's start lies just ahead of the other's. *Implementation (Claude):* with two players, `assignSides` tries both opposite pairings (bottom/top, left/right) and who gets which end, and takes the one closest to where the two sit (by each edge's side preference); three or four players are unchanged. South and north keep bottom and top, west and east keep their own sides, south and west get right and left. Pachisi 1.2.0. A game saved under 1.1.0 with two players on neighbouring sides would replay with the new sides; there are no such saves yet. `tests/pachisi.test.ts` checks every pair of seats in the 4-, 6- and 8-seat layouts.
- **D-108 · 2026-10-15 · Klaus** — The terms of service open in a window with ✕ top right, like the rules, on the phones and on the board, local or remote; never in a new tab, whose "Back" link went nowhere. *Implementation (Claude):* the text is one file, `/shared/terms.md`, rendered with the rules renderer (`/shared/markdown.js`). The phone's footer link opens it in the rules sheet, now a general sheet (✕, Close, backdrop, Escape); the board's lobby window opens it in a board window facing the lobby's edge. `/deck/terms.html` stays for a direct link, rendered from the same file and without the "Back" link. Checks: `play.py rules` (a 320 px phone: the sheet, ✕ top right, no navigation), `play.py endings` (the table's board) and `remote.py` (remote board and phone, no new tab).
- **D-109 · 2026-10-15 · Klaus** — Pachisi's pieces show icons by default; numbers are the choice in *Pieces*. *Implementation (Claude):* icons unless the table's Pachisi prefs say `pieces: "numbers"` (D-102 had numbers as the default). `play.py pachisi` checks icons first, then Numbers and back.

## Several game repositories (15 Oct 2026)

- **D-110 · 2026-10-15 · Klaus** — Game Table must handle several independent extra-game repositories at once; the second is `klaushofrichter/loopy-game` (private, Loopy only). *Implementation (Claude):* no code change was needed; `tests/extra-games.test.ts` (*several independent repositories*) now checks it with two private repositories and three tables: each table gets exactly the repositories ticked for it, a table with both keeps both bundles side by side and plays from each, a table cannot download another table's bundle, and a new commit, a broken push, a repository that disappears from GitHub or one removed from the console touch only that repository's games. The one `GAME_REPO_TOKEN` must read every private repository on the list (a fine-grained token with Contents: read on each). Loopy goes on `deploy/game-repos.json` once it has its board and phone UI.


## Game-specific overrides (15 Oct 2026)

- **D-111 · 2026-10-15 · Klaus** — A game may override platform features (seat plates, player positions, turn handling and the like) with its own, as long as the game stays manageable and other games are not affected. Each game lists its overrides, with what the platform could offer instead, so the platform can be improved to meet games' needs. *Implementation (Claude):* Loopy keeps its list in its own repository; candidates for the platform so far: seat plates with game slots, teams, acknowledgement barriers, a presentation barrier for board animations, AI takeover by the host, an asynchronous AI hook, and optional state versions on intents.

## AI players that take their time (15 Oct 2026)

- **D-112 · 2026-10-15 · Klaus** — AI players may take their time (a deep search, a call to a language model) without blocking the table; this is a platform feature for every game. Each move has a time budget, 20 seconds by default, which a game sets for its needs. When it runs out, the game pauses and the board shows a button at the AI player's card to move now: the game's default move is played at once. If nobody taps it, the game stays paused while the AI keeps thinking, so the people at the table decide whether to wait. Remote players with board control see the button too. For language models, the model (e.g. Claude Haiku or Sonnet), the effort level and, where the API allows, a cost limit per game are chosen together with the API key on the table PC (D-028). The first version is AI moves only; other background jobs (precomputing, lookups) follow the same pattern when a game needs them. *Implementation (Claude):*
  - **SDK.** `ai(view, seat, ctx, options)` may return a promise. `ctx.signal` is aborted when the game moves on, pauses or ends; `ctx.deadline` is the time by which the table expects the move. `aiFallback(view, seat, ctx, options)` is the game's quick synchronous move. Manifest: `ai.timeoutSeconds` (1–600, default 20) and `ai.worker` (run the AI in a worker thread). Synchronous AIs behave and log as before; `runtime.aiIntent()` stays synchronous for callers that need an answer at once, and `aiDecide()` may return a promise.
  - **Host.** One move in the making per AI player, replaced on every change (D-043): a stale answer is dropped and its signal aborted. After 0.8 s the AI shows as thinking (`aiThinking` in the lobby state; `info.aiThinking` for games on the board and phones). At the deadline the game pauses with `pause.reason: "ai"` and the AI player named; the AI keeps thinking, other AI players stop and start again afterwards. `POST /game/play-now` (also for remote boards with board control) stops the AI and plays `aiFallback()`, or asks the AI again with a fresh budget if the game has none. An answer during the pause resumes the game by itself. Continue (`/game/resume`) does not apply to an AI pause. A lost service connection turns an AI pause into a connection pause; the AI starts again afterwards. A failing AI gets its fallback at once.
  - **Worker threads.** With `ai.worker`, each AI player gets a worker thread that loads the game's rules module (with the SDK import hook, D-097) and receives only the view, options, a seed from the player's AI random stream and the deadline. A stale or hung search is stopped by terminating the thread; the next move starts a fresh one. Threads end with the game.
  - **Log.** AI moves that answered later carry `ai: { ms, fallback?, worker?, error? }`, for analysis and training data (D-008); replay ignores it, so replays stay exact (D-032).
  - **Board and phones.** The AI pause keeps the game visible: a card at the AI's seat, facing the players, with the AI's name, "is still thinking", *Play now* and *End game* (remote boards: *Play now* only with board control). The phones show "Waiting for … who is still thinking".
  - **Simulations** await answers and play the fallback when an AI is out of time (nobody can tap); AIs with `ai.worker` get one thread per seat for the run.
  - **Checks.** `tests/async-ai.test.ts` with the Think Race test games in `tests/fixtures/async-games` (answers that come later, the thinking marker, the pause and *Play now*, an answer during the pause, stale answers dropped, a failing AI, a connection pause taking over, worker threads keeping the table responsive and a hung worker stopped, simulations with and without fallback, exact replays); `tests/remote.test.ts` (*Play now* follows the remote board-control switch); `scripts/e2e/ai_wait.py` (the card on the board and the banner on the phone, *Play now*, a late answer removing the card).
  - **Not yet:** the host-side configuration screens (API key, model, effort, cost limit) and a language-model agent; they come with the first game that uses one (a game's own language-model agent).

## Access codes and the persistent store (15 Oct 2026)

- **D-113 · 2026-10-15 · Klaus** — Tables can be pre-approved: the console creates access codes, and a board that uses one is approved at once, with no pairing code. Klaus accepts the weaker security. A code has a validity (one week, one month, one year, forever) and a scope of extra-game repositories (none, i.e. the built-in games; all, including repositories added later; or chosen ones by name). Codes can be listed, edited and revoked; an expired code stays listed until deleted or more than a year old; the list shows when a code was last used. A code serves one board at a time and can't be used by a second one. Validity is checked only when a board first uses the code; a board still connected past it is highlighted in the console for an admin to remove by hand. "All" means all repositories at the time; a board may need to reconnect for one added later. An admin can edit an existing code's scope. A board takes its code from an environment variable, a command-line option, or its settings screen. *Implementation (Claude):*
  - **Codes.** 8 characters from the 32-letter alphabet of D-033 (about 40 bits), shown as `ABCD-EFGH`, typed with or without the dash, any case. The console shows a code once, when it is created; the service keeps only a SHA-256 hash and the first two characters (the hint shown in lists and on the board). Month and year are calendar months and years (UTC). At most 1,000 codes.
  - **One board.** A code is bound to the first table that uses it, by the table's persistent identity (`tableId` in its `table.json`), so the same board reconnects as often as it likes and any other is refused (*in use*). **Release** in the console frees a code for a new board (say, a reinstalled PC with a new identity) and disconnects the table it was bound to, so a code never serves two boards.
  - **Hello.** A new or waiting table that presents a valid code is approved in the same request and gets its token. One that presents a bad code hears why (*unknown*, *expired*, *revoked*, *in use*) and waits with its pairing code as before, so manual approval still works. A disconnected table is never brought back by a code: only Reconnect does that. An approved table may present a code later (typed on its board); it is then linked to that code, and a code it had before is freed. Thirty wrong codes a minute from one address block hellos with a code for the rest of that minute.
  - **Scope.** While a table has a code, the code's scope decides its repositories (`all` is live, so a new repository arrives within one heartbeat, without a reconnect); its row in the console shows them read-only, and editing the code's scope reaches the table within 15 s, between games. Without a code, the per-table ticks of D-097 apply as before.
  - **Ending a code.** Revoking or deleting a code disconnects its table; the table's board says its code was revoked. Reconnect in the console still brings the table back, without the revoked code. A code expired or revoked more than a year ago is deleted automatically, unless a table still uses it.
  - **Pasting (16 Oct, Klaus).** The board's keypad takes a pasted code, by Ctrl/⌘+V or its *Paste* button (the clipboard API, which the browser may refuse; Ctrl/⌘+V then still works). Spaces and dashes are ignored, anything else is refused with a message. The console shows a new code as `ABCD-EFGH` but copies it without the dash.
  - **Validity on the board (16 Oct, Klaus).** Once accepted, the badge says how long the code is valid: *valid forever*, or *valid for* N weeks (from two weeks), days, hours or minutes, rounded down with a minute's slack (a new one-week code reads 7 days). Past it, *expired* in red, and the table keeps working (validity counts only for the first use). The service sends the time left with every config (`accessCode: {hint, expiresInMs}`), relative so the table's clock does not matter; the table turns it into `cloud.code.expiresAt` and changes it only on an edit, so heartbeats don't resend the lobby state. Open settings recount every 30 s.
  - **Tables.** `TABLE_CODE` or `--code` at start wins and can't be changed on the board; otherwise the board's settings have an *Access code* row (table's own board only, never remote boards) with an on-screen keypad, since the board has no keyboard. A typed code is kept in `table.json`. The lobby state carries `cloud.code` (hint, source, status), never the code; the board's waiting notice says what is wrong with a refused code. `POST /api/v1/cloud/code {code}` is the API (not available to remote players); `scripts/mac-table.sh --code` and the table PC's `.env` pass it through.
  - **Checks.** `tests/access-codes.test.ts` (normalising, calendar validity, binding, refusal reasons, expiry after binding, revoke, release, delete, scope none/some/all and edits, board entry, linking an approved table, start code wins, disconnected tables, rate limit, housekeeping) and `scripts/e2e/codes.py` (console create and copy, board keypad, edit, a service restart, a second table refused with its board saying why, release, delete).
- **D-114 · 2026-10-15 · Klaus** — The service keeps its state on a persistent volume, with backups; requested from kube-setup, done the same day (PVC `games-cloud-data`, 1Gi, at `/data`, Velero file-system backup daily, 30 days). *Implementation (Claude):* SQLite through `node:sqlite` (no native dependency, D-031), one `records` table of JSON documents per kind, in `DATA_DIR/state.db` (WAL); uploaded logs are files in `DATA_DIR/logs`. The working set stays in memory and every change is written through. Kept: approved and disconnected tables (with their repository ticks by `owner/name@ref`, stable across id changes), access codes, console-added repositories, the retention setting, log records, invites, download tokens and remote sessions; waiting tables are not (they say hello again). Secrets are stored only as SHA-256: table tokens (the plain token is handed to the table once and not kept even in memory), invite codes, download tokens, remote session ids and access codes, so a copy of the volume or a backup grants nothing. A consistent snapshot (`VACUUM INTO` through a temporary file) goes to `DATA_DIR/snapshots/state.db` at start, hourly and at shutdown, so a file-level backup always has one clean database. At start the service uses the snapshot if `state.db` is missing, fails to open or fails `quick_check` (keeping the damaged file beside it), or if a restore left a `RESTORE_FROM_SNAPSHOT` file; with no snapshot either, it starts empty and keeps the damaged file. Log records without a file, and files without a record, are dropped at start. Without `DATA_DIR` everything stays in memory as before (tests, local development). **Not overusing the PVC** (Klaus): game logs are the only thing that grows. They are bounded by retention (90 days), by a cap (`LOG_STORAGE_MB`, 256 MB) and by a storage budget (`DATA_LIMIT_MB`, 1024 MB, the PVC's size) of which 15 %, at least 100 MB, always stays free for the database, its snapshot and the write-ahead log: the oldest logs make way, and a log that can't fit is refused before anything is dropped (the table keeps its own copy). The budget is counted from the service's own files, not from the disk, because a `local-path` PVC has no quota: the disk it reports is the node's. At most three databases set aside by recoveries are kept. Extra-game bundles are not stored (they are fetched again at start). The console's Overview has a storage tile (red when free space nears the reserve), and `/admin/api/metrics` reports the parts. One replica is still required (D-071): one process owns the database and the tables' sockets. Supersedes the in-memory parts of D-036, D-097 and D-098; `deploy/game-repos.json` still sets the deploy-time list. Checks: `tests/store.test.ts` (a restart keeps everything, no secret on disk, damaged, missing and forced snapshot recovery, empty start without a snapshot, log files and records) and the restart in `scripts/e2e/codes.py`.
- **D-115 · 2026-10-15 · Klaus** — With persistent state, single records can be deleted in the console, and resetting everything or restoring a backup are runbooks, not console buttons. *Implementation (Claude):*
  - **Tables.** *Delete* appears on a disconnected table (an approved one answers 409: disconnect first, so nothing online is removed by one click). It removes the record, frees any access code bound to it, drops its invites and remote sessions, and with a second confirmation its logs (`DELETE /admin/api/tables/{id}?logs=1`). The same PC saying hello again is a new table with a pairing code.
  - **Logs.** *Delete* per log (record and file), and *Delete all simulation logs*; the API also deletes by table (`POST /admin/api/logs/delete {simulation, tableId}`, at least one filter, so never everything at once). Tables keep their own copies until their retention ends. The log list shows each log's table.
  - **Download tokens.** Tokens get an id, a label and their creator; `GET /admin/api/download-tokens` lists the active ones (never the token, only its hash is kept) and *Revoke* (`DELETE …/{id}`) ends one at once. Tokens saved before this keep working and are listed without a label.
  - **Runbooks.** `docs/runbooks/cloud-state-reset.md` (back up with Velero, scale to 0, empty the volume with a short-lived pod, scale to 1) and `docs/runbooks/cloud-state-restore.md` (A: the snapshot, automatic or with `RESTORE_FROM_SNAPSHOT`; B: a Velero restore of the volume, then the snapshot inside it; one record from a scratch-namespace restore). Reviewed by kube-setup against the cluster, and B tried as a scratch-namespace restore: Velero objects through `kubectl` (no CLI); a backup holds `/data` only while a games-cloud pod runs (the volume is opted in by the pod's annotation), so back up before scaling down; a `Restore` init hook sets `RESTORE_FROM_SNAPSHOT` after the data is written and before the app starts; Velero keeps the PV's *Retain*, so a scratch PV is set to *Delete* before its namespace goes. Their review found that the service's startup snapshot would replace the backup's consistent snapshot with a copy of the restored database if it started before the marker was set: each start now first keeps the snapshot it found as `snapshots/state.prev.db`, and `previous` in the marker selects it.
  - **Checks.** `tests/records.test.ts` (refusing an approved table, freeing its code, logs kept or deleted, a restart, single and bulk log deletes, token list and revoke, admin only) and the end of `scripts/e2e/codes.py` (revoke a token, delete simulation logs and a log, delete a table).

## Game logs for offline analysis (15 Oct 2026)

- **D-116 · 2026-10-15 · Klaus** — Every game's log is stored on the table and uploaded to the service with metadata (when, which game, who played, how it ended), for analysing bugs and misbehaviour offline, also with an LLM such as Claude. The table saves the log incrementally while the game runs and uploads it only when the game has ended, for whatever reason. A **verify** check replays logs. Watching a replay on the board goes to the backlog. *Why:* simulations never reached the service (their log was saved on the table but never announced for upload), a game the table stopped in the middle of left no log at all (it was kept in memory until the end), and a failed upload was silently dropped. *Implementation (Claude):*
  - **On the table.** From its first record, a game's log goes to `logs/running/<id>/` (`run.json` and one JSON line per record), fsynced at most once a second, so a power cut loses about a second. At the end it is packed into the zip and the running folder goes. At the next start, a running folder left behind is closed as `interrupted`: the state is rebuilt by replay when the same game version is installed, and the log is packed and queued like any other. Simulations are packed at the end of the run, as before.
  - **Upload queue.** Every packed log gets an entry in `logs/outbox/`; the table uploads the queue oldest first, at once and after every heartbeat, and an entry goes only when the service has the log (2xx) or can never take it (400, 409, 413). 401, 507 and network errors keep it for the next heartbeat. Retention removes entries with their logs. Simulations are announced for upload like played games.
  - **The zip** (format `gametable-log/2`): `README.md` describing the format for a reader who has only the zip (`apps/table-host/src/log-format.md`), `run.json`, `game-NNN.jsonl` and `game-NNN.state.json`, the final state in readable JSON. `run.json` keeps the format 1 fields and adds `kind`, `tableId`, `gameName`, `platform` (version, protocol), `timeZone`, `durationMs`, `settings`, `players` (seat, name, human or AI, local or remote, AI options), `seed` (simulations), `endReason` or `endReasons`, `result`, `counts` (intents, rejected, timers, errors) and `verify`.
  - **Errors.** An exception in the game's rules is recorded where it happened: a move or timer the rules threw on is logged with `error` (message and stack), so replay meets the same exception at the same point and goes on; an exception outside a move (a view, the end check) is an `error` record, the first 20 per game. The table's behaviour on such an exception is unchanged.
  - **Snapshots.** `LOG_SNAPSHOT_EVERY=N` adds a `snapshot` record with the whole state every N inputs (default off: the final state is always there). Replay ignores `error` and `snapshot` records.
  - **Verify.** Every game is replayed at its end, and every game of a simulation, and `run.json` says how many replayed to the state they ended in. `POST /api/v1/logs/{id}/verify` replays a stored log with the game as installed now (not for remote players). A failure means the rules use randomness or the clock outside `ctx.random()`, or the log is incomplete.
  - **Service.** It reads `run.json` from each upload (bounded; old-format logs keep the query's game and kind) and keeps the listing fields with the log record. `GET /admin/api/logs` filters by `gameId`, `tableId`, `from`, `to` (the day the game started) and `simulation`; download tokens take the same `tableId`, `from` and `to` as well as `gameId`, so one link can give a Claude session "all Loopy logs from yesterday". The console lists logs with start time, game and version, table, players, how they ended, duration, *does not replay* and error flags, with filters.
  - **Board.** The simulation dialog says how the games ended ("3 finished", or which did not) and whether every game replayed, instead of only "Done".
  - **Checks.** `tests/game-logs.test.ts` (uploads of simulations, played games and games ended from the lobby with their metadata; the queue across a service outage, uploaded once; the console's and download tokens' filters; old-format uploads; the running file during a game; recovery of a game the table stopped in, with its state rebuilt; the zip's files and README; a rule that throws; verify on request, a changed log and a non-deterministic game; snapshots; retention and the queue) and `scripts/e2e/logs.py` (a simulation from the board's dialog, a game with a phone, a table killed mid-game and restarted, all three in the console with filters, and a downloaded zip).

## Player colours in the lobby (16 Oct 2026)

- **D-117 · 2026-10-16 · Klaus** — A player's colour belongs to the player, not to the seat: it moves with them when they change seats. *Implementation (Claude):* refines D-106. A colour picked in the settings already followed the player; the default one (the seat's) was recomputed from the seat at every state, so a move changed it. Now the colour a seated player ends up with is kept for them (`keptColor`), and it comes right after an explicit choice when colours are given out, so moves and swaps keep everyone's colour; a new player takes their seat's colour only if nobody has it, else a free one. A player who leaves frees theirs. Check: `tests/player-color.test.ts` (a move to an empty seat, a swap, a newcomer on the old seat).


## Developer setting: games without a player at the table (16 Oct 2026)

- **D-118 · 2026-10-16 · Klaus** — A developer setting, off by default, waives D-004's player at the table: games may start with remote and AI players only, or with AI players only (then they play on the board). While it is off, the last player at the table can't be removed once a game is chosen or running; with it on, they can, and the game goes on with remote and AI players. A phone that goes away still leaves after the waiting time either way, and the game carries on (D-119 lets games decide otherwise). The setting is not kept: every start of the table turns it off. *Implementation (Claude):*
  - **Setting.** *Settings › Developer › Games without a player at the table* on the table's own board (`POST /api/v1/developer {allowNoLocalPlayer}`; refused to remote players). `ALLOW_NO_LOCAL_PLAYER=1` starts with it on. While it is on, the gear shows a DEV tag. `state.developer` carries it, and `protectedPlayer`: the one player the board may not remove.
  - **Rules.** With it off, "needs at least one player at the table" is a need as before, and removing the last seated human at the table while a game is chosen or running answers 409 with the reason; the board says so instead of asking. No game chosen: removal is allowed. AI players can always be removed. Turning it off drops nothing that runs; a chosen game shows the need again.
  - **Log.** `run.json` has `developer: { allowNoLocalPlayer: true }` when it was on at the start of the game.
  - **Board.** *Start game* is enabled with AI players only while the setting is on (nobody needs to tap Ready). The *Up next* text fits: "AI players only (developer setting): Start game plays it on the board", or "No player at the table (developer setting)" with remote players; the need "needs at least one player at the table" is not shown while the setting is on.
  - **Checks.** `tests/developer.test.ts` (off at start and after a restart, on with `ALLOW_NO_LOCAL_PLAYER`; starting with AIs only and with remote players and AIs; the log flag; the last player at the table kept, a second one removable, AIs always removable; a phone that goes away still leaves; removal with the setting on; turning it off with a game running), `tests/remote.test.ts` (remote players can't change it) and `scripts/e2e/developer.py` (the board's message, the setting and DEV on the gear, an AI-only game from the board).

## Players lost during a game (16 Oct 2026)

- **D-119 · 2026-10-16 · Klaus** — Games decide whether they can go on without a player. A game may end when a player leaves (a team is broken, or a minimum of players is needed), and says why. A temporary disconnect is survived: a game that needs the player pauses, the board says it can't go on until they are back and offers to end it, and it goes on by itself when they return. Games that don't say otherwise go on, as before; the disconnect of the last player at the table doesn't change that (D-118). Replacing a lost player with an AI comes later; the board's card leaves room for it. *Implementation (Claude):*
  - **SDK.** `canContinueWithout(state, seat)`: `true` or `{ wait: text }`, a question about the state that never changes it (replay asks it again). `onSeatLeft` may return `{ end: { text, highlights? } }` to end the game with its own reason ("end" still ends it with the platform's text).
  - **Table.** When a seated player's phone goes away during a game, the table asks the game. `true`: as before (the waiting time, then onSeatLeft). `{ wait }`: no waiting time, the seat is held; the game pauses (`pause.reason: "player"`, `pause.players` with each name, seat and the game's text; timers stop, AI moves stop and start again afterwards; it takes over a pause for a slow AI and gives way to a pause for the cloud, which comes back to it). When every player the game waits for is back, it goes on. *Resume* is refused while waiting. *End game* ends it; afterwards a player still away leaves after the usual waiting time. Removing a player the game needs ends it with the game's text (asked inside the runtime before the seat goes, so replay ends it the same way). The lobby state's `needed` lists, during a game, the players it can't go on without. A hook that throws counts as `true` and is recorded as an `error` with `where: "canContinueWithout"`.
  - **Board and phones.** A card at the player's seat (the game stays visible): the name, "is away", the game's text, "goes on as soon as … is back", **End game** (remote boards with board control too). Several players away: all names on one card. Every Remove confirmation says "This ends the game: …" for a player the game needs. The phones' banner says whom the game waits for and why.
  - **Log.** `disconnected` (with `waiting` when the game waited) and `reconnected` records; not inputs, replay skips them.
  - **Checks.** `tests/seat-loss.test.ts` with the test game Partners (`tests/fixtures/seat-games`, modes "teams" and "free"): waiting past the waiting time and going on, two players away, End game while waiting, removal ending the game with its reason and `needed` beforehand, the log records with an exact replay, a game going on without a player, onSeatLeft's own reason, and today's games unchanged. `scripts/e2e/seat_loss.py`: the card on the board and the banner on the phone, the return, and Remove that ends the game.

## Game Viewer (16 Oct 2026)

- **D-120 · 2026-10-16 · Klaus** — Finished games can be looked at move by move on the board, for debugging: a *Game logs* viewer (from the settings and the lobby) lists the table's stored games, shows a game's moves in a paginated table (number, time, player, what happened, plus columns the game chooses) and opens one move in full. The point is to pinpoint a stage of a game, e.g. "check move 43 in game loopy-1234, there is a rule violation", for a developer or an LLM, who navigates from there. **Player moves are numbered** (the reference). Only finished games, so everything may be shown, hidden cards included. Anyone at the board may open it, and remote players with board control; phones don't. Board only for now, built so the console can show the same later. The log also records why a game stood still. A step-by-step visual replay on the board may follow. *Why:* the review of an interrupted Loopy log showed that a log can be reconstructed, but reading it takes tools, and that silences (a pause, a sleeping table) and moves the rules make by themselves were not visible. *Implementation (Claude):*
  - **Numbering.** Every intent is a move, refused ones too (a refused move is often the bug), numbered from 1 in log order. Timers, players joining or leaving, disconnects, pauses and errors are unnumbered rows between them. Each row also names its line in `game-NNN.jsonl`. A silence of two minutes or more with no pause to explain it is a *gap* row (played games only).
  - **Log.** New records `pause` (`reason` `cloud`, `ai` with the AI's `seat`, or `player`) and `resume` (`cloud`, `ai`, `playNow`, `player`), also when a pause changes its reason; not inputs, replay skips them. Format stays `gametable-log/2`.
  - **SDK.** Optional `describe(step)`: the step (`kind`, `seat`, `intent`, `by`, `timer`, `accepted`, `reason`, `events`, `names`) with the state `before` and `after`, rebuilt by replay; it returns `{ text, columns?, details?, steps? }`, or null for the platform's generic line. `steps` carries what happened within the step for other seats or by the rules alone, with `auto` for moves nobody chose: this is how moves the rules make by themselves (forced moves, a seat the AI plays, a timer's move) show, without the platform having to understand a game's events. Manifest `viewer.columns` (up to four) names the extra columns. A `describe` that throws, or rules in another version than the log's, leave the generic line. Coin Flip (the flip as an automatic sub-step) and Pachisi (rolls, moves, captures, the turn timer's moves) describe their steps; Loopy can add its own.
  - **Zip.** `game-NNN.moves.jsonl`: the move list as the table built it when the game ended (also for interrupted games), documented in the zip's README. A reader with only the zip, or later the console, gets the descriptions without running game code. Simulations and older logs get theirs built when opened.
  - **Table API** (read-only, also for remote players with board control, 405 for anything but GET): `GET /history` (stored logs with their run.json fields, newest first; the running game is not stored yet, so not listed), `GET /history/{id}` (per game: moves, whether described, how it ended; the columns), `GET /history/{id}/{game}/moves?offset&limit&seat&movesOnly=1&problems=1&move=N&q=` (a page; `move` starts the page that holds move N), `GET /history/{id}/{game}/moves/{n}` and `…/lines/{line}` (one row in full: the raw record, the state before and after when the rules are installed in the log's version, the previous and next move, and the reference text). Unpacked logs are cached (four) and move lists built here too (eight).
  - **Board.** `board/viewer.js`: the list (date, game and log id, players, how it ended, moves, length), the moves table (16 rows a page, filters by player, *Moves only*, *Problems*: refused moves, errors, AI quick moves, gaps, pauses, disconnects; *Move #* highlights the move), and a move in full with **Copy reference**, the facts, the game's details, events, state after and before and the raw record, with previous/next. The panel turns with the board and fits on an east or west edge.
  - **For LLMs.** `scripts/game-log.ts`: the same on the command line from a zip or its unpacked folder, no table needed (`info`, `moves N-M`, `move N`, `state N [--before]`, `line L`, `--json`, `--games DIR` for other repositories' games). No MCP server for now: a Claude session with the repository has the script, and fetching logs from the service by id can come with the console's viewer.
  - **Checks.** `tests/game-viewer.test.ts` (numbering, gaps and pauses, `describe` with columns and automatic sub-steps, fallbacks, state before and after against replay, paging and filters, Pachisi's timer moves, pause and resume and the move list in a played game's zip, the endpoints, simulations, the script), additions to `async-ai.test.ts` (pause and resume records for AI and connection pauses), `remote.test.ts` (the viewer with and without board control) and `game-logs.test.ts`; `scripts/e2e/viewer.py` (a played game and a simulation in the viewer, filters, Move #, a move in full, copying the reference, facing east).

## Lobby colours in every game (16 Oct 2026)

- **D-121 · 2026-10-16 · Klaus** — Hold'em and Roulette use the players' lobby colours (D-106) like the other games, not the seat's colour. *Implementation (Claude):* `playerColor(info, seat)` for Hold'em's winner names and bet chips and Roulette's chips; no game uses `seatColor` any more. Checking it showed that Roulette's chips had all been drawn in the layout's top-left corner: their CSS drop-in animation sets `transform`, which replaces the SVG `transform` that places them. Each chip is now placed by an outer group and animated in an inner one, and only chips that are new drop in (a redraw used to replay the animation for every chip). `scripts/e2e/play.py roulette` now checks that every chip has its own position and its player's colour, including a colour picked in the settings; it fails without the fix.
- **D-122 · 2026-10-16 · Klaus** — Escape closes the settings window (and the board's other windows) without changing anything, and game events no longer move the settings back to the top. *Why:* in a game of AI players the settings could not be closed: *Done* scrolled out of view at once and Escape did nothing. *Implementation (Claude):* the settings and the lobby window were rebuilt on every lobby state, several times a second in an AI game, which reset their scroll position (and could lose a tap that began on a button that was replaced). `setPanel()` now rebuilds a window only when its content changed and keeps its scroll position when it does. One Escape handler on the board closes the topmost window by "tapping beside it", so each window keeps its own rule (a confirmation is cancelled; settings take effect as they are changed, so closing saves nothing new). *Done* sticks to the bottom of the settings. `scripts/e2e/play.py dialogs` checks that a state change leaves the settings panel as it is and that Escape closes it; it fails without the change.

## The phone during a game; player colour 6 (16 Oct 2026)

- **D-123 · 2026-10-16 · Klaus** — During a game the phone shows a slim tab bar instead of the header: the player's own tab (colour, name, seat) and the game's tab. The own tab shows what the header showed, everyone at the table, Rules and the terms; the footer is hidden during a game. *Why:* on an iPhone 16 Pro, Loopy's play button needed scrolling, because the header took the top of the screen. *Implementation (Claude):* for every game, in the platform's deck (not a Loopy override). The game's tab is open by default; the game's deck stays mounted while the own tab is open. When a seat view's `myTurn` turns true, the game's tab comes forward. In the lobby the phone is unchanged. `scripts/e2e/play.py tabs` checks it on a 320 × 568 phone: no header or footer during the game, the bar at most 52 px high, the own tab's contents, Rules and terms from there, the game's tab coming back on the player's turn, and the header after the game.
- **D-124 · 2026-10-16 · Klaus** — Player colour 6 is pearl (`#dde3ea`) instead of citron (`#e8e15f`), which was too close to colour 1 (amber). *Why:* hard to tell apart on the felt. *Implementation (Claude):* refines D-106. Pearl is the one neutral among seven hues, so colour-blind players cannot mistake it for another; it takes dark letters on the phone's badge. Colours are not stored across restarts, so nothing needs to move.
- **D-125 · 2026-10-16 · Klaus** — A player removed during a game leaves their colour on the seat: an AI that takes the seat over (Loopy) plays in that colour, not in the seat's default colour, which another player may have. *Implementation (Claude):* refines D-106/D-117. The table keeps the colour of a seat whose player leaves during the game (removed, or gone past the waiting time) and lists it in the lobby state as `seatColors` (empty seats only). `playerColor(info, seat)` in the board kit uses it for an empty seat, so every game gets it; board and phones pass it in `info.seatColors`. Nobody else gets that colour meanwhile; a player who picks it in the settings swaps with the empty seat. It is cleared when the next game starts or the table returns to the lobby.

## Game time for clocks (17 Oct 2026)

- **D-126 · 2026-10-17 · Claude** — Rules may read the game time: `ctx.now()`, milliseconds since the game started with
  the time it stood paused left out. *Why:* Chess (extra-games) needs real chess clocks, which charge each player the
  time they took. D-040 kept rules time-free, so a game could only count with timers, which would have meant a timer
  firing every second into the log. *Implementation (Claude):* the runtime counts the time spent paused (a lost
  service connection, a slow AI, a player away), so a pause costs no player time, and fixes the game time at the start
  of every input, so the rules and the log see the same value. Inputs (`intent`, `timer`, `seatJoined`, `seatLeft`)
  carry it as `gt`; replay hands it back, so replays stay exact (D-032). Logs from before have no `gt`: they replay
  with 0, and no game read the time then. Timers stay the way to make something happen later; `now()` only says when
  an input happened. Refines D-040. Check: `tests/game-time.test.ts` (start, pauses, a second pause reason, refused
  moves, the log, replay, old logs).
- **D-127 · 2026-10-17 · Klaus** — During a game the gear and the turn-around button no longer move or turn when the game is turned: they stay where they are when the game faces south. *Why:* turned to face north, Loopy's round and deck displays moved to where the buttons had gone, and they overlapped; fixed buttons also make the board more consistent. *Implementation (Claude):* changes D-088/D-101 for games: `placeSettings` uses the south edge during a game (the gear moves to the other end only if the game's Lobby button is in that corner, as before), and the turn-around button keeps its place and its icon; its label still says which way it turns. The lobby is unchanged: the gear follows the edge the lobby faces. `play.py roulette` checks that turning the game leaves both buttons where they are; Loopy's browser check turns the game north and checks the layout there.

## Game versions (17 Oct 2026)

- **D-127b · 2026-10-17 · Klaus** — Games use calendar versions like the services, `YYYY.MM.DD.N` (America/Chicago),
  and a game's version changes when, and only when, the game changes. *The rule:*
  1. **A game is its folder** (`games/<id>/`): rules and every module they import from the folder, the board and phone
     UI, styles, assets, the rules for players (`how-to-play.md`) and the manifest.
  2. **Any change in the folder takes a new version** in the same pull request: the date of the change, with `N` one
     more than the game's last version of that day, else 1. Several games changed in one pull request each take their
     own.
  3. **Nothing else changes a game's version.** The lobby, the board kit, the SDK, the table host and the service are
     the platform; a platform release leaves every game's version as it is. Logs record the platform's version beside
     the game's (`run.json` `platform`), so a log still says which platform ran it.
  4. **A version never changes without a change in the folder**, never goes down and is never dated in the future.
  5. The same holds in every game repository (extra-games, loopy-game, and any added later).
  *Why the version lives in the manifest, unlike the services' (kube-setup's requirement 1):* a service's version is
  the release that shipped it, so generating it at deploy time is right. A game must keep its version through releases
  that don't touch it, and extra-game bundles reach tables without git history, so the version has to travel in the
  game's own files. The rule keeps what requirement 1 protects (nobody forgets a bump, nothing drifts) with a check
  instead of generation. *Implementation (Claude):* `scripts/check-game-versions.ts` compares each game folder with
  the branch a pull request goes into and fails on a changed game without a new version, a new version without a
  change, a version that doesn't go up, a malformed one or a future date; `--fix` sets the next version for every
  changed game. It runs in the required `test` check here, and extra-game repositories run the same file from their
  games-service checkout. The manifest schema does not enforce the format, so a repository that has not switched yet
  keeps working on tables. All built-in games start at `2026.10.17.1` (the switch from semver is the one change the
  check allows without a code change). Check: `tests/game-versions.test.ts`.

## Advanced: tools that are not part of playing (17 Oct 2026)

- **D-128 · 2026-10-17 · Klaus** — *Simulation*, *Game logs* and the developer setting *Games without a player at the table* are not game functions, so they move off the lobby and out of the settings into an **Advanced** window, opened by a hammer-and-wrench button beside the gear. The lobby's toolbar keeps *+ AI player* and *Invite*; the settings keep what players need. *Implementation (Claude):*
  - **Button.** `#tools-button` in `board/index.html`, styled like the gear, placed by `placeTools()` in `board.js`: the next button along the edge from the gear toward the middle (172 px from the corner, or 242 px during a game when the turn-around button sits at 172 px), turned with the gear. While the developer setting is on, it carries the DEV tag (moved from the gear, D-118).
  - **Window.** `openAdvanced()`: *Simulation* (opens the simulation dialog as before), *Game logs* (the viewer, D-120), *Developer* with the toggle; it follows the lobby state and closes with *Done*, a tap beside it or Escape, like the settings. Simulations are available during a game too: they never touch the running game (D-064).
  - **Remote boards.** With board control they keep the game logs (D-120): the button sits where the gear would be (a remote board has none) and the window offers the game logs only. Without board control there is no button.
  - **Texts.** Messages that pointed to the setting in Settings point to Advanced.
  - **Checks.** `scripts/e2e/developer.py` (no Simulation or Game logs in the lobby, no Developer group or game logs in the settings; the toggle under Advanced, DEV on the new button, its place beside the gear), `logs.py` (the simulation from Advanced), `viewer.py` (the viewer from Advanced, facing east too) and `remote.py` (game logs only on a remote board with board control).

## A full table (17 Oct 2026)

- **D-129 · 2026-10-17 · Klaus** — When every seat is taken, *+ AI player* and *Invite* are disabled, and players who scan the QR code see that there is no free seat and what would help: more seats on the board, or removing a player. A seat counts as occupied as soon as a player has joined (a phone connected with a name, an invite taken, an AI player added), and stays so while their phone reconnects. Nobody joins without a seat any more (replaces the waiting newcomers of the lobby). *Implementation (Claude):*
  - **Rule.** `noFreeSeat()` in `table.ts`: null, or the reason in words. Full means no free seat in the layout on the edges the chosen game uses, or the chosen game already has as many players as it takes. During a game that is full: "join after it". A player joining during a game that does not seat newcomers still waits for the next game as before, as long as the table has a free seat.
  - **Refusals.** Joining by QR code (the socket's hello answers `{status: 409, code: "no-seat", message}`), a remote player's join, `POST /invites` and `POST /ai` are refused with the reason. `TableError` carries an optional `code`; the HTTP API answers it as `code` beside `error`.
  - **Phone.** `GET /j/{code}/seat` (only with the current join code; not for remote players): `{free, message}`. The join page asks it first, and with no free seat shows *No free seat* and the reason instead of the name form, asking again every 4 s; when a seat frees up the form appears. A join refused because someone was quicker shows the same. A remote player sees the reason on the invite page.
  - **Board.** `state.noSeat`; *+ AI player* (lobby and *Up next*) and *Invite* (lobby and the in-game lobby window) are disabled with the reason as their tooltip; the QR panel turns into *No free seat* with the code faded and the reason.
  - **Checks.** `tests/seats-full.test.ts` (the seat check and a refused hello with its code, + AI player refused and room again after a removal, eight seats taken, a reconnecting player's seat, a full game, invites and remote players refused), updated cases in `tests/lobby.test.ts` and `tests/platform.test.ts`, and `scripts/e2e/seats_full.py` (the board's greyed-out buttons and QR panel, the phone's message, and the form appearing by itself when a seat frees up).

## The join code from the settings (17 Oct 2026)

- **D-130 · 2026-10-17 · Klaus** — A phone that lost its seat during a game (its browser closed, the waiting time passed) is told to scan the QR code, but the board shows the code only in the lobby. The settings get an option that shows the QR code and the address again, at any time. *Implementation (Claude):*
  - **Board.** *Settings › Joining › Show join code…* opens a window over the settings: the QR code (360 px, for scanning from a seat), the address with its copy button, the code, and *New code* and *Done*. It follows the lobby state: a new code replaces it at once, and with no free seat (D-129) the code is faded and the reason shown. Escape, a tap beside it or *Done* close it and return to the settings.
  - **Phone.** "Join the table", "You left the table" and the expired-session message add where the code is during a game: *Settings › Show join code* on the board.
  - **Rejoining.** Unchanged rules: a game that seats newcomers (`dynamicPlayers`, e.g. Coin Flip) gives the returning player a seat at once; others seat them for the next game. A phone that comes back within the waiting time still reconnects by itself, without the code.
  - **Checks.** `scripts/e2e/rejoin.py`: Ann and Ben in Coin Flip; Ben's phone goes away for good and he leaves after the waiting time; a new phone page tells him where the code is; the board's *Settings › Show join code* shows the current address and code during the game; his phone opens it, joins, gets a seat in the running game and can guess.

## The remote deck during a game (17 Oct 2026)

- **D-131 · 2026-10-17 · Klaus** — On the remote player's page the deck keeps its size during a game: tapping the
  player's own tab no longer folds it, coming back to the game no longer shows a tiny card, and the deck uses the
  window's height. *Why:* on an iPad, Loopy's deck collapsed on the own tab and came back with a card a tenth of its
  size, and the deck stopped at 640 px with room to spare. The deck window took the height of its content (D-095),
  measured at the bottom of its last panel: the hidden game panel measured 0, and a game deck that sizes itself to its
  window (Loopy) then shrank with it. *Implementation (Claude):* during a game (the deck shows its tab bar, D-123) the
  window takes the full height, like a phone; outside a game it still fits its content, measured over the visible
  panels only. `scripts/e2e/remote.py` checks during a game: the deck fills the window's height on both tabs, keeps
  its size after Hide and Show and follows a resize (it failed before the fix); loopy-game adds a remote check with
  Loopy (`scripts/e2e/loopy_remote.py`).

## A single player at the table (17 Oct 2026)

- **D-128b · 2026-10-17 · Klaus** — A game can ask that the one player at the table sits on a given edge: with exactly
  one human playing at the table and the others remote or AI, the table moves them there when the game starts. Chess
  asks for south. *Why:* a remote player's board already turns so their own seat is at the bottom (D-059), but the
  table's board doesn't move: a local player seated north while sitting at the south side of the screen saw their
  own pieces from across the board, and no button could fix that. *Implementation (Claude):* manifest `localSeat`
  (an edge, optional). When the game is chosen (with the layout switch of D-078, so the lobby already shows it) and again at *Start* (someone may have joined or moved since), the table moves that player to the first seat on that edge, swapping with whoever
  sits there (a remote or AI player) or taking it if free; colours travel with the players (D-117). With two or more
  people at the table everyone keeps the seat they chose, and nothing moves when the player already sits on that
  edge. The game starts with the new seats, so its log, its seat plates and every board agree. Check:
  `tests/local-seat.test.ts` with the test game Duel (`tests/fixtures/local-seat`): a remote player swapped north, an
  AI player swapped, already south, two people at the table, a game without the field.

## One board window (17 Oct 2026)

- **D-132 · 2026-10-17 · Klaus** — The table PC shows the board in one window at a time. A second window says *The board
  is open in another window* (naming the game when one runs) and offers *Show the board here* or *Keep the other
  window*. *Why:* with two board windows open, a Loopy game finished while the window in front was still replaying
  round 13 (the other, a background tab, is slowed down by the browser), so *Show result* appeared over a game that
  looked unfinished.
  - **Host.** A local board's hello carries `tab` (the window's id, kept across reloads in sessionStorage). With
    another local board connected, the host pings it: if it answers within 1.5 s, the new window gets `system
    elsewhere {phase, game}` and no state; if not (closed window, dead connection), the new one takes the board. A
    hello with `takeover: true`, or from the same tab (a reload, a reconnect), takes the board at once: the old window
    gets `system replaced` and is closed (4009). Remote boards belong to remote players and are not limited.
  - **Board.** A panel over everything: *Show the board here* reconnects with `takeover`; *Keep the other window*
    tries to close the window, else says it can be closed. The replaced window shows *The board moved to another
    window* with the same buttons. Neither window reconnects by itself.
  - **Checks.** `tests/one-board.test.ts` (elsewhere and no state, the game named, takeover with the old window told
    and closed, the same tab, a dead connection, a closed window); `scripts/e2e/one_board.py` (panel, keep, take
    over, reload keeps the board, closing frees it; in `run-all.sh`).
- **D-133 · 2026-10-17 · Klaus** — One table serves at most one local board, a deck per player (eight at most), and a
  board per remote player (four at most, `maxRemotePlayers`), and keeps count. *Why:* a game engine shows one game to
  one board; two windows of the same thing (D-132) can show different moments or make a move twice.
  - **Decks.** A player's newest deck window replaces the older one (`system replaced`, close 4009); the old one says
    *Your deck is open in another window* with *Use this window*, which takes it back. The player stays connected
    throughout. A ninth deck is refused.
  - **Remote boards.** A remote session's newest board replaces its older one; a board for a session beyond the remote
    seats is refused (*this table already shows its board to every remote seat*).
  - **Counting.** `GET /api/v1/connections` (table key, not for remote clients): `{boards, remoteBoards, decks,
    limits}`.
  - **Checks.** `tests/one-board.test.ts` (a deck per player, eight decks), `tests/remote.test.ts` (one board per
    remote player, no more than the remote seats), `tests/platform.test.ts` (a second tab replaces the first, the
    player stays connected), `scripts/e2e/one_board.py` (the deck moved and taken back, the counts).
- **D-134 · 2026-10-17 · Klaus** — *Show result* waits until the game's board has shown the end. *Why:* a board window
  that falls behind (a background tab, which the browser slows down, or a slow PC) showed *Show result* over a game
  that still looked unfinished (D-132). *Implementation (Claude):* a game's board may return `whenIdle()` from
  `mount`, a promise that resolves once it has shown everything it was sent; when a game ends by itself, the platform
  holds the final screen as before (D-091) and shows *Show result* only once that promise resolves (two minutes at
  most, so a board that never settles still gets its button). Boards without it behave as before. Coin Flip resolves
  it when the coin has landed; Loopy when its replay queue is empty (loopy-game L-029). README, *Writing a game*,
  describes it. `scripts/e2e/play.py endings` fails when *Show result* appears while the coin still spins.
- **D-129b · 2026-10-17 · Klaus** — In the board's settings window, a choice with more than three options is a pulldown
  instead of a row of buttons. *Why:* Chess's eight time controls ran out of the window: the last was clipped and the
  rest could not be reached. *Implementation (Claude):* for a game's manifest settings (`enum`) and for the choices a
  game adds itself (`choice`); two or three options stay buttons. The pulldown is a native `select`, which the
  kiosk's Chromium opens as a touch list. Check: `scripts/e2e/settings_choice.py` with the test game Duel (a five-choice
  setting is a pulldown with all five, inside the window; a two-choice one stays buttons; both change the table's
  settings); it fails without the change.
- *Renumbered:* D-127, D-128 and D-129 were each used twice on 2026-10-17. The first keeps the number (the gear
  during a game, *Advanced*, a full table); the second is D-127b (calendar versions), D-128b (`localSeat`) and D-129b
  (pulldowns for long choices). Code and docs follow.
- **D-135 · 2026-10-17 · Klaus** — LLM-powered AI players are postponed. *Why:* their main gains over the coded AI
  (table talk, explaining moves, teamwork in words) need a conversational interface the table does not have, and would
  crowd the experience for now; on raw strength a model is not expected to beat a game's own planner. The
  provisions stay as they are (D-028 configuration on the table, D-112 background AI with *Play now*, a game's own
  language-model option). *When it comes back:* a hybrid first (the game's planner scores the legal moves, the model chooses among
  the best few and keeps per-game notes), the API called directly from the host, measured against the coded AI in
  AI-only simulations.
- **D-136 · 2026-10-17 · Klaus** — In Hold'em the board gets a button to go on to the next hand while a hand's result
  is shown, instead of waiting out the result's pause. Remote boards show it too while the table gives remote players
  board control. *Why:* with the pause long enough to read the result, players who have seen it wait for nothing.
  *Implementation (Claude):* a manifest's `skipTimers` (default none) lists the timers a board may fire early; Hold'em
  lists `next`. `POST /game/skip-timer { id }` (`Table.skipTimer`, `GameRuntime.skipTimer`) clears the pending timer
  and fires it at once: 403 for an id not listed, 409 when it is not pending or the game is paused, 400 without an id.
  Remote boards may call it with board control only (like *Play now*, D-112). The log records `timer` with
  `early: true`, so replay fires it at the same point (D-032). Games get `ctx.skipTimer(id)` and `info.boardControl`.
  Hold'em (2026.10.17.2) shows **Next hand · 7 s** under the result, in the pot line's place, **Finish** after the last
  hand; a tap disables it until the next view. Check: `tests/skip-timer.test.ts` (fires at once, logged early, 409/403/400, paused, replay
  verifies, manifest default), `tests/remote.test.ts` (remote boards with and without board control),
  `scripts/e2e/next_hand.py` (the button on the table's board and on a remote board over WebRTC, gone while board
  control is off, a tap starts the next hand at once, Finish on the last).
- **D-137 · 2026-10-17 · Klaus** — In Hold'em every player's cards and bet lie on the felt. *Why:* the south player's
  cards sat on the rail and the bet off the table (north the same). *Implementation (Claude):* a seat's spot was a
  fixed fraction of the way from its plate to the middle; north and south plates are much closer to the middle than
  east and west, so the same fraction left them on the rail. The spot is now straight in from the seat, 85 px inside
  the felt's stadium edge (its rounded ends included, for the outer seats of three or four on an edge), on every edge.
  The dealer button sits beside the dealer's cards (to their right, as the dealer sees them), on the felt; it used to
  sit on the rail. Check: `scripts/e2e/next_hand.py` with 2, 4, 6 and 8 seats (north, south, east and west seated):
  every card, bet chip and the dealer button inside the felt, and nothing in the middle (shared cards, pot, message,
  Next hand) over a seat's cards. Known: on a remote board viewed from a side seat, the middle turns with the viewer
  and the shared cards run across the felt's short side, where they touch the east and west seats' cards; this was so
  before.
- **D-138 · 2026-10-17 · Klaus** — Hold'em shows the street, the hand number and how many hands are left in two corners
  of the board: upper left facing north, lower right facing south. The Lobby button moves to the top right. The middle
  of the felt no longer has that line (it said *Hand 5 of 100 · turn*, readable from the south side only); it says
  *Game over* at the end, when the corners are gone. *Implementation
  (Claude):* the manifest's `lobbyButton` is `top-right`; the board's own buttons stay bottom left, so the other two
  corners are free. Each corner shows *TURN · Hand 5 of 100 · 95 more to play* (*RESULT* during the result's pause,
  *last hand* on the last), hidden once the game is over. "… to act" moved up under the pot (tighter pot line), clear of the south seat's cards. Hold'em
  2026.10.17.3. Check: `scripts/e2e/next_hand.py` (both corners read preflop, hand 1 of 2, the north one turned 180°, the middle has no street line, neither
  covers a seat plate or a button, Lobby top right, in 2/4/6/8-seat layouts).
- **D-139 · 2026-10-17 · Klaus** — Hold'em gets sound effects: shuffling and dealing, chips for bets, and the like.
  *Implementation (Claude):* made with Web Audio in `games/holdem/board.js`, no files, like Pachisi (D-102), through
  the board kit's `playSound`, so they follow the table's sound setting (D-092). One sound per rules event, in order
  within a step: `handStarted` a riffle (two halves of quick clicks and the bridge, 0.7 s) then one flick per card dealt
  and two chip clicks for the blinds; `action` two knuckle taps on the felt for a check, a soft slide for a fold, chip
  clacks for a call (2), a bet or raise (4) and all-in (9); `street` a snap per shared card (3 on the flop); `showdown`
  or `wonByFold` the pot raked in, then a three-note chime. A board that comes up as the game starts misses the first
  hand's events, so on its first update it plays the shuffle and deal for a fresh hand 1 (once per hand, however the
  events arrive). Platform: `playSound` dropped every sound while a new audio context was still starting, so the first
  sounds after a board loaded were silent in every game (CI caught it: Hold'em's first hand made no sound); it now
  plays a sound once the context runs, if that happens within a second, so a board nobody has touched yet does not
  release a pile of old sounds at the first tap. Check:
  `scripts/e2e/next_hand.py` (each of the seven sounds plays, a shuffle for every hand, the first included).

## The statistics window (18 Oct 2026)

- **D-140 · 2026-10-18 · Klaus** — A finished game's awards and statistics in a window on the board, for every game
  that sends them. *Why:* an earlier version of Loopy ended with trophies and per-player counts; this
  is worth having for all games, drawn the same way.
  - **Data.** A game's summary may carry `awards: { id, icon, title, blurb?, seats, value? }[]`; the SDK's `mostAward`
    and `leastAward` build them, ties shared. The host keeps an award only when some, not all, players hold it (an
    award everyone or nobody gets says nothing), and adds from the game log `players` and `play` (moves, time per
    move and longest move per player, without paused time; times for people only) plus two awards of its own,
    *Quick Draw* and *Deep Thinker*, when at least two people made three moves or more. Games count their own numbers
    during play (Hold'em) or read them from their moves at the end (Chess); the log is the platform's source.
  - **Window.** Board only, at the table and on remote boards (not the phones). Scrollable: the awards as cards with
    the holders' names, *No awards in this game.* when there are none, then the game's table and *Moves and time*.
    At the table it can be turned to any edge (S, N, W, E); a remote board faces its own player. English only.
  - **Where.** A *Statistics* button beside *Show result* when a game ends by itself, one on the result screen, and
    one in the Game Viewer for finished games (`GET /history/{log}/{game}/statistics`, the same data from the log).
    No button when a game sends nothing for it.
  - **Games.** Coin Flip: *Sharpshooter*, *Heads Fan*, *Tails Fan*, *Unlucky*. Hold'em (counted during play, in the
    state): *Best of All* (the best hand shown), *Rich* (most points at any time), *The Best Pot*, *The Shark* (most
    hands won), *Firestarter* (most bets and raises), *Careful* (most folds), *All In*; its table adds peak, hands won,
    biggest pot, bets, folds and best hand. Chess (extra-games) and Loopy (loopy-game L-030) have their own.
  - **Checks.** `tests/statistics.test.ts` (the helpers, the host's checks, moves and pace without pauses, Coin Flip
    and Hold'em awards, the history endpoint); `scripts/e2e/play.py endings` (the button, the awards shown, turning to
    east and north, the result screen's button, Escape).
- **D-141 · 2026-10-18 · Klaus** — AI players play at the board's pace: an AI moves only once the table's board has
  shown the moves before. *Why:* AI players moved faster than Loopy's board animates a turn, so in a game of mostly AI
  players the board fell behind every round (measured: 8 rounds behind after two minutes); the game ended on the
  table in round 20 while the board showed round 9, and *Show result* appeared there after D-134's two-minute limit.
  *Implementation (Claude):* every game message to the local board (D-132) carries `seq`; the board answers
  `game idle {seq}` once it has shown it (its game's `whenIdle`, D-134, or at once without one). An AI move starts when
  the board has shown everything sent, or the board stayed silent for 20 s (a stuck window cannot freeze the game).
  Without a local board (headless tests, simulations) or with `BOARD_PACING=0` (fast test runs, Klaus: "preserve a mode
  for faster testing in CI") AI players don't wait; remote boards never hold the game up. D-134's two-minute limit on
  *Show result* is removed (Klaus: speculative). Measured with a Loopy game of four AI players: board and table on the
  same round throughout. `tests/board-pacing.test.ts`: waiting for a silent board until the timeout, going on as each
  move is shown, no waiting without a board or with pacing off, a board that goes away.
- **D-142 · 2026-10-18 · Klaus** — The finished screen fits in the center panel: the game's statistics table scrolls
  (both ways) in a smaller font, so a six-player Loopy table no longer runs over the seats at the board's edge.
  *Why:* Klaus: "the six player Loopy game uses too much space for the Game summary. We should use scrollbars, and
  possibly smaller font." *Implementation (Claude):* the summary is a column bounded by the center panel (also
  sideways); the result text and the buttons stay in view, the table sits in a scroll box with its header row and
  player column kept in place. Table text 18 px (was 26), headers 11 px, tighter cells, no wrapping in cells: a six-player Loopy table (10
  columns) fits facing an edge; facing sideways it scrolls.
- *Renumbered:* the statistics window and board pacing were recorded as D-136 and D-137 on 2026-10-18, numbers the
  Hold'em decisions already used. They are D-140 and D-141; code and docs follow.
- **D-143 · 2026-10-18 · Klaus** — Phones follow the board, and an AI answering its own follow-up question doesn't
  pause first. With AI players paced on the board (D-141), an AI player's move reaches the decks once the table's board
  has shown it, so a phone says "Waiting for Rosa" while the board shows Rosa's move (it used to name the next AI
  while the board still showed the one before) and "your turn" when the board gets to you. When the game asks the
  same AI again in the same turn (a card, then the piece to move), the platform's
  AI pause (`aiDelayMs`) is skipped while the board paces the game: it is one move, and the board shows each step
  anyway (without a board the pause is all that lets people follow). *Why:* Klaus: phones
  showed "Waiting for" names one AI ahead of the board, and around a TAC "the AI's get to think twice". *Implementation
  (Claude):* game messages caused by an AI's intent are held per deck until the local board reports that message as
  shown (`game idle`, D-141), until the board stays silent for the pacing timeout, or until the game no longer goes at
  the board's pace (no local board, pacing off, game over); any other message to a deck (a human's move, a timer, a
  pause) first sends what is held, in order. No local board or `BOARD_PACING=0`: nothing is held. A human can only act
  out of turn in simultaneous phases (as in Loopy), where AI moves show at once on the board, so a deck is behind
  for milliseconds at most there. `tests/board-pacing.test.ts`: a phone gets an AI's move once the board has shown
  it, its own move at once.
- **D-144 · 2026-10-18 · Klaus** — A player whose phone goes away during a game no longer leaves it after a minute by
  default: their seat waits, and the board can hand the seat to an AI player. The old waiting time is a table setting.
  *Why:* Klaus: "make the timeout to replace a player with an AI optional. On the board we can 'eject' a player to be
  replaced with an AI manually." *Implementation (Claude):*
  - **Setting.** *Settings › Players › A player whose phone is away for a minute leaves the game*, off by default
    (`POST /api/v1/play {awayTimeout}`, the table's own board only; in memory, like the sound setting). On: as before,
    the game's own rule for a player who leaves runs after the waiting time (`GRACE_MS`; a game may put its AI in the
    seat, Hold'em folds the player out). Turned on or off during a game, it applies to players already away.
  - **Away.** With it off, a player away during a game keeps the seat with no time limit; the game is not paused and
    waits by itself when it is their move. After 15 s (a phone locking for a moment shows nothing) the state lists them
    in `away` and the table's board shows a card at their seat: "Ben is away · The seat waits for them. Or hand it to an
    AI player…" with **Hand Ben to an AI** for games with AI players. Games that can't go on without the player
    (D-119) pause as before; their card gets the same button. Outside a game, away players leave after the waiting time.
  - **Hand to an AI.** `POST /players/{id}/replace-with-ai` (the table's own board; only for a player who is away, in
    a game with AI players), after a confirmation: a new AI player "Ben (AI)" with the game's default AI options takes
    the seat and the colour, the human's session ends (their phone, back, is told the seat went to Ben (AI)), and a game
    that waited for them goes on. It works for every game with AI players, without the game's leaving rule: to the game
    the seat is simply played by an AI from then on. The log gets an `aiTakeover` record (seat, name, AI options; not
    an input), shown in the Game Viewer.
  - **Checks.** `tests/away.test.ts` (the seat waits past the waiting time, shown as away only after the delay,
    handing to an AI with colour, log and the phone's message, a waiting D-119 game going on, the setting turned on
    for a player already away); `scripts/e2e/away.py` (the card, the confirmation, Ben (AI) in the seat). Tests and
    checks of the waiting time turn the setting on.
- **D-145 · 2026-10-18 · Klaus** — A remote player on a north seat gets the game's corner buttons where they look for
  them: *Lobby*, *Show result* and *Statistics* in the game's corner (its `lobbyButton`) as that player sees it, with
  upright text, and the tools at their own bottom left, also during and after a game. The statistics window opens
  upright on their screen. *Why:* Klaus: with a remote player north (Chess, Backgammon), *Statistics* sat at the
  remote player's lower left and opened upside down. *Implementation (Claude):* a remote board turns its surface so its
  player's seat is at the bottom (D-059); the buttons live on that surface, so the game's corner landed opposite, and
  the overlay root lies outside the surface, so turning a dialog toward the player's edge turned it over. Now
  `cornerClass()` maps the game's corner by half a turn on a north remote board (class `turned` keeps the text upright),
  the tools follow the player's edge during a game as they already did in the lobby (D-127 keeps them fixed on the
  table's own board only), and overlays and dialogs on a remote board face no edge (`overlayEdge()`), which fixes every
  dialog there, not just the statistics. The table's own board is unchanged. East and west remote seats keep today's
  placement (their surface turns a quarter; the corner buttons would need their own layout). *Checks:*
  `scripts/e2e/remote.py` ends a Coin Flip game with the remote player north and checks the corners, the tools and the
  statistics window.
- **D-146 · 2026-10-18 · Klaus** — A game setting typed out of range is caught in the settings window itself: a message
  names the setting and its range ("Points to win the match can be from 1 to 100. 150 is too high.") and has to be
  acknowledged with OK, and the window stays open on that field. *Why:* Klaus: the table refused the value only after
  the window had closed, and it was unclear what was wrong with the setting. *Implementation (Claude):* `formDialog`
  checks every number field (a number, whole for `int`, within `min`/`max`) before it closes; `noticeDialog` is a
  message only its OK button closes (a tap beside it does not; Escape does). The table's own refusal names the setting
  by its label instead of its key. The lobby's settings panel needed no change: its − and + stay in range. *Checks:*
  `scripts/e2e/play.py dialogs` (Roulette's *Spins* at 51: the message, a tap beside it, OK, the field focused, no game
  chosen); `tests/platform.test.ts`.


## The classic colour set (18 Oct 2026)

- **D-147 · 2026-10-18 · Klaus** — Player colours become the classic set: yellow, sky, red, green, purple, pearl, orange, pink. Green and teal (colours 4 and 7) were too close; measured, they were the nearest pair, and for red-green colour blindness sky and violet were nearly identical. *Implementation (Claude):* refines D-106 and D-124. `PLAYER_COLORS` (protocol) and `SEAT_COLORS` (board kit): `#f2d24b`, `#5fb7e8`, `#e5484d`, `#7fd18b`, `#9d6bf0`, `#dde3ea`, `#f08a3c`, `#ef8fcf`. Compared in CAM02-UCS with simulated colour-vision deficiencies: the closest pair for normal vision goes from 15.3 (green/teal) to 22.3 (red/orange); for deuteranopia from 1.9 (sky/violet) to 12.3; protanopia 6.3, tritanopia 9.8. Pearl stays the one neutral. Badges pick dark or white letters by contrast (`inkOn`), so the light colours need nothing else. Colours are not stored across restarts; a choice made before the update falls back to the seat's colour.

## Player names (18 Oct 2026)

- **D-148 · 2026-10-18 · Klaus** — Player names are at most 12 characters (longer ones are cut) and unique at a table: a second player who picks a name already there is refused. Players can change their name on the phone. *Why:* long names overlapped seat plates and result tables with eight players, and two players with the same name can't be told apart. *Implementation (Claude):*
  - **Rule.** `trimName()` in `table.ts`: spaces tidied, control and invisible characters dropped, cut to `MAX_NAME` = 12 characters (code points, so an emoji stays whole). Two names are the same when they match ignoring case and spacing (NFKC). Empty: the next free "Player N". A name ending in "(AI)" is refused: it is how AI players are marked (D-081). AI names and AI takeovers (D-144) keep their own rules.
  - **Joining.** A taken name is refused with `{status: 409, code: "name-taken"}` (`name-invalid` for "(AI)"); the phone's join form shows the reason under the name and keeps what was typed; its field takes 12 characters. A remote player types the name on the service's invite page and can't retype it there, so a taken name gets a number instead ("Ann 2", cut to fit 12); the invite page's field takes 12 too.
  - **Change name.** On the phone, beside Rules in the header, outside a game: a sheet with the name, *Save*, and the reason if it is refused (`lobby.rename {name}` on the socket). Not during a game, since games and their logs use the names they started with; not for AI players. The board has no keyboard, so renaming is the player's own business on their phone.
  - **Checks.** `tests/names.test.ts` (cutting and tidying, taken names ignoring case and after the cut, "(AI)", empty names, remote numbering, rename rules) and `scripts/e2e/names.py` (a taken name on the join form, the 12-character field, Change name refused and accepted, the board following).
- **D-149 · 2026-10-18 · Klaus** — End screens fit at the most players with the longest names. Klaus found Coin Flip's
  last screen with eight players overlapping the north plates (title) and the south plates (results), and asked to check
  every game at its most players, the statistics window too, with long names. *Survey (Claude):* every game played to
  the end at its most seats with 12-character names, each handed to an AI ("Christophers (AI)", the longest a seat
  shows): Coin Flip 8, Hold'em 8, Roulette 6, Pachisi 4, with the end, statistics and result screens captured.
  - **Coin Flip.** At the end the results table stands beside a smaller coin instead of under it, so nothing reaches
    the north or south plates; names in it stay on one line.
  - **Show result, Statistics, Lobby.** The corner buttons sit 26 px from the edges (was 38), and *Statistics* sits
    10 px beside *Show result*, measured, so the buttons take less of the corner a south-east or north-east plate needs.
  - **Lobby seat cards.** A name longer than 12 characters (only an AI that took a seat over) is a size smaller, so
    "Maximilianus (AI)" is no longer cut.
  - **Roulette** could end on "No more bets": the number is revealed 5.2 s after the spin, the game could end sooner,
    and the board had no `whenIdle()` (D-134). It now has one that resolves at the reveal, and a new round's betting
    reveals the last spin at once, so a late reveal can't overwrite "Place your bets".
  - Hold'em, Pachisi and every statistics window already fitted (the statistics window scrolls).

## Roulette at a full AI table (18 Oct 2026)

- **D-150 · 2026-10-18 · Klaus** — Roulette with six AI players (the developer setting, D-118): the betting layout
  shifted down at "No more bets" and back at "Place your bets"; the countdown ("1  s") looked poor; "Bet from your
  phone" showed with no phone at the table; Roulette had no sounds; two of six AIs never bet in 50 spins; AIs only bet
  even-money chances; and the end had no statistics. Klaus asked for awards in the spirit of "Odd Man".
  - **Layout.** The side column is centred in the table's grid, and the hint line under the layout was emptied outside
    betting, so the column got shorter and moved. The status row and the hint line now have fixed heights.
  - **Countdown.** A 76 px ring in the status row that empties with the time to bet (`bettingSeconds`), the seconds in
    its middle; brass, red and beating under 6 s. Faded out, not removed, when nobody can bet, so it never moves the row.
  - **Hint.** "Bet from your phone…" only while a human sits at the table (`info.players`, `kind: "human"`).
  - **Sounds** (Web Audio, as Hold'em, D-139, through `playSound`, D-092): `betPlaced` a chip and a tap (a step's AI
    bets 90 ms apart, at most 8); `betsCleared` a slide and a click; `bettingOpen` two bell tones; a tick per second in
    the last five; `wheelSpun` 5.2 s timed to the wheel's ease-out: a low rumble fading, the ball's rattle slowing,
    then seven bounces into a pocket; the reveal a chime, a four-note fanfare when anyone came out ahead (only after a
    live spin, not when a board comes up mid-result).
  - **AIs that never bet: a platform fix.** `scheduleAi` cancelled and restarted every AI's pending move on each
    change. All pauses were equal, so the first AI's move cancelled the others: AIs moved one at a time in join order,
    about 1.6 s each at the board's pace (D-141), a bet and Done each. Six needed about 10 s; with a shorter time to
    bet the last two never got a turn, every spin. Now, in `turnModel: "simultaneous"` games, an AI still waiting out
    its pause keeps it (it reads the game when the pause ends anyway); a move already being worked out is still
    replaced, so no AI answers from an old view. Sequential games are unchanged. A pause that ended without a
    move (the game could not take one then) is not kept but scheduled afresh. One effect: an AI no longer starts its
    pause over when someone else moves, so in Coin Flip it may guess a moment after a phone and the next round opens at
    once; `viewer.py` now waits for the round to flip rather than for the phone's buttons to grey out. Measured: six AIs done in about 2 s,
    every seat betting every spin with 8 s to bet. Test: six AIs with a 1 s pause finish inside 5 s (fails before).
  - **AI variety.** Each AI has a pet even-money bet (`seat % 6`) for half its outside bets and a lucky number
    (`(7·seat + 11) % 37`) for 40 % of its number bets. *Conservative* now bets a number at the minimum 12 % of the
    time and a dozen or column 18 %; *aggressive* and *erratic* as before, with the pet and lucky number.
  - **Statistics** (D-140): per seat, counted at each spin (`stats` in the state): bets by type, single-number hits,
    bets on zero, points staked, spins played, won and sat out, longest winning streak, biggest gain on one spin.
    *Table:* Player, Points, Net, Bets, Spins won, Biggest win, Best streak. *Wheel facts* (in the summary's text and
    `highlights.facts`): red and black counts, longest red and black streaks, zeros, the hottest number (twice or
    more). *Awards* (`mostAward`, so a tie of everyone or nobody is left out): High Roller, Jackpot, Bullseye, Hot
    Hand, Lucky Charm, Number Cruncher, Zero Hero, Odd Man, Even Steven, Seeing Red, Night Owl (black), Low Rider
    (1–18), High Flyer (19–36), By the Dozen (dozens and columns), Wallflower (sat out most).

## How a phone sees the board (19 Oct 2026)

- **D-151 · 2026-10-19 · Klaus** — A game's phone can show the board the way its player sees it, at the table and remotely, in every rotation. Klaus asked Starforge to carry everything learnt about the deck and the board's rotations, remote players included: "north" on the phone must be the direction the player sees as up the table. *Implementation (Claude):*
  - **The table keeps the game's facing.** `gameFacing` (`"north" | "south"`) in the lobby state: the last north or south the table faced (D-101). Turning the lobby east or west leaves it; the board's `gameEdge()` reads it instead of tracking it itself, so a phone that joins later knows it too.
  - **Deck `info`** gains `seatEdges` (as the board has them), `viewEdge` (the table edge the player looks from) and `boardEdge` (the edge the game faces on the board that player sees). At the table: `viewEdge` = the seat's edge, `boardEdge` = `gameFacing`. A remote player has their own board, turned to their seat (D-059), or upright when an east or west seat chose the full width (D-101): there both are that board's edge, so the phone reads it upright. A phone turns a map by `ROT[boardEdge]`-relative angles.
  - A remote player toggling the full width re-renders the game on their phone (`storage` event), so the map follows at once.
  - **Checks.** `tests/lobby.test.ts` (the facing kept through east, west and rotations).
- **D-152 · 2026-10-19 · Claude** — Two fixes found by Starforge's browser checks (D-151):
  - **Remote players keep a game's assets.** The relay worker (`remote-sw.js`) answered everything `no-store`, so a
    deck that redraws its screen refetched every picture over the data channel on each update (Starforge: about 25
    per tap) and went blank meanwhile. Successful GETs under `/games/<id>/assets/` are now kept in the worker's
    memory for 10 minutes (64 MB at most, oldest dropped first) and served `private, max-age=600`. Everything else
    stays `no-store`. A game updated between games shows its new assets within 10 minutes, or at once after a reload.
  - **A game's result table scrolls sideways inside its card on the phone**, with slightly tighter headers, instead
    of running past the card (eight columns at 390 px).
- **D-153 · 2026-10-19 · Klaus** — `klaushofrichter/starforge-game` (Starforge, private) joins the deploy-time repositories on its `production` branch, beside extra-games and
  loopy-game (D-098, D-110). `GAME_REPO_TOKEN` must be able to read it (Contents: read).
- **D-154 · 2026-10-19 · Klaus** — The lobby's QR panel reads *Scan to join locally* (was *Scan to join*): the code
  is for players at the table; remote players join through an invite. Checked facing south and east (the narrow panel).

## Inviting a remote player by name (19 Oct 2026)

- **D-155 · 2026-10-19 · Klaus** — The lobby's button reads *Invite remote player…* (was *Invite…*). The invite dialog takes an optional name for the player; the link carries it (`/i/CODE?name=…`) and the invite page fills it into the name field, where the player can still change it. Names stay at most 12 characters (D-148) everywhere, non-ASCII included. *Implementation (Claude):*
  - **Board.** *Player's name (optional, they can change it)* with *Add a name…* opens the board's own keyboard (`openNamePad`, the board has no keyboard): letters with the first of each word capitalised and ⇧ for the other case, a row of accented letters (ä ö ü é è à ç ñ å ø, ß), digits and `- ' . & ! ?` behind *123*, space, delete, a 12-character count. A real keyboard, any input method and pasting work in the field too (keys don't take its focus). The link and the QR code update with the name; ✕ removes it.
  - **Counting.** Names are cut like the table's `trimName`: NFC, control and invisible characters dropped, spaces tidied, at most 12 code points, so an emoji or an accented letter counts once (not UTF-16 units). The same rule on the board, in the link and on the invite page (its field was `maxlength=12` in UTF-16 units; now cut by code points as typed). The table still cleans every name it receives, and a taken name still gets a number (D-148).
  - **QR endpoint.** `/api/v1/qr` accepts a URL with a query now (characters `\w.~%+=&-`), up to 400 characters.
  - **Also fixed:** the dialog's *Remote players can use the board controls* checkbox sat above its text (a general `.overlay label` rule); it is beside it again.
  - **Checks.** `scripts/e2e/invite_name.py` (the button text; the keyboard's capitals and accents; a real keyboard with Japanese stopping at 12; the link and QR with the name; the invite page filled in, editable, 14 emoji cut to 12, a long name in the link cut to 12; removing the name) and `tests/remote.test.ts` (QR with a named link, a bad query refused).
- **D-156 · 2026-10-19 · Klaus** — The deck's header outside a game gives the name its room: *Change name* and *Rules* sit in a row of their own under the name, only the seat badge beside it. Klaus saw a remote player's name cut to "Ja…" in the lobby (a narrow deck window with three items beside the name). In a game the header is unchanged (*Rules* and the badge beside the name; no *Change name* there). *Also:* in *At the table*, a name keeps its colour dot and stays on one line; on a narrow deck the seat and status move under it, to the right. Checked at 320, 340 and 390 px with 12-character names.
- **D-157 · 2026-10-19 · Klaus** — A live status for finding what holds a game up, and phones told when the board has
  shown their moves already. *Why:* Klaus saw the board light up his turn while his phone still said "Waiting for …
  (AI)" several times over, and asked whether AI players think when it isn't their move and how to see what blocks.
  Measured: they don't block; every AI is asked after each change and answers "no move" in milliseconds when it isn't
  its turn. The lag was Loopy's phone staging every move again on its own (slower) timeline after the board had
  shown it (loopy-game L-035). *Implementation (Claude):*
  - **Live status.** *Advanced › Developer › Live status…* on the table's board (`GET /api/v1/debug`, not for remote
    boards), refreshed twice a second: the board's progress (game messages sent and shown, D-141), each AI player's
    move in the making (*pause before acting*, *waiting for the board*, *thinking*, and for how long), the phones held
    back until the board shows the AI moves (D-143), and the AI players' recent answers (moves with their time, the
    time they waited for the board; "no move" answers only when they took 50 ms or more).
  - **afterBoard.** A game message a phone gets only after the board has shown it (D-143) carries `afterBoard: true`;
    the deck passes it to the game as `info.shownOnBoard`, so a game that stages moves on the phone can skip that.
  - **Checks.** `tests/board-pacing.test.ts`: the flag on a held message and not on the player's own, and the status.
- **D-158 · 2026-10-19 · Klaus** — A player can leave from their phone, at the table and remotely: **Leave the game**
  on the Ready screen and on the own tab during a game, after a confirmation. *Why:* Klaus: "That should trigger the
  option to replace the leaving player." *Implementation (Claude):*
  - **Before a game** (the Ready screen): the player leaves the table (as when the board removes them, but by
    themselves); their phone says "You left the table".
  - **During a game** (the own tab, D-123): their session ends ("You left the game"; the phone, back, is told so) and
    the seat is handled like an away player's at once (D-144): it waits, and the board shows "Ann left the game ·
    Hand the seat to an AI player, and the game goes on" with **Hand Ann to an AI**, without the 15 s delay for a
    phone that locks. With the waiting-time setting on, the game's leaving rule runs after it as for an away player;
    a game that can't go on without them (D-119) pauses with the same button and End game.
  - **Protocol.** Deck message `lobby.leave`; `away[]` and the player pause's `players[]` mark them `left: true`.
  - **Checks.** `tests/away.test.ts` (leaving the table before a game; leaving a game: the removal message, `left`
    at once, the session's message, handing to an AI; a D-119 game pausing); `scripts/e2e/away.py` (the button, the
    confirmation, the phone's message, the board's card).
- **D-159 · 2026-10-19 · Klaus** — A running game keeps its players; who plays a seat can be exchanged on the board.
  Replacing someone is a conscious choice of the people at the table, never a timeout. *Why:* Klaus: "it becomes a
  conscious choice by the players … to replace a player who is unresponsive, and we don't want an unexpected or
  special handling of this type of timeout"; "We do not remove a seat from a running game, so that the game has always
  the same number of players … no 'remove' option for players during a game, only 'exchange'"; exchange "regardless
  their status (away, or still in the game)"; seats are changed in the lobby only; "use the final players name for
  statistics … an asterisk". *Implementation (Claude):*
  - **No timeout, no removal.** D-144's setting *A player whose phone is away for a minute leaves the game* is gone
    (`POST /play`, `state.play`): a seat whose phone is away always waits. The board can't remove a player of the
    running game (`DELETE /players/{id}` answers 409, code `in-game`); away players' waiting time only runs outside a
    game. Games' `onSeatLeft` is therefore no longer called during a game (logs that have `seatLeft` still replay).
  - **Exchange.** *Settings › Players › Exchange…* beside every seated player of the running game (and *Exchange …*
    on the away card, D-144, D-158), on the table's board, and on a remote board with board control (D-057: remote
    boards with control now also operate colours, AI options and game settings). The window offers *Someone at the
    table* (a QR code and link for this seat only, `POST /exchange {seat, kind: "local"}`), *A remote player* (a new
    invite, `kind: "remote"`, needs the service; the next remote player to arrive takes the seat), *An AI player*
    (`kind: "ai"`, at once, after a confirmation) — or, for an AI player, *How it plays* (its options, now changeable
    during the game from its next move, logged as `aiOptions`). The window stays open until the new player has taken
    the seat, then closes by itself; *Cancel* (`DELETE /exchange`) ends it. One exchange is open at a time
    (`state.exchange`); it ends with the game. Whoever had the seat goes: an AI stops, a person's phone is told the
    seat went to the new player. The newcomer gets the seat's colour, and may use the old player's name (Ann back on
    a new phone stays "Ann").
  - **Games.** A new input `seatChanged` (logged and replayed) carries the new player's name and kind to the game's
    optional `onSeatChanged(state, seat, ctx)`; the seat, its cards and score stay. Coin Flip, Hold'em, Pachisi,
    Quartet and Roulette update their names; Loopy (L-036), Chess, Liar's Dice and Backgammon (E-016) too. A game
    without it shows the name it started with.
  - **Statistics.** A seat's last player names it, marked with *: in the awards, the moves table and the game's own
    table (a row whose name matches), with "* Another player took over this seat during the game." under the window.
    Times and pace awards leave such a seat out (they would mix two players).
  - **Checks.** `tests/away.test.ts` (exchange for an AI, connected or away, with the phone's message, the log, replay
    and statistics; for someone at the table with the seat's own code, once; for a remote player; cancelling; ending
    with the game), updated tests for the refused removals; `scripts/e2e/exchange.py` (the window, the QR code, the new
    phone taking the seat, then an AI); `scripts/e2e/rejoin.py` and `away.py` use the exchange.
- **D-160 · 2026-10-19 · Klaus** — The contract between games and the platform is one developer guide, written for
  people and for language models, and published for LLMs as `llms.txt`. *Why:* Klaus: "the 'contract' between the
  game and the platform/lobby needs to be clear and well documented. It can be assumed that games will be created by
  LLMs like Claude"; private game repositories are not named or linked as sources of information or requirements.
  *Implementation (Claude):*
  - **The guide:** `docs/developers/game-development.md`: the table, principles (one way for the same action in every
    game; a running game keeps its players; deterministic rules; private views; the rules decide, the UIs draw), the
    folder, every manifest field, every rules hook and the context, what the platform does about players and what a
    game hears (D-144, D-158, D-159), AI players, the end-of-game summary and awards, the board and phone modules with
    every `ctx` and `info` field, rules for players, logs and replay, versions, testing, a game repository of one's
    own, and a checklist. The README's *Writing a game* is now a summary that points to it.
  - **For LLMs:** `llms.txt` (the llmstxt.org format: a title, a summary, the key rules, links to the guide, the SDK
    and protocol sources, the board kit, the log format, the example games and the test helpers). The cloud service
    serves it publicly at `https://games.skylar.technology/llms.txt`, the guide at `/docs/game-development.md`, and
    both in one file at `/llms-full.txt`; the landing page links them, and the deploy's smoke test checks
    `/llms.txt`. `AGENTS.md` points coding agents to the guide; the SDK's header comment too.
  - **No private sources:** the guide, `llms.txt`, the README and code comments name only this public repository; the
    examples are the games here. `tests/developer-docs.test.ts` keeps the guide in step with the code (every hook,
    manifest field and `info` field documented) and checks that no private repository is named; `tests/cloud.test.ts`
    checks the three public routes.
- **D-161 · 2026-10-19 · Klaus** — `klaushofrichter/extra-games` is public, the example of a game repository, and it and
  this repository refer to each other. *Why:* Klaus: "Extra-games … can be a public example of a game package. … We can
  use this as example in the platform repos"; "The repositories games-service and extra games should refer to each
  other." *Implementation (Claude):* the README (intro, *Writing a game*, *Extra-game repositories*), the developer
  guide (top and *A game repository of your own*) and `llms.txt` link to it as the example to copy; its README links
  back to the guide (extra-games E-017). The other game repositories stay private and unnamed in the documentation
  (D-160); `tests/developer-docs.test.ts` checks both. The console no longer needs `GAME_REPO_TOKEN` for extra-games.
- **D-162 · 2026-10-19 · Klaus** — This repository is under the MIT licence, like extra-games (E-018). *Why:* Klaus: "I
  want to use MIT for the public repos." *Implementation (Claude):* `LICENSE` (Copyright (c) 2026 Klaus Hofrichter),
  `"license": "MIT"` in `package.json`, a *Licence* section in the README. The repository holds no third-party images,
  sounds or fonts, so the one licence covers everything in it; packages from npm keep their own.
- **D-163 · 2026-10-19 · Klaus** — The terms of service name the MIT licence and say that there is no warranty or
  guarantee for anything. *Why:* Klaus: "These can mention the MIT license, and obviously that there is no warranty or
  guarantee for anything." *Implementation (Claude):* `apps/table-host/public/shared/terms.md`, reviewed and no longer
  marked as a draft, has sections *Playing* (no real-world value, no gambling for money, AI players shown as such),
  *What is recorded* (logs and saved games, 90 days by default, remote play through the service), *No warranty*
  (as is: availability, errors, correct rules or results, kept logs and saves, fitness; terms may change; liability
  excluded as far as the law allows) and *Software* (MIT, link to the repository; games from other authors under
  their own terms). Not reviewed by a lawyer.
- **D-164 · 2026-10-19 · Klaus** — The board's invite dialog closes by itself when its invite brings a player, with a short note "*Rita* joined through the invite". *Implementation (Claude):* the service knows an invite only by its hash; it keeps that hash with the remote session and sends it to the table with the connection offer. The table remembers the invites it asked for (by hash, the last 32) and, when a remote player joins through one, lists it in `state.remote.joined` (`{invite, name}`, the last 8). The dialog closes when its own invite appears there, so another invite being used leaves it open; the board's name keyboard (D-155) closes with it. The board-control switch stays in the invite dialog. Checks: `tests/remote.test.ts` (the joined invite), `scripts/e2e/remote.py` (the dialog closes and says who joined) and `next_hand.py`.
- **D-165 · 2026-10-19 · Klaus** — A runbook sets up Game Table on one machine with Docker, independent of
  games.skylar.technology, without DNS or HTTPS, written to be followed by a coding agent. *Why:* Klaus: "this runbook
  should be independent of the "games.skylar.technology" service, and ideally not require a DNS entry and HTTPS. The
  runbook would be used by an LLM such as Claude, where a developer would instruct the LLM something like "read the
  repository … and setup a running version of the core service with the build-in games"." *Implementation
  (Claude):* `docs/runbooks/local-docker.md` with checks after every step; `deploy/local/setup.sh` writes
  `deploy/local/.env` (the LAN address for the QR code, a random table key); `deploy/local/docker-compose.yml` builds
  the Table Host from the checkout, publishes port 8080 with `ALLOW_REMOTE_BOARD=1` (the board's browser reaches the
  container from outside its loopback) and no `CLOUD_URL` (development mode). Optional: more games from a folder
  mounted at `/app/games` (`GAMES`, e.g. extra-games), and `--profile cloud` with a local cloud service (ADMIN_TOKEN
  sign-in, only `klaushofrichter/extra-games` listed). Phones work over plain http; remote play does not except on
  `localhost`, because browsers allow its service worker only in a secure context (checked in Chromium). Linked from
  the README, `AGENTS.md` and `llms.txt`; the `e2e` job runs the runbook as written (setup, build, simulation, a
  browser game over the LAN address, Part B, the cloud profile).
- **D-166 · 2026-10-19 · Klaus** — In the board's settings, a player's name is the way to exchange them during a game;
  the *Exchange…* buttons are gone, and the colours sit right-aligned. An exchange for a remote player shows the
  invite's QR code next to its link. *Why:* Klaus: "remove the "Exchange" button, and make the player name clickable
  instead. Show the color choices right aligned. Add a subtitle note to that section …"; "When showing the link for a
  remote player to exchange against someone in the current game in the settings window: also show the QR code."
  *Implementation (Claude):* `board.js` renders each name as a button (dot, name, ›) where the player may be
  exchanged (a running game; a remote board only with board control), else as plain text, with the note "Tap a
  player's name to exchange them for someone at the table, a remote player or an AI player, or to change how an AI
  player plays." In the lobby nothing changes but the alignment. `/qr.svg?exchange` also answers for an open remote
  exchange, with its invite, on the table's board and on a remote board with board control (which sees the link
  anyway); a seat's join code stays on the table. The remote channel passes `/qr.svg` through for that. The in-game
  lobby's player list and the away card keep their *Exchange…* buttons. Checks: `tests/remote.test.ts`,
  `scripts/e2e/exchange_remote.py`.
- **D-167 · 2026-10-19 · Klaus** — A remote board operates the table only while its browser has a player at the table.
  A remote player who was exchanged, left or was removed kept a board with full board control, also in the lobby after
  the game. *Why:* Klaus: "when the game ends, the exchanged remote player can see the lobby. So that player still has
  some connection that is not cleaned up. This player can also operate the lobby." *Implementation (Claude):*
  `Table.remoteControlAllowed(session)` also needs `hasRemotePlayer(session)`; the HTTP API checks it for every remote
  change and for the Game Viewer ("you are no longer a player at this table"); such a board's state has
  `remote.boardControl: false` and `remote.watching: true`, so its controls hide and the lobby says "watching". A
  remote board before its player has joined has no control either. The board keeps watching; making that a proper
  watch mode (listed, counted, removable, convertible to a player) is the next step.
- **D-168 · 2026-10-19 · Klaus** — Remote **watchers**: someone invited to watch sees the board without a seat or a deck;
  a remote player who is exchanged or leaves becomes a watcher. Remote players and watchers together stay within the
  remote places (4 by default). The board shows an eye with the number of watchers while there are any; tapping it
  lists them and removes them; a watcher can be made a player through the exchange. *Why:* Klaus: "We could add a
  "viewer" mode, where we invite a remote player to watch only … We would add a checkmark "watch only" on the invite
  modal … active remote players + remote watchers is no more than 4 … a way to evict remote watchers … "convert" a
  watcher to a player through the "exchange""; on the questions: an exchanged remote player converts to a watcher, one
  who leaves too ("we need a way to actually leave. Probably close the window is good enough, or eviction"), and "show
  that there are watchers … That icon on the board can also be used to tap and see who is watching, and offer
  eviction from that place." *Implementation (Claude):*
  - **Table:** remote browsers ("visitors", by cloud session, never shown) with their board windows, a name, and
    whether they came on a watch invite, were a player, may join, or were removed. A watcher has a board open and no
    player, and either a watch invite or a past seat. `watchers: {id, name}[]` in the lobby state; a remote board's
    state says `remote.watching` and `remote.mayJoin`. The invite's watch flag stays on the table (it knows its
    invites by hash, D-164): the cloud service is unchanged, the link's `?watch=1` only words the invite page.
  - **Limits:** `remoteCount` (remote players + watchers) against `maxRemotePlayers`, for invites (refused when full,
    `remote-full`), watch boards and remote joins. A watch invite needs no free seat; during a game, and when the
    seats are full, the board's invite button invites a watcher.
  - **Removing:** `DELETE /watchers/{id}` (the table's board, or a remote board with control): the watcher's board
    gets `system.removed`, the host ends their WebRTC session after half a second, and the table refuses that session's
    reconnects ("you were removed from this table"); the invite page says so and stops reconnecting.
  - **Letting play:** in a game an exchange of kind `watcher` (`{seat, kind: "watcher", watcher: id}`) lets that
    session's deck take the seat; in the lobby `POST /watchers/{id}/play` lets it join for a free seat. The invite page
    opens the deck when its board says `mayJoin` (it no longer loads the deck before the board).
  - **Board:** the eye button beside the tools, its list (Remove, and Let play in the lobby), a *Watching* group in
    Settings, watchers as choices in the exchange window, *Watch only* in the invite dialog, "watching" in a remote
    watcher's lobby line, "Wanda is watching" when a watch invite is used.
  - **Checks:** `tests/remote.test.ts` (watch invite, refused deck, removal and refused reconnect, limits, converted
    players and Let play, exchange for a watcher and back), `scripts/e2e/watch.py` (the whole flow in browsers).
- **D-169 · 2026-10-19 · Klaus** — Settings › Joining invites someone remote too, not only phones at the table: during a
  game and with every seat taken as a watcher (who can then be given a seat through the exchange), in the lobby with a
  free seat as a player. Remote players and watchers together stay within the four remote places. *Why:* Klaus:
  "During game, we can use the "joining" section in the settings to "add a player". This currently can only add local
  players. But we may want to add "remote players" … a remote player may join as "watcher" and therefore can join a
  "full board". As before, we want to limit the total number of remote connections to 4." *Implementation (Claude):*
  a second row under Joining with the same invite button as the lobby (`inviteButton`, D-168) and a line saying what
  the invite brings now and how many remote places are taken. Invite buttons are now greyed out, with the reason,
  while the table has no connection to the Game Table service (before, they failed only when tapped). Also: a
  `node_modules` symlink committed by mistake with D-168 is removed, and `.gitignore` catches such a link.
- **D-170 · 2026-10-19 · Klaus** — More tests around players and watchers, and what they found. *Why:* Klaus: "you can
  create more tests around the player and watcher management, and deploy when all tests are green." *Implementation
  (Claude):*
  - **Found and fixed:** a remote player who left a running game (D-158) kept their player record for the waiting
    seat, so their browser kept board control and did not become a watcher, against D-168. `hasRemotePlayer` and the
    remote counts now leave out players who left; their board watches, and the seat can go back to them through an
    exchange for them as a watcher. A remote player who takes back a seat keeps their name (the leaving record no
    longer turns "Ruth" into "Ruth 2"). The board limit's message now says "no room for more remote players or
    watchers". A remote board without control (a watcher, or control switched off) no longer shows *Start game*,
    *Change game* or game tiles as buttons; the server refused them anyway. The phone's leave dialog tells a remote
    player that they keep watching.
  - **Tests:** `tests/remote.test.ts` (leaving in the lobby and in a game, counted once, seat back by exchange;
    closing the window and coming back in the same browser, two windows as one watcher; an exchange for a watcher is
    theirs alone, cancelled or with the watcher removed it lets nobody in; Let play only in the lobby with a free
    seat; a watcher through the end of a game; who may manage watchers; no session in the state; players and watchers
    filling the places, an earlier invite refused). `scripts/e2e/watch_lobby.py` (leave → watching → Let play →
    reload; a watcher closing the window; leaving a game and coming back by exchange).
## A review of players and watchers; changelog and runbook (20 Oct 2026)

- **D-171 · 2026-10-20 · Claude** — An overnight review of players, seats, watchers and exchanges (D-159 … D-170),
  with tests for "all seats are taken, can another one come in?" in every way someone can arrive. *Why:* Klaus: "Do
  another /simplify run … Apply any fixes, invent new testcases then needed, specifically for cornercases like "all
  seats are taken, can we add another", and deploy when all test are green." *Implementation (Claude):*
  - **Found and fixed:**
    - Exchanging the AI player a game was paused for (D-112, out of time) left the game paused, waiting for an AI that
      had gone; the newcomer could not move until someone tapped *Play now*. The pause now ends with the exchange.
    - An exchange for a new remote player did not count the remote places (D-168): it opened, asked the service for
      an invite, and the invited player was then turned away at the board ("no room"). Now `POST /exchange
      {kind: "remote"}` is refused at once when the places are taken (code `remote-full`), before an invite is made.
      The seat's own remote player frees a place only if their browser goes too; with their board open they would
      stay as a watcher, so that place stays taken. An exchange for a watcher, an AI or someone at the table never
      needs a remote place.
    - An AI taking over a long name went over the twelve characters of D-148 ("Alexandra 12 (AI)"); the old name is
      now cut to fit with the mark ("Alexand (AI)").
    - Two watchers with the same name were listed alike, so *Remove* could not tell them apart; a watcher's name is
      now unique among watchers and players ("Wanda 2"), and a watcher let in to play keeps the name they were
      listed with.
    - A remote exchange's invite link (and its QR code, `/qr.svg?exchange`) reached every remote browser, watchers
      included; now only remote boards that may exchange (board control, a player at the table, D-167) get it.
    - A phone whose seat was exchanged said "You left the table"; it now says "Your seat went to someone else" (and a
      phone removed on the board "You were removed from the table"). The leave dialog no longer says the seat can be
      handed only to an AI player.
  - **Simplified:** one check for the remote places (`assertRemoteRoom`, one message `REMOTE_FULL`) for invites,
    watch boards, remote joins and exchanges; one exchange check before an invite is asked for (`assertExchange`);
    `join()` has one path for newcomers and exchanges; one `newInvite()` in the server; `Table.playing` for "a game
    is running". **Removed** as dead since D-159: the table's `onSeatLeft` call and the colours kept for empty seats
    (`seatColors` stays in the state, always empty, for older UI code), the unused `POST
    /players/{id}/replace-with-ai` (the away card opens the exchange), `endsGame`/`gameHasAi` on the board, a "full
    game" branch nobody could reach when seating newcomers. Comments, the developer guide (Settings › tap the name,
    every seat taken, watchers, the remote places) and `log-format.md` (`seatChanged`, `aiOptions`) match the code.
  - **Not changed:** a player who left a running game with free seats and joins again by the join code is refused
    their own name while the seat waits for an exchange; whether they should take back their seat that way is a
    product question for Klaus. "The next remote player to arrive takes the seat" of a remote exchange stays as D-159
    has it.
  - **Checks:** `tests/seat-corners.test.ts` (every way in with every seat taken, in the lobby, with a chosen game at
    its maximum and during a game; newcomers during games that take them or not; two and eight seats; the remote
    places with players and watchers, the remote exchange refused or allowed; a second exchange replacing the first,
    cancelled, the game ending with one open, a seat whose player left, taken names, a long name, a pause for the
    service, the AI the game waits for; leaving and coming back; names colliding; removals refused), a new check in
    `tests/remote.test.ts` (the exchange link only for boards that may exchange), `scripts/e2e/seats_full.py` (a full
    game: the third phone is told to join after it, the form appears with more seats), `scripts/e2e/exchange.py`
    (the replaced phone's message).
- **D-172 · 2026-10-20 · Klaus** — A player who left a running game (D-158) and scans the join code again with their
  name gets back the seat that waits for them; and an exchange for a remote player stays open to the next remote
  player who arrives, not tied to one invite. *Why:* asked after the D-171 review, Klaus: "Should a player who leaves a
  game and rejoins with the join code get their waiting seat back? Yes"; "Should a remote exchange be tied to one
  specific invite? No". *Implementation (Claude):* `Table.join` looks for a player at the table who left the running
  game, whose seat still waits, with the same name ignoring case (`leftPlayerNamed`), before the free-seat check: the
  same player comes back with a new session (the game sees no seat change; a pause for them ends), even when every
  seat is taken. Only phones at the table; a remote player who left watches (D-170) and comes back through an exchange
  for them as a watcher. Once the seat went to someone else, the name is free and joining is the ordinary way. The
  phone's leave dialog, the ended session's message and the board's cards for a player who left say how to come back.
  The remote exchange is unchanged (D-159). Checks: `tests/away.test.ts`.
- **D-173 · 2026-10-20 · Klaus** — The CHANGELOG's [Unreleased] section is cleaned up, and a release's notes take only
  the lines added there since the previous release. *Why:* Klaus, on a review remark that the section held 67
  already-published entries: "We should cleanup". The remark thought the release step didn't read the CHANGELOG; it
  does (`scripts/release-notes.sh`), and since nobody emptied the section after releases, every release since 19 Oct
  repeated all of it (about 70 notes in each). *Implementation (Claude):* the section is emptied; `release-notes.sh`
  keeps the section's lines that `git diff <previous tag> HEAD -- CHANGELOG.md` adds (all of it before the first
  release), so a note is published once even when the section is not emptied; `PREV=<tag>` renders an older release's
  notes again. Replayed for the last releases: each gets only its own line. The file's header says so.
- **D-174 · 2026-10-20 · Klaus** — The local Docker runbook says plainly that the cloud service (its console) is not
  needed to play locally, and has a section on installing games from a private repository by cloning it. *Why:*
  Klaus, after a successful local installation: "The main uncertainty was how to register a private repository with
  games. We did a clone of the repo (as we had access), and it worked out. Is the console service actually needed for
  running local only games? We should clarify this in the runbook."; "Add a section about "private repos" with games,
  and how to install these (possibly by cloning)." *Implementation (Claude):* `docs/runbooks/local-docker.md`: a
  "Do I need the cloud service? No" paragraph after *What you get*; Part B split into B1 (a public repository, as
  before) and B2 (a private one: access check, clone by SSH, HTTPS or `gh`, the release branch, adding the game
  folders, check, update; no token on the table side); an agent hint that other repositories are Part B, not Part C;
  Part C says what the console route needs for a private repository (`GAME_REPOS`, `GAME_REPO_TOKEN`), which
  `deploy/local/docker-compose.yml` now passes to the local cloud service. README points to it. Klaus added: "the
  audience for the runbook is a LLM. Our prompt to claude was "Checkout https://games.skylar.technology and read the
  llms.txt. I want to do a local installation."" So `llms.txt` says near its top, before the developer guide, that a
  local installation follows the runbook and needs no cloud service (private game repositories are cloned); the cloud
  service serves the runbook at `/docs/local-docker.md` and in `/llms-full.txt` (only this runbook: the cluster ones
  stay unpublished); the runbook names that prompt and links absolutely. Checks: `tests/cloud.test.ts`, the image
  check in `production-checks.yml`, the deploy's smoke test.

## Play from the board (21 Oct 2026)

- **D-175 · 2026-10-21 · Klaus** — A developer setting *Play from the board* (Advanced › Developer, or `BOARD_DECK=1`)
  lets one player at the table play from a deck beside the board, without a phone. *Why:* Klaus: "a toggle in the
  "advanced setting" modal, in the developer section, that would limit the local board member to one, take away the
  QR code, and show a deck on the board just like the remote player, only for the single local player … for game
  developers who do not want to use their phone, and it is limited to one local player (because the deck needs to be
  private)." Asked about the rest: "Remote players are OK, and so are watchers"; switched off, the player stays as an
  ordinary player at the table ("I follow the recommendation"); "The layout and behavior should be like a remote
  player". *Implementation (Claude):* while on, the board's top-level page moves to `/board/play.html`, the remote
  page's layout (board left, deck window right with Hide/Show, full height during a game) with the board and the deck
  (`/deck/?board=1`) in frames; it is served only where the board is, with the table key, and the deck joins with that
  key instead of a join code (`joinFromBoard`). One person at the table: switching on is refused (409) while two are
  there; a phone with the join code is refused (403, "played from its board"); a second name from the board is
  refused; the same name takes over that person (their phone is told "You play from the board now"); an exchange for
  "someone at the table" is refused and hidden; the QR code and *Show join code* give way to a note. Remote players,
  watchers and AI players are unchanged. Switched off, the page returns to `/board/` and the player keeps their seat
  as an ordinary player (the platform's away and exchange rules apply). In memory until restart, like D-118. Checks:
  `tests/board-deck.test.ts`, `scripts/e2e/board_deck.py`.

## The public website (21 Oct 2026)

- **D-176 · 2026-10-21 · Klaus** — `games.skylar.technology` gets a public website as its landing page, advertising
  the platform; the admin pages stay as they are. *Why:* Klaus: "come up with a website as new landing page at
  games.skylar.technology that showcases the service, offers developer help, and supports installation … specifically
  want to help developers to create their own games and add them to the platform. We are specifically targeting
  developers who use AI to create new games and components. The "admin login" should be unobstrusive in the top right
  corner. There should be a section about the game board hardware (a placehoder right now …)"; a feature overview of
  the lobby and how players and watchers are managed, the integrated games and extra-games ("not the private repos"),
  the developer section; "engaging, modern and dynamic … focussing with the public part of the website on desktop
  users"; screenshots of the public games; paths for gamers, game developers and tinkerers; a list of third-party
  repositories. Then: "The main audience are actually game developers. We want to emphasize the local board game with
  friends, only aided by a touchscreen that is shared by several people, with some option to invite remote players.
  But the local play is the key." and "the Backgammon game was created in hours with Claude and it offers all the
  features of the platform". *Implementation (Claude):* one self-contained page, `apps/cloud/public/home.html`
  (inline CSS and JavaScript, the board's felt-and-brass look and fonts, no external requests), served at `/` with
  the admin link (`#admin-link`: Google sign-in, or the portal when signed in), the signed-out note and the version
  label the deploy checks filled in; images under `/site/` (`apps/cloud/public/site/`, WebP, made by
  `scripts/site-screenshots.py` from a host running every public game). Sections: a hero with the table seen from
  above (the board cycling through the games, phones around it, cards dealt), three paths, local play first with
  remote play as an option, the games with filters and a close-up, an animated lobby that acts out joining, AI seats,
  away phones, exchanges, remote invites, watchers and *Play from the board*, the developer section (Backgammon as the
  case, a prompt for the agent, five steps, code tabs, what you write and what the platform does, links to the guide
  and `llms.txt`), game repositories (games-service and extra-games only, with "Add yours" as an issue), installing
  with Docker, the table hardware as a placeholder, and "Fork everything" (Klaus: "everything in github for your use under MIT
  license, with Architecture Decision Records"). After the first draft ("Perhaps a bit too conservative") the hero became
  a pinned scene whose camera moves overhead as one scrolls, with dice and chips, a marquee of the games and counters;
  the Backgammon case re-enacts the session from Klaus's real prompt ("Create a backgammon game for the game
  platform"; "a working version came out by way of Claude without supervision"). Klaus reviews a live preview before
  it is deployed. Motion stops with `prefers-reduced-motion`. Checks:
  `tests/website.test.ts`, `scripts/e2e/website.py`; the deploy's smoke test still finds the version on `/`.


## Preview marker on the public website (22 Oct 2026)

- **D-177 · 2026-10-22 · Klaus** — Until the service goes live, the public website carries a PREVIEW / DRAFT sash
  in its top right corner. *Why:* Klaus: "the service is not actually live, but we deployed the landing page. I would
  like to add a badge "PREVIEW / DRAFT" and banner to all the public webcontent on the webapp. The banner should be
  always on-screen, in the top right." Of three mockups (a corner sash, a floating notice card, a hanging pennant) he
  chose the sash, and: "The actual admin pages does not need that banner, and remote.html does not need it either. The
  banner is just for the landing page." *Implementation (Claude):* `server.ts` fills `{{preview}}` in `home.html`
  with a fixed, diagonal, brass-striped band ("PREVIEW / DRAFT", "NOT LIVE YET") that clicks pass through; where
  the page margin is narrower than the sash, the top bar moves its right end clear of it (smaller on phones, the
  GitHub link hidden below 360 px). `llms.txt` and the `/docs/` files are plain text and stay as they are. It is on by
  default; `PREVIEW_BANNER=0` removes it at launch without a code change, which is why the deploy's smoke test does
  not require it. Checks: `tests/website.test.ts` (on, off, not on the admin and invite pages),
  `scripts/e2e/website.py` (in the corner after scrolling, clear of the admin and GitHub links at both widths).

## Statistics and awards on the public website (22 Oct 2026)

- **D-178 · 2026-10-22 · Klaus** — The public website shows the statistics and awards window (D-140) in a section
  of its own. *Why:* Klaus: "can we add the "Statistics and Awards" as a feature to the Web page? We can make a
  screenshot or simulate one from a award window that shows a few awards as this is a fun addition to classic games,
  e.g. Backgammon or Chess or Texas Hold em. Find a good place for it on the page". *Implementation (Claude):* a
  section *Every game ends with a story* (`#awards`) right after the games and before the lobby, so it follows the
  games it belongs to. On the right a real screenshot, `site/statistics.webp`: the board's window after eight hands
  of Hold'em with six AI players, made by `scripts/site-screenshots.py` (`statistics` on its own). On the left four
  awards each from Hold'em, Chess and Backgammon (their real titles and blurbs) behind tabs, the platform's own part
  (moves and time, *Quick Draw* and *Deep Thinker*, the Game Viewer) and the `mostAward` line a game writes, for the
  developers the page is for. Not in the top bar's menu, which is full. Checks: `tests/website.test.ts` (the
  section), `scripts/e2e/website.py` (the tabs).

## The game close-up on phones (22 Oct 2026)

- **D-179 · 2026-10-22 · Klaus** — On the public website, a game's close-up scrolls by itself, and the page behind it
  stays put. *Why:* Klaus, with a screenshot of Liar's Dice on an iPhone: "On the games detail, when scrolling, it moves
  the background." The close-up is taller than a phone's screen but could not scroll, so a swipe scrolled the page
  under it. *Implementation (Claude):* the close-up scrolls (`overflow-y: auto`, `overscroll-behavior: contain`, so
  a swipe past its end doesn't pass on to the page), the page is locked while it is open (`html.lb-open`), it opens
  at its top, and *Close* sticks to the top as one scrolls. The close-up is still centred when it fits, as on desktop.
  Checks: `scripts/e2e/website.py` (at phone width: the close-up scrolls, the page doesn't, Close stays in view, the
  page scrolls again after closing).

## Testing and debugging on the public website (22 Oct 2026)

- **D-180 · 2026-10-22 · Klaus** — The developer section of the public website shows how to test without players and
  debug with an AI. *Why:* Klaus: "did we highlight the developer information, like game log and full-AI game
  simulations (no real player needed for fully automated testing), and APIs for LLMs to debug games?" They were only
  named in lists. Then: "Just add this content to the site directly". *Implementation (Claude):* a block *Test without
  players. Debug with your AI.* (`#debug`) in the developer section, after *You write / The platform does*. Three
  cards: AI-only simulations (`POST /api/v1/simulation`, `scripts/soak.ts`; twenty games of Hold'em with six AI
  players took 0.6 s), game logs (the zip with its `README.md`, the replay check, `scripts/game-log.ts` with real
  output) and the Game Viewer's move reference with a prompt for the AI, plus the board control API for agents. Below
  them a real screenshot, `site/game-viewer.webp`: the move list of that simulation, made by
  `scripts/site-screenshots.py` (`viewer` on its own). Checks: `tests/website.test.ts` (the block and its image).

## Simulation times in the Game Viewer (22 Oct 2026)

- **D-181 · 2026-10-22 · Klaus** — The Game Viewer (D-120) shows a simulation's move times relative to its start, as
  `scripts/game-log.ts` does. *Why:* Klaus: a Hold'em simulation showed `+0.0 s` for every move in the list and
  `Time +-1792701431.6 s` in a move's detail, while `game-log.ts` showed `+8.0s`, `+16.0s`, … for the same zip.
  A simulation's records carry virtual time from 0 (`ctx.now()`), but the viewer subtracted the run's wall-clock
  `startedAt`: always in the detail, and in the list on every page that did not hold the start record.
  *Implementation (Claude):* the viewer shows a simulation's time from the row's `t` (the time since the start record,
  which the move list already carries); a played game still shows the time of day from `at`, unchanged. Checks:
  `scripts/e2e/viewer.py` (the simulation's list on a later page and a move's detail match the API's `t`),
  `tests/game-viewer.test.ts` (a simulation's rows: `t` from the start record, virtual times).

## Versions on the board (22 Oct 2026)

- **D-182 · 2026-10-22 · Klaus** — The board's Advanced window (the hammer and wrench, D-128) shows the versions
  running on the table at its bottom, on the table's own board and on remote boards. *Why:* Klaus: "on the board
  window, and the remote board, is there any place where we can see the deployed version numbers? If not, the
  Developer Setting window seems suitable, at the bottom. We would like to see the version numbers of the platform and
  the games that are available." There was none: only `/health` reported the platform's version. *Implementation
  (Claude):* a group *Versions* below *Developer*, its own group because a remote board has no Developer group: the
  platform's release (`APP_VERSION`, stamped at build time; `dev` outside a release build) with the protocol version,
  then every game the lobby offers with its calendar version, sorted by name, those from a game repository (D-097)
  marked *(added)*; small, in two pairs of columns, so the window stays short. The platform's version comes from a new
  `GET /api/v1/version` (`{version, protocol}`, as on `/health`), which remote boards may read; the games' from
  `GET /games`, which the board loads anyway. Checks: `tests/remote.test.ts` (`/version` through a remote board),
  `scripts/e2e/developer.py` (the table's board: the platform and every game with its version, as the last group),
  `scripts/e2e/remote.py` (the same on a remote board).

## The Game Viewer screenshot on the public website, after D-181 (22 Oct 2026)

- **D-183 · 2026-10-22 · Klaus** — The website's Game Viewer screenshot (D-180) is taken again after D-181 fixed a
  simulation's move times, and now shows the page where the second hand starts. *Why:* Klaus: "Do we need to recreate
  the screenshots for the games.skylar.technology site?" and "wait for #169 and then do it". *Implementation
  (Claude):* only `site/game-viewer.webp` showed anything D-181 or D-182 changed. Its first fifteen moves were at
  `+0.0 s`, which is right: AI players in a simulation move at once, and the game's clock moves on only with its
  timers. So `scripts/site-screenshots.py` (`viewer`) now jumps to move 19, where the timer between hands shows and
  the times move to `+8.0 s`. The example prompt names the new log, and the caption says how simulated time moves.

## Fullscreen while playing from the board (23 Oct 2026)

- **D-184 · 2026-10-23 · Klaus** — With *Play from the board* (D-175), Fullscreen takes the whole page, the board and
  the deck beside it. *Why:* Klaus: "when we have the developer option "one player with a on-screen deck" active:
  Fullscreen hides that on-screen deck." The board runs in a frame of `board/play.html`; its Fullscreen button made
  only that frame fullscreen, which covered the deck. *Implementation (Claude):* inside that page the board's
  Fullscreen (and its *Leave fullscreen* label) works on the page around it (`fsDoc`; the page is served by the table
  itself, so it is the same origin). A board on its own is unchanged. `scripts/e2e/board_deck.py`: Fullscreen from the
  board's settings makes the page fullscreen with the deck on screen, and leaves it again; on the old code it fails.

## Mexican Train on the public website (23 Oct 2026)

- **D-185 · 2026-10-23 · Klaus** — The public website shows Mexican Train, the fourth game from extra-games (E-020),
  as a game like the others and as a demo for developers of how far a game can make the table its own. *Why:* Klaus:
  "integrate the new game "Mexican Train" to the website. You can mention that this is a demo game with many
  customizations as developer example." *Implementation (Claude):* a card in the games grid (eight games now; Coin Flip
  is no longer a wide card, so the grid stays three rows) with a board and a phone screenshot from
  `scripts/site-screenshots.py`, where the phone plays its own turns until the trains have grown. The counts and the
  lists of extra-games say eight and four games. A new *Demo game* block (`#showcase`) in the developer section,
  before *Test and debug*, shows the board and six things the game customises: the self-sizing board, the animated
  backgrounds, the restyled seat plates, its sound and music, rule options and table preferences, and its own phone
  screen, all while the platform keeps the lobby, seats and players. Checks: `tests/website.test.ts` (the section and
  the images), `scripts/e2e/website.py` (four extra-games, the block with its image).

## A second look of Mexican Train, and the game service on the public website (23 Oct 2026)

- **D-186 · 2026-10-23 · Klaus** — The website's *Demo game* block (D-185) shows Mexican Train in two looks, and a
  new section at the end, *Run a game service* (`#service`), shows the admin console. *Why:* Klaus: "we could
  showcase also "Lava Lamp" with the numbers instead of tiles - the screenshots exchange when scrolling down the
  page?" and "add one section at the end about the admin console: needs a DNS, but enables remote players to join
  from anywhere, manages multiple boards by issuing tokens and configures games that are made available. Allows to
  download game logs for analysis, and shows this landing page." *Implementation (Claude):* `scripts/site-screenshots.py`
  takes the same moment again with the board preferences Lava lamp and Numbers (`site/mexican-train-lava.webp`); the
  second picture fades in once the first is above the middle of the window, and back when it is below, with a caption
  naming each look. The `admin` step starts a service with extra-games, two tables (the Living room approved by its
  pairing code, the Den by an access code), a spare code, a download token, an AI game on each table and three
  simulations, and photographs the signed-in console: its overview and tables, with its game logs below
  (`site/admin.webp`; the access codes and repositories between them are left out to keep the picture short). The section names what a service needs (a
  server, a DNS name, HTTPS, Google sign-in for admins) and what it adds: remote players from anywhere, tables
  approved by pairing or access codes, the games each table gets, game logs with filters and download tokens, and
  this website. Checks: `tests/website.test.ts` (the section and images), `scripts/e2e/website.py` (the picture swaps
  and swaps back; the section).

## Agentic coding, and an About section, on the public website (23 Oct 2026)

- **D-187 · 2026-10-23 · Klaus** — The website's developer section says the platform is made for agentic coding, and a
  new *About* section (`#about`) ends the page with where the project and its code come from. *Why:* Klaus: "the
  card "You write": we should rather say "You prompt your AI Agent", because it is actually not expected for humans to
  code. Only Prompting", "the platform is optimized for agentic coding, with the developer focusing on the game idea,
  design and user experience", and a short section "about the origin of this project and the origin of the code".
  *Implementation (Claude):* the section's lede says the developer brings the idea, design and experience and the AI
  agent writes the code; the card *You write* is *You prompt your AI agent*, listing what one asks for. *About*, in
  Klaus's words: a do-it-yourself table by friends and a love of board games led to "Human Player First": the rules
  observed and the chores automated, the people at the table paramount; the table as the centrepiece with phones as
  private decks; remote players supported but on the side, with no video, voice or chat on purpose (Meet or FaceTime
  alongside); AI players mainly so a game can start at all. The code: the ideas went to Claude, and Claude Opus 5.5
  developed all of it iteratively; the platform and lobby are separate from the games, which come from other
  repositories; the service's lobby brings remote players in by invite link without exposing the table to the
  internet; hosted by Skylar Technology, with every source public on GitHub. It ends with a prompt to copy for one's
  own agent: set up a table and write a game in one sentence, then fine-tune by playing. The footer links to it.
  Checks: `tests/website.test.ts` (the section; besides the GitHub repositories, the page may link to
  `https://skylar.technology`, still with no resources from elsewhere), `scripts/e2e/website.py` (a screenshot of it).

## A local table from any branch: scripts/local-table.sh (23 Oct 2026)

- **D-188 · 2026-10-23 · Klaus** — `scripts/mac-table.sh` is now `scripts/local-table.sh`, for macOS and Linux, and
  it first brings the checkout up to date: the latest `main` by default, or the branch named with `--branch`
  (`production`, `experiment/card-sling`). No containers are built: Node runs the code. *Why:* Klaus: "Can you update
  that script so that it also does a "git pull" of main per default, or that it accepts a branch, such as
  "production" or "experiment/card-sling" and launches that?" and "This is probably not mac specific. We can rename
  the script "local-table"?" *Implementation (Claude):* the script fetches the branch, switches to it and
  fast-forwards it; it stops instead when the checkout has changes of its own or the local branch has commits GitHub
  doesn't, and `--no-pull` starts the checkout as it is. It runs from a temporary copy of itself, because switching
  branches rewrites the file bash is reading. `npm ci` runs again when `package-lock.json` differs from the one the
  dependencies were installed for. On Linux the QR code's address comes from `ip route`, the table's name from the
  host name, and the board opens with `xdg-open`. An existing `~/.gametable-mac` is still used, so a Mac stays the same
  table; new installs use `~/.gametable-local`. `scripts/mac-table.sh` remains as a two-line wrapper. `--extra DIR` (repeatable) links this repository's games and
  those of another checkout into one folder (`GAMES_DIR`), to try games not released yet, e.g. `CLOUD_URL=
  scripts/local-table.sh --extra ../extra-games`; relative paths count from where the script is started. Tried in a fresh
  clone on Linux: `--branch experiment/card-sling` (installs, serves Card Sling), then the default (back on `main`, no
  reinstall), and a refusal with a local change.

## Slinging cards from the phone to the board (23 Oct 2026)

- **D-189 · 2026-10-23 · Klaus** — The platform lets a player push a card (or a die, a token) up and off the top of
  their phone and see it come onto the board at their seat while they drag; once played, it flies to where the game
  wants it, and a drawn card flies the other way. *Why:* Klaus, after trying the experiment: "The "Sling" works really
  well, looks fantastic", with: the board slower ("perhaps taking 1.5x time. This could be a setting"), starting "on
  the edge of the window, and not on the edge of the player name box … ON TOP of the name box", the phone's tilt "also
  on the board", and "this should be a Platform feature. Consider how to separate platform (i.e. APIs that games can
  use) from games (e.g. the card graphics)"; showing the back "as long as the move is not final" as a toggle; a
  direction of the sling (middle, left or right); other uses such as dice. *Implementation (Claude):*
  - **Live gestures.** `ctx.gesture(data)` on the phone goes over its socket with no answer; the host passes it to
    every board, local and remote, as `{ seat, data }`, and the board calls the game's `gesture(seat, data)` hook.
    Not an intent: no rules, no log, no replay, no other phones. Dropped outside a running game, for players without
    a seat, over 512 bytes or more than one per 8 ms. Remote players' sockets arrive over WebRTC on the same handler.
  - **`/shared/sling.js`.** `slingDeck` on the phone: drag, tilt, threshold (half out) or flick, direction,
    `canSling` (bounce back), `onSling` (the game's intent), `receive` (a drawn card comes in at the top). `slingBoard`
    on the board: a slot at each seat's edge of the window, above the plates, easing toward the latest gesture with
    the phone's tilt; `fly` from where the drag left the card to the game's target; `toSeat` for draws; `flight` for
    anything else. Timings are 1.5 times the experiment's, and `speed()` scales them for a board setting.
  - **The split.** The platform owns gestures, geometry, timing and animation; the game owns the markup
    (`render(item, { back })`), where things land, what a move means and whether a sling is allowed. The board sees
    only the back while dragging unless the game passes `reveal: "drag"`; the face appears when the flight starts.
  - `games/card-sling` (a test game, shown with `SHOW_TEST_GAMES=1`) is the smallest user;
    `scripts/e2e/card_sling.py` checks the back while dragging, the tilt on the board, a fling, a draw and an AI card.

## The board on another screen (23 Oct 2026)

- **D-190 · 2026-10-23 · Klaus** — The board can show on another screen on the same network (an iPad, a TV, a second
  computer) while the table runs on its computer: the board's settings › *Board on another screen…* show a QR code and
  link that move it there. *Why:* Klaus: "I have an iPad and want to use that as a Game Board monitor … the game board
  engine needs to run on the mac … I am OK with it for LAN only", "build the setting for the external monitor or
  iPad. Once we move the board to another browser, we will show the "other board connected" in the mac?", and "add
  documentation about this behavior as a platform feature … so that humans and LLMs can find it". *Implementation
  (Claude):* an exception to D-034 that keeps its point (devices on the network don't get the table's controls on
  their own): `/board/screen?key=<table key>` from a private address (10/8, 172.16/12, 192.168/16, link-local, IPv6
  ULA) sets an HttpOnly, SameSite=Strict cookie derived from the key and redirects to the board, which takes the board
  over at once (`#screen`); later loads of `/board/` from that browser are allowed by the cookie. Never through a
  remote player's channel, never from a public address, never with a wrong key. The window it replaces (D-132) is
  told where it went: "The board moved to another screen … at 192.168.1.34" with *Show the board here*; taken back,
  the screen says "The board moved back to the table's computer". The dialog warns that the link runs the table.
  Changing the table key (`TABLE_KEY`, or the key file of `scripts/local-table.sh`) forgets every screen. No extra
  port: the table already listens on the network for phones. Documented in the README, `llms.txt`, the developer guide
  (section 14), `AGENTS.md` and the Docker runbook. Check: `scripts/e2e/board_screen.py` (an iPad through a relay from
  127.0.0.2, so the table sees another device: no board without the link or with a wrong key, the link and QR code
  in the settings, the takeover, remembered after a reload, the table's notice and taking it back).

## A phone's short messages float over the top (23 Oct 2026)

- **D-191 · 2026-10-23 · Klaus** — A short message on a phone (a refused move, `ctx.toast`) floats over the top of the
  screen for its three seconds instead of being inserted above the tabs. *Why:* Klaus, playing Last Card: "The warning
  on the deck "not a valid card" or similar moves the game status box. Make this warning on top of the status, it
  disappears after a few seconds anyway." *Implementation (Claude):* one `.deck-toast` element fixed at the top (below the safe area), not the shared theme's `.toast`, which is the
  board's and sits at the bottom; fading in and out, `role="status"`; it covers the tabs for a moment and moves nothing. Pause messages
  ("Waiting for …") stay in the page as before: they last as long as the pause. Every game gets this.

## A phone keeps its seat for five minutes (23 Oct 2026)

- **D-192 · 2026-10-23 · Klaus** — A phone that lost its connection keeps its seat in the lobby for five minutes,
  not one, before its player is removed. *Why:* Klaus: "How fast is a "session" for a deck expiring? I think it should
  take longer, like 5 minutes. It should be a default in the code somewhere so that it is easy to change. We do not
  need a user overwrite at this time." *Implementation (Claude):* `DECK_GRACE_MS` in `apps/table-host/src/host.ts`,
  the default for `graceMs`; `GRACE_MS` still overrides it for tests and the e2e checks (which use 1.5 s). No setting
  on the board. Unchanged: during a running game a seat is held with no time limit (D-144, D-159), and the board shows
  the player as away and offers to exchange them.

## The sling's release line (23 Oct 2026)

- **D-193 · 2026-10-23 · Klaus** — A game can give the sling a release line (`line()`): let go of a card with its
  middle above it and it is played, flying to the board toward the middle; below it, it slides back; pushed on to the
  top edge, left, middle or right count as before. *Why:* Klaus, playing Last Card: "I would like to see the notice
  "push a card off the top…" closer to the status box on the deck. If the card is on the status box (ie above the
  "push a card…" text), and let go, it should move to the board to the middle direction. If it is not let go, the
  player can move it back or go to the top for left, middle, right." *Implementation (Claude):* `slingDeck` takes
  `line()` (a clientY); while the card's middle is above it, the card and the area have the class `sling-armed` (for
  the game to show it); letting go there glides it straight up and off (220 ms, its last poses reaching the board),
  then `onSling(id, { direction: "middle" })`. Without `line` nothing changes. Documented in the developer guide
  (section 10).

## Slung and drawn cards without a jump at the seat (23 Oct 2026)

- **D-194 · 2026-10-23 · Klaus** — A card thrown to a player's seat (a draw) lands and slips off the board's edge in
  one movement, and a card being slung shows exactly where its flight then starts. *Why:* Klaus: "The board
  animation for the draw is also a bit imprecise. The card travels from the deck to the player, pauses for a split
  second, then jumps to the left by about 1/2 card to disappear. It should not jump." *Implementation (Claude):* the
  slot at a seat's edge placed the card half its width left of the point `pose()` (and so every flight) uses; it is
  centred now. And a thrown card slipped off the edge at the speed that follows a finger (half the way per frame),
  dropping half a card in the first frame; it eases off gently now (`ease`, about a third of a second at normal
  speed). Checks in `scripts/e2e/card_sling.py`: the card at the seat is where the phone says (within 12 px), and a
  drawn card's first frame in the slot is where its flight ended (same x, within 30 px down).
## Sound after the first tap (23 Oct 2026)

- **D-195 · 2026-10-23 · Klaus** — A board in a browser that holds sound back until the page is touched plays sound
  after the first tap, and says so until then. *Why:* Klaus: "Backgammon sounds: I could not hear them on the main
  board on a different URL, not localhost." Browsers allow sound only after the user has touched the page; the
  table's kiosk browser allows it from the start, so this showed only elsewhere (an iPad, another computer, the
  table's network address, D-190). *Implementation (Claude):* the board woke the audio on `pointerdown` only (D-092),
  and a finger's pointerdown is no permission for sound (Chrome and Safari take its pointerup, `touchend`, a click or
  a key), so on a touchscreen the sound stayed off for good, and nothing said why. It now wakes on all of these. A
  board with sound on whose audio is not running 1.5 s after loading (a browser that allows sound runs by then) shows
  a small *Tap to turn the sound on* at the top; any tap on the board turns the sound on and the note goes. Not with
  sound switched off in the settings. Klaus then found Coin Flip silent too: "It looks like the browser lost the audio
  access." A browser can also take the sound away later (Safari's "interrupted": a locked screen, the tab in the
  background), and the board kit resumed only a "suspended" audio; it now resumes any that is not running (and makes a
  new one if it was closed), and the note comes back whenever the sound stops. Check: `scripts/e2e/sound_hint.py` gives the page the strict rule (headless
  Chromium plays sound whatever its autoplay flag): the note shows and goes with the sound setting, a finger's
  pointerdown alone does not turn the sound on, a tap does and the note goes; sound taken away again brings the note
  back and a tap the sound; and a browser that allows sound never
  shows it. With the old wake-up on pointerdown, the check fails.
## Last Card and the sling on the public website (23 Oct 2026)

- **D-196 · 2026-10-23 · Klaus** — The public website shows Last Card and the sling. Klaus: "update the landing page
  with the new game. Come up with an idea to showcase the sling feature, at minimum mention it as part of the platform
  features that games can use." *Implementation (Claude):* Last Card joins the games (nine in all, five from
  extra-games) with its board and phone, and four of its awards get a tab. *The platform does* lists the sling. A new
  block after the Mexican Train demo, *Platform feature: the sling*: a schematic in the style of the page's first
  animation (Klaus then: "we could make a schematic demo that shows how a card moves from the deck to the board,
  perhaps similar to the first animation on the landing page"), an SVG of a phone in front of the tilted board: a card
  is pushed off the top of the phone, its back peeks in at Klaus's seat while the finger is down, then it turns face
  up and flies onto the pile; three numbered steps light up with it (one 6 s CSS loop, still with reduced motion).
  Beside it: live gestures, push, flick or let go, the rules still decide, and the few lines a game writes
  (`slingDeck`, `slingBoard`, the `gesture` hook). Below, the real thing: one moment of Last Card on Klaus's phone (a
  card half off the top) and on the board (its back over Klaus's seat plate). And *Play at home* says an iPad makes a
  small game board, good enough to try or test a game (*Board on another screen…*, D-190); Klaus: "We can mention that
  an iPad can be used as a small game board, at least for testing." The marquee lists Mexican Train and Last Card.
  `scripts/site-screenshots.py` plays Last Card from Klaus's phone (tap to play), waits for a turn with a card that
  fits, holds one at the top edge and takes both screens (the board cropped around the seat). Check:
  `scripts/e2e/website.py` counts five extra games, checks that the schematic moves and has its three steps, that
  the real phone sits beside the board with both pictures loaded, and the iPad note.
## Glossary, website terms, cookbook and architecture (24 Oct 2026)

- **D-197 · 2026-10-24 · Klaus** — A glossary in the repository, and terms of service for the website. *Why:* Klaus:
  "Do we have a glossary somewhere? If not, we could do a glossary.md and link it from the README … Ideally we are
  using these terms also in the code"; "seat-plate is fine. Use the terms that you are using in the software"; "Also
  explain the seating names North, South, etc."; and "We need to add 'Terms of Service' to the landing page … at the
  bottom to the right of the version string in the same line … basically denying any warrantees or responsibility,
  pledging compliance with copyrights and trademarks - and concerns should go to klaus@skylar.technology."
  *Implementation (Claude):*
  - **`docs/glossary.md`** (repository only, not served by the website): the table, the seats and their names, people,
    joining and running a table, games, the sling, tools and the game service. Each term is the one the software
    uses, with its names in the code and the words to avoid (for example *seat plate*, not *player box*; *AI player*,
    not *bot*; *watcher*, not *spectator*). *Seats and their names* explains the edges (south at the bottom of the
    screen's picture, west on the left of a south player), the compass names for one, two or three seats on an edge,
    the layouts in seat-number order (from `seatName()`), and a diagram. *Where the words still differ* lists the
    remaining mismatches (*admin portal* for the console in a few places; *cloud service* and *game service*; *deck* in
    code, *your phone* for players). The README and `AGENTS.md` link to it.
  - **Terms of service** at `/terms` (`apps/cloud/public/terms.html`), linked as *Terms of service* right of the
    version label at the foot of the website, on its line. They cover the website, the service and the software: what
    Game Table is (entertainment, no real money), no warranty ("as is"), no liability as far as the law allows, fair
    use, what is recorded, copyrights and trademarks (a pledge to respect them; no affiliation with trademark owners;
    other repositories' games under their authors' terms) with concerns to klaus@skylar.technology, the MIT licence,
    changes and contact. The players' terms at a table (`shared/terms.md`, D-163) stay as they are and are named as
    applying too. Checks: `tests/cloud.test.ts` (the page, the link beside the version, the address, no glossary on
    the website) and `scripts/e2e/website.py` (the link on the version's line, the page opens).
- **D-198 · 2026-10-24 · Klaus** — A cookbook for people working with an AI agent, and an architecture overview, in
  the repository. *Why:* Klaus: "a 'cookbook for humans, assisted by AI' with some sections - we always assume that a
  LLM does the actual work, the cookbook would tell how to ask a LLM to do the right thing", with recipes for a local
  table with the extra games, a simple game ("the Yahzee prompt, which actually works, i tested it"), private games,
  a game service of one's own with DNS, HTTPS and real remote players (and what the console does), and a game
  checklist; "We could also provide a Architecture overview"; and "the standard github pipeline: branch conventions
  (names, protections), tests, deployment (which needs to be customized, as 3rd parties can't install in our
  cluster)". *Implementation (Claude):* `docs/cookbook.md`: habits with an agent, then six recipes, each with what
  you need, the prompt to give and how to tell it worked: 1 play fast (the runbook's Parts A and B1, or
  `local-table.sh --extra`; an iPad as the board), 2 build a game (the website's Yahtzee prompts), 3 private games (a
  private repository, at home by cloning, on a service with `GAME_REPO_TOKEN` and ticks), 4 one's own game service
  (the console's sections; Part C to try it; for real remote players a domain, DNS, HTTPS, a Google OAuth client and
  optionally TURN), 5 the game checklist (idea, what is on the phone and on the board, rules, awards, placement,
  settings and preferences, the developer settings under *Advanced*, customization, each with a prompt and the
  guide's section), 6 the GitHub pipeline (branches and their protection as GitHub has them: `production` requires
  test, codeql and e2e and an up-to-date branch, `main` is unprotected; kebab-case feature branches,
  `experiment/<name>`; squash to main, a merge commit to production; versions and decision records; extra-games tested
  against games-service `main`; the deploy workflow runs only in this project's cluster, so a fork replaces it, with a
  prompt for Docker Compose and Caddy). `docs/architecture.md`: the parts and their connections (diagram), a game's
  folder, how a game runs from an intent to the views (diagram, setup, timers, AI pacing, the end and replay), what
  the platform and the game each own, how the screens load a game's modules, and where to look in the code. The
  README and `AGENTS.md` link to both.
- **D-199 · 2026-10-24 · Klaus** — A review of the documentation, the links and the decision records. *Why:* Klaus:
  "do a complete review for documentation accuracy, ensuring that the README and other documents actually describe
  the software as it is today", "make sure that all links in the documentation and the landing page actually
  resolve", and "Review the ADRs for historical correctness, and flag any content that refers to the private
  repositories." *Implementation (Claude):* every document was checked against the code.
  - **README, `llms.txt`, the table-PC kit:** five games in extra-games; the test game Card Sling; the board served to
    another screen (D-190); the phones' `lobby.rename`, `lobby.leave` and `game.gesture`; `GET /version`; the new
    docs, the sling and the terms in the layout; *console*, not *admin portal* (also the website's link once signed
    in); `ALLOW_REMOTE_BOARD`; the browser checks list. The table PC's `env.example` no longer sets `GRACE_MS=60000`,
    so tables keep D-192's five minutes.
  - **Developer guide:** awards' `null` rules, the AI's timing, errors and worker, `whenIdle` pacing (the table's
    board only, 20 s at most), the phone's repeated events, the sling's full options, `onSeatChanged`'s argument,
    `canContinueWithout`, Leave and rejoining, `turnModel`, the test harness of a game repository, Coin Flip's real
    manifest.
  - **Runbooks:** extra-games from `production` with its five games, waiting for `/health`, what deleting `.env`
    removes, `GAME_REPOS` replacing the default, the restore marker (an empty marker after a clean restart brings back
    the same state, so going back is `previous`), and an empty start without a snapshot. `kube-setup-request.md` is
    marked as deployed and no longer says the state is in memory.
  - **Rules for players** of the built-in games: leaving a game is an exchange now (Coin Flip, Hold'em, Pachisi,
    Roulette); Hold'em's short all-in; Pachisi's result screen. Their versions are set anew.
  - **The glossary, cookbook and architecture** (D-197, D-198): their code names, a game without a person at the
    table, the pipeline per repository, the code map.
  - **Links:** every relative link and anchor resolves; every web link answers, except ones the review could not
    reach from its network (skylar.technology, img.shields.io) and `/terms`, which is new with this release.
  - **Decision records:** D-127, D-128 and D-129 were each used twice; the second ones are D-127b, D-128b and D-129b,
    and code and docs follow. Six cross-references are corrected (D-055, D-056, D-057, D-113, D-148, D-159), section
    headings match their dates, and a table at the top lists the records later ones changed.
- **D-200 · 2026-10-24 · Klaus** — Private repositories in this public repository: their names may stay, details
  about them go. *Why:* Klaus: "Using the names loopy and star forge is fine, as long as there are no game details or
  screenshots. About Kube-setup, I follow you recommended path." *Implementation (Claude):*
  - **The cluster repository:** `docs/kube-setup-request.md` (the deployment request, with cluster internals) is
    removed from this repository; it was posted to the cluster's own channel for the cluster repository to keep.
    Comments, the README and the state runbooks say *the cluster repository* instead of naming it. The deploy
    workflow still clones it by name, which it needs to deploy. Earlier records keep their wording as history.
  - **Loopy and Starforge:** named where it helps, without their game details: decision records that described
    their rules, awards, AI levels, code or origin now say only what the platform decision needed. The test fixtures
    and `deploy/game-repos.json` use the names only. The website has no screenshot of either.
- **D-201 · 2026-10-24 · Klaus** — The phone gives a game each message's events once, as the board does. *Why:* the
  review (D-199) found that the phone called the game's `update` again with the last events whenever the lobby
  changed or the page redrew, so a game could animate the same move twice; Klaus: "fix the phone repeating events
  like the board does". *Implementation (Claude):* `deck.js` marks a game message's events delivered once the game has
  them; later redraws pass `[]`. The developer guide says so. Check: `scripts/e2e/card_sling.py` wraps the phone's
  game module, counts the events each `update` gets, and toggles the sound twice after a draw: those redraws get none
  (with the old code they got the draw's event again).
- **D-202 · 2026-10-24 · Klaus** — Security hardening from a whole-repository review. *Why:* Klaus asked for a
  simplify pass over both repositories and to "take special care about security concerns"; the reviewers found these.
  *Implementation (Claude):*
  - **A phone could inject script into the table's board.** A sling gesture's `item` went to every board as the phone
    sent it, and the card kits (Card Sling here, Last Card in extra-games, E-029) put its values into SVG unescaped;
    the board page holds the table key. The host now passes only the sling's fields, each of its kind (`cleanGesture`),
    and both card kits draw only known colours and values.
  - **Board access in one place:** `boardAllowed` refuses requests over remote play itself, instead of every route
    remembering to; the routes' own checks go. Served files must be inside their folder (`root` plus a separator),
    not merely start like it.
  - **Connections and moves:** a socket that has not said hello is closed after 10 s, and at most 16 may wait; each
    connection may send 40 intents at once, then 20 a second ("Too many moves at once"), never logged. Remote play's
    virtual sockets get the same 64 KiB message limit as real ones.
  - **The service:** `same()` compares secrets as bytes and can no longer throw (a non-ASCII header of the right length
    made it fail, which told the admin token's length); an uploaded log's `run.json` is read with a 1 MB limit while it
    inflates, so a zip bomb is never held in memory; a table may hold 50 open invites; the per-address rate-limit maps
    drop expired entries once they grow large.
  - **Not changed here, for a decision:** remote play runs the table's board and game code on the service's own origin,
    beside the console (a separate host for the console, or for play, would isolate them); remote access is split over
    several lists with reads allowed by default (one route table with access per route would be one gate); the lobby
    state is filtered for remote clients by removing fields, not by listing what they may see; ticking an extra-game
    repository trusts its code fully on that table.
  - Checks: `tests/security.test.ts` (the compare, a zip bomb, the gesture fields); the browser checks for the sling,
    remote play, watchers, the board on another screen and a full table pass.
- **D-203 · 2026-10-24 · Claude** — Clean-ups from the same review, no change in behaviour: `GameRuntime.aiTakeover`
  (unused since D-159) and the AI worker's `busy` go; one `isInput` for replay and the move list; `close()` uses
  `unselect()`; one session-token helper and one join-token loop; *Ready* tapped twice no longer broadcasts the lobby;
  the sling's gesture payload is built in one place and its listeners come off with one `AbortController`;
  `playerColor` no longer reads `seatColors` (always empty since D-159); stale "EXPERIMENT" comments on the sling are
  gone; the website's lobby demo pauses its progress bar off screen, with one step length.
- **D-204 · 2026-10-24 · Klaus** — The console gets a host of its own, games-console.skylar.technology (`CONSOLE_URL`).
  With it set, the console, `/admin/api`, Google sign-in and the session cookie (`__Host-`, host-only) live only on
  that host; there `/` is a page with a Sign in link (where logout lands) and everything else answers 404. On the
  public host `/admin` and `/auth/*` redirect to the console's host and remove a session cookie left from before, a
  session is never accepted, and the website's *Admin* link points to the console's host. A cookie-authenticated
  change must come from the console's origin. `ADMIN_TOKEN` works on both hosts. `GOOGLE_REDIRECT_URI` must be the
  console's callback; `scripts/sync-secrets.sh` puts `CONSOLE_URL` into the `games-oauth` Secret, and the deploy's
  smoke test follows the redirect and checks the console's host the same way. Unset, nothing changes. The cookie
  stays `SameSite=Lax`: both hosts are the same site, so `Strict` would not separate them, and it would drop the
  cookie on the redirect back from Google. *Why:* an invite page runs the board and phone pages that the inviting
  table sends, game code from its extra-game repositories included, on the public host; with the console on the same
  origin that code could call the console's API with a signed-in admin's cookie. A separate host puts the session out
  of its reach; moving remote play instead would break every invite link, and hardening within one origin leaves
  ways around it.
- **D-205 · 2026-10-24 · Klaus** — Production runs with the console on games-console.skylar.technology (D-204): its
  DNS record, the Ingress host with its own certificate (kube-setup), the redirect URI in the Google client, and
  `CONSOLE_URL` in the `games-oauth` Secret. `scripts/sync-secrets.sh` now requires `CONSOLE_URL` and the console's
  callback as `GOOGLE_REDIRECT_URI`, and the documentation names the console's address where people approve a table.
  A local service still has its console at `/admin`, without `CONSOLE_URL`. *Why:* the switch is done; a `.env`
  without it would quietly put the console back on the public host.
- **D-206 · 2026-10-24 · Claude** — The cloud image creates `/data` owned by uid 1000, like the table host's image:
  a new Docker volume there was root's, and the service, which runs as uid 1000, stopped at start with `EACCES` on
  `/data/snapshots` (`deploy/docker-compose.yml`, and runbook Part C). The cluster's PVC hid it. The development
  compose file offers only the public extra games (`GAME_REPOS_FILE: none`, `GAME_REPOS`), like `deploy/local`, since
  a local service can't read the private repositories in `deploy/game-repos.json`. `scripts/local-table.sh` names the
  console's address for the live service and says nothing about pairing without one. *Why:* found by following the
  getting-started steps on a fresh machine.
- **D-207 · 2026-10-24 · Klaus** — `scripts/mac-table.sh`, the old name of `scripts/local-table.sh` (D-188), is gone.
  `local-table.sh` still reads `~/.gametable-mac`, so a table first set up under the old name keeps its identity and
  API key. *Why:* the alias only ran the other script; one name is clearer.
- **D-208 · 2026-10-24 · Klaus** — A Windows PC with Docker Desktop runs a table without WSL or Git Bash:
  - **`deploy/local/setup.ps1`** is the PowerShell twin of `setup.sh`. It writes the same `.env`: the address of the
    up adapter with a default gateway, Wi-Fi first, no virtual adapters (WSL, Hyper-V switches, Docker, VPN), else the
    source address of the route to the internet; a random
    table key; and `-Cloud`, `-LanIp`. The file is UTF-8 without a byte order mark, with LF line ends, and readable
    only by the user.
  - **`-Start`** also checks that Docker is running, runs `docker compose up -d --build`, waits for `/health` and
    opens the board.
  - **The scripts** are ASCII only, since Windows PowerShell 5.1 reads a file without a byte order mark in the
    system's code page.
  - **Windows CI:** a `windows` job in the PR checks runs `scripts/windows-check.ps1` on GitHub's Windows runner. It
    runs `setup.ps1` in Windows PowerShell 5.1 and PowerShell 7 (address, key, no byte order mark, LF, kept on a
    second run, `-Cloud -LanIp`, a wrong address refused), and has Docker Compose read the `.env` where the runner
    has Compose. It also starts the Table Host natively on Node and checks `/health`, the board, the shared files,
    the games, a simulation that replays exactly, and that backslashes in a request reach no file outside the served
    folders.
  - **Limit:** that runner has no Linux containers, so the images are built and run by the Linux jobs. The runbook
    has a section *On a Windows PC*; its other commands run in Git Bash.

  *Why:* Klaus asked for a Windows 11 PC, with Docker Desktop as the focus.
- **D-209 · 2026-10-24 · Klaus** — Relays for remote players from Cloudflare's TURN service:
  - **What happens:** with a Cloudflare TURN key (`CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN`, created in the Cloudflare
    dashboard), the service asks `rtc.live.cloudflare.com` for credentials that expire after a day. It keeps them,
    renews them when less than half their life is left, and asks once for connections that arrive together. Each
    connection's hello and offer carry them to the remote browser and to the table.
  - **What it leaves out:** URLs on port 53, which browsers refuse, so each one only adds a timeout. The key itself
    never leaves the service.
  - **When Cloudflare fails:** the current credentials are kept while they're valid; after that, the old STUN list
    is used (`ICE_SERVERS`, or Google's STUN), with a minute between attempts.
  - **Configuration:** `scripts/sync-secrets.sh` carries the key into `games-oauth`.
  - *Why:* an iPad on an iPhone hotspot could not connect to the table, while a remote player on another home ISP
    earlier the same day could, with the same connection code. The phone carrier's NAT blocks a direct WebRTC
    connection, and the service handed out only STUN. Cloudflare instead of coturn on the cluster: no ports to open
    at home and no new exposure there, credentials made by Cloudflare per request, a free allowance. WebRTC uses a
    relay only when the direct way fails.
- **D-210 · 2026-10-25 · Claude** — The deck's background gradient is painted once, then the felt colour it ends in.
  Repeated, it showed a seam, bright against dark, where a deck was taller than its window, e.g. the deck beside a
  remote player's board. *Why:* Klaus's screenshot of a remote deck in Backgammon.
- **D-211 · 2026-10-25 · Klaus** — Relays are documented as an option, and a key problem shows at start:
  - **Documentation:** `docs/runbooks/remote-play-relays.md` says when a relay is needed (a phone's hotspot or
    cellular data, some strict networks; not a table on one network, rarely home internet). It covers how
    Cloudflare's works, setting it up (including this cluster's `KUBECONFIG` and restart), checking it from the log
    and with a phone on cellular data, rotating or removing the key, another TURN server through `ICE_SERVERS`, and
    troubleshooting. The README, the cookbook, the glossary (*Relay*) and `llms.txt` link it, so agents find it.
  - **At start:** the service asks Cloudflare once, logging `Cloudflare TURN: relay credentials ready` or the
    failure, so a wrong or revoked key shows before the first remote player.
  - **Graceful degradation, unchanged:** without the key, or when Cloudflare fails, STUN only, as before D-209;
    remote play works wherever a direct connection does.

  *Why:* the hotspot test worked with the relay. Developers and other services without a Cloudflare account must
  not depend on it.
- **D-212 · 2026-10-25 · Claude** — Favicons for every browser:
  - **Files:** the board, the deck and the website's pages link, besides the SVG favicon, a 32 px PNG and a 180 px
    Apple touch icon, all rendered from the same SVGs.
  - **Routes:** the Table Host and the service answer `/favicon.ico` (16 and 32 px inside) and
    `/apple-touch-icon.png` at their root, where browsers ask without a link.
  - *Why:* Safari, on a Mac and an iPad, shows no SVG favicon, so a table at `localhost:8080` and the website had
    a blank icon there.
- **D-213 · 2026-10-25 · Claude** — Tests that play many moves from one deck play within the host's intent limit (D-202),
  and a test does not take the log's last entry for one it is waiting for.
  - **The flake:** the Pachisi test that plays a whole game through two decks sent intents in a tight loop of 400
    rounds. A deck sending faster than 20 a second got "Too many moves at once", and each refused intent still used a
    round; some games ran out of rounds unfinished, and waiting for the finished lobby state timed out ("timed out
    waiting for message", `tests/helpers.ts`). It failed on 2026-10-24 and 2026-10-25, and about one run in ten alone.
  - **The fix:** `Deck.intent()` sends a game intent and, when the limit refuses it, waits for the next token
    (`INTENT_RATE`, now exported) and sends it again. The Pachisi test counts only accepted moves and fails at once on
    any other refusal. Under CPU load the AI-options test in the lobby tests found an AI's move after the
    `aiOptions` note; it now looks for the last such note.
  - *Why:* the limit is the platform's and stays as it is; a test that plays faster than a person waits for it,
    rather than a longer timeout or more rounds.
- **D-214 · 2026-10-25 · Klaus** — The console shows who plays from elsewhere right now:
  - **What the table sends:** each table's heartbeat (every 15 s) carries counts: its remote players, how many of
    them are connected (a dropped one keeps the seat, away), and its watchers. No names.
  - **What the service does with them:** keeps them in memory, not in the database, and shows them only while the
    table is online. On the table's row: "2 remote players, 1 away · 1 watching". On the Overview: tiles for remote
    players and watchers connected now, over all online tables.
  - **Delay:** a drop shows within one heartbeat.
  - *Why:* the service saw only the handshake of a remote connection, not who stayed. Counts answer "how many play
    from elsewhere now" without storing who.
- **D-215 · 2026-10-27 · Klaus** — The board's settings window during a game:
  - **Locked values look locked:** the game's own settings, fixed once a game runs (D-090), are dimmed and marked
    "🔒 locked during the game".
  - **A game's switches show their change at once:** the window redraws on game updates as well as on lobby
    changes. Backgammon's *Undo (both players)* changed the game, but the open window kept showing the old choice
    until it was closed and opened again, because a game's change arrives as a game update, not a lobby state.
  - *Why:* Klaus switched Undo during a match, saw nothing change, and took the locked start value above it for the
    switch. Extra-games' Backgammon browser check now checks the switch shows *Off* right after the tap; it fails
    without this change.
- **D-216 · 2026-10-27 · Klaus** — Players go through the awards on the way to the results:
  - **The end screen:** a game that ended by itself shows one button, *Awards and Results ›*, where it showed
    *Show result* and *Statistics* side by side (D-140, D-149). It opens the statistics window, now titled
    "Awards and Results". Its *Done*, a tap beside it or Escape lead to the results in the lobby, as *Show result*
    did.
  - **Games without awards or a table** keep *Show result ›*, since there is nothing to show first.
  - **Elsewhere:** the button on the results page and in the Game Viewer is also *Awards and Results*; there,
    *Done* only closes the window.
  - Each board moves on by itself, as before (D-091).
  - *Why:* the awards were easy to skip; this way every table sees them.
- **D-217 · 2026-10-27 · Klaus** — *Awards and Results* sits in the game's corner of the board, where *Show result*
  sits, not 214 px in from it. It stood beside *Show result* when both were shown (D-149); since D-216 it is the only
  button there, and the gap looked like a misplaced button. Both buttons share one rule for the corner.
- **D-218 · 2026-10-27 · Klaus** — Play from the board (D-175): the deck beside the board no longer greets with
  "session expired; scan the QR code to join again". A session it saved in an earlier run (the table restarted, or the
  setting was off in between) is dropped quietly and the name form shows: that deck takes its seat with the table
  key, so there is no QR code to scan. A phone keeps the message.
- **D-219 · 2026-10-27 · Klaus** — The *Game Table service* group with the table's access code (D-113) moves from
  the board's settings to the Advanced window (the tools button), after *Developer*. A code is set up once, and the
  settings keep what is changed while playing. The waiting notice says "or enter an access code in Advanced".
- **D-220 · 2026-10-27 · Klaus** — When the table's access code has less than 3 hours of validity left, the lobby
  says so on the line of the table's name, on the right, in red: "Access code expires in 90 minutes". It counts down
  in minutes by the board's one 30-second tick (the same that counts the code down in Advanced). Past its end it says
  "Access code expired": the table keeps working until an admin disconnects it (D-113). The table's own board only;
  a remote player can do nothing about it.
- **D-221 · 2026-10-27 · Klaus** — A watcher's own board, which has no settings, gets two of them in the eye's window:
  *Your name* with *Change name* (the board's name pad; made unique as when they came in, also during a game, since a
  watcher is not a player) and *Fullscreen*. That window tells them how they could play — the table's board can let
  them take a free seat before a game or exchange a player for them during one — instead of pointing to Settings,
  which they don't have; the invite page's note points to the eye. `POST /api/v1/watching/name {name}` is for a
  watcher's own board only; their state carries `remote.watcherId`, so their board finds itself in `watchers`.
- **D-222 · 2026-10-27 · Klaus** — A player whose seat the board handed to an AI player (D-159, "Ann (AI)") gets it
  back by joining again with their name: during the game as an exchange does (the AI goes, the game goes on with them),
  after it straight away, with their colour. Before, D-172 gave the seat back only while it waited, and once an AI had
  it, joining as Ann found no seat or another one, under a name typed again. The AI player remembers whose seat it
  took (`standsInFor`). Beside the board (D-175), *Take your seat back* joins under the deck's last name without the
  name form; a phone is told to join with the same name. Someone with another name doesn't get the seat.
- **D-223 · 2026-10-27 · Klaus** — Exchanging the last player at the table (`developer.protectedPlayer`) for an AI
  player, a remote player or a watcher asks first, and says that without a player at the table the next game needs
  the developer setting *Games without a player at the table* (D-118): on the table's board the confirmed exchange
  switches it on (`allowNoLocalPlayer: true` with `POST /exchange`), so nobody has to find it under Advanced. A remote
  board can't change the developer setting, so its question says the table's board has to. The lobby's reason a game
  can't start names the setting too. *Why:* after the last player left, two ready AI players could not start, and it
  was not clear why.
- **D-224 · 2026-10-27 · Klaus** — A game's manifest may give its AI players a notice, `ai.notice` (plain text, up to
  600 characters, `https://` links become links), which the board shows under the AI player's options, where they
  are configured in the lobby and where an AI player's options are changed during a game. *Why:* Backgammon's
  strongest AI players use wildbg's networks (extra-games E-039), and their credit and licence belong where the
  strength is chosen. Older tables ignore the field.

- **D-225 · 2026-10-28 · Klaus** — Every label in the console explains itself on hover. A repository added in the
  console is marked *console*, not *until restart*: since D-114 it is kept across restarts, until removed.
  *Why:* the *until restart* label (from D-098) was wrong after D-114, and the status labels (table, access code,
  how a game ended, *sim*) had no explanation.
  *Implementation (Claude):* `admin.html` keeps the meanings in `TIPS` and adds them as `title` with `pillTip`;
  `scripts/e2e/extra.py` checks the new label and that no label in the console is without a tooltip.
- **D-226 · 2026-10-28 · Klaus** — An AI player's play style may be picked at random when it is added, and the
  board's settings window shows how each AI player plays, beside its name, with a tap to change it, also during a
  game. *Why:* a game with several AI characters: a table should meet a mix of them without anyone choosing, see which
  one is which, and change one during the game without going through the exchange window.
  *Implementation (Claude):* an AI option in the manifest may say `"random": true` (protocol `aiOptionSchema`); the
  table gives a new AI player a random one of its `values` when it is added with the game chosen, when the game is
  chosen, and on an exchange to an AI player (`pickRandomAiOptions`), and keeps it on the player, so the lobby, the
  settings and the log show it and choosing the game again doesn't change it. Simulations use the default unless the
  request gives options, so runs stay comparable. In the settings window's players, an AI player's row shows its
  option values as a button (`trader`; label and value on hover, cut short with an ellipsis when long): during a game it opens *How this AI player plays from its next move on*
  (the exchange window's form, now `editAiOptions`), before one the AI player's window. A remote board without board
  control shows the text only.
- **D-227 · 2026-10-28 · Klaus** — A game played from all four edges keeps the lobby's corner arrows during the game,
  and they face it toward any edge; it has no turn button, and its *Lobby* button moves beside its corner to make
  room. *Why:* in a game with players on every edge (four players around the table) each of them should be able to turn the
  board to them in one tap, and the north/south turn button doesn't help the players on the sides. Games with a front
  (Chess, Backgammon) keep north/south. *Implementation (Claude):* manifest `facing`: `north-south` (default) or
  `any`. For `any` the table reports its facing, any of the four, as `gameFacing` (so `info.frontEdge` and the phones'
  `boardEdge` follow); the board shows `#corners` during the game, hides the turn button, places Advanced as in the
  lobby, and gives the Lobby, Show result and Awards buttons the class `beside` (102 px from the corner, along the
  edge). The Duel test game uses it; `scripts/e2e/facing.py` checks the arrows, the missing turn button, that no
  platform button covers another, and that the east arrow turns the game.
- **D-228 · 2026-10-28 · Klaus** — In the lobby every game tile is as tall as the tallest of all the games, on any
  page, so paging through the games doesn't move the pager and the buttons below it.
  *Why:* the tiles took the height of their own text (a description of up to three lines, a hint that may wrap), so a
  page of short descriptions was lower and the pager jumped up or down while paging.
  *Implementation (Claude):* after the lobby is drawn, `sizeTiles` lays out all games' tiles once, unseen, at the
  grid's width, and sets the tallest as `--tile-min` (the tiles' `min-height`, at least 120 px as before). It measures
  again only when the tiles' text or the width changes (games added or removed, a game's hint as players come and go,
  a narrower remote board), not on every redraw. `scripts/e2e/play.py pages` pages through all games, before and after
  a player sits down: one tile height, the pager in one place.
- **D-229 · 2026-10-28 · Klaus** — A window that scrolls keeps its scrollbar inside its rounded corners. *Implementation
  (Claude):* Awards and Results keeps its head (title, Turn to, Done) fixed and scrolls the rest in an inner box, set
  in from the right and bottom edges; every overlay panel is clipped to its rounded shape and has the thin brass
  scrollbar.
- **D-230 · 2026-10-28 · Klaus** — In the lobby a selected player is deselected by a tap anywhere but a seat, its
  Configure and Remove buttons, or a window; and leaving an AI player's Configure window, any way, deselects it too.
  A tap on another seat still moves the selected player there (D-086).
- **D-231 · 2026-10-29 · Klaus** — Games should offer 12 or more awards. The developer guide (section 8 and the
  checklist) and the cookbook recommend it; the platform sets no limit and shows every award a game hands out.
  *Why:* an award shows only when someone stands out, so a game with few has a thin end screen; today the games offer
  between 0 and 15 (Roulette 15, Last Card 10, Chess and Loopy 8, Hold'em 7, Backgammon 6, Mexican Train and
  Starforge 5, Coin Flip 4, Pachisi and Liar's Dice none). A display cap of 12 was considered and not taken. Which
  games get more awards is decided per game later.
- **D-232 · 2026-10-29 · Klaus** — In the console, a repository's *Refresh* is disabled ("Refreshing…") from the click
  until the answer comes, so a double click starts one fetch. After 30 s without an answer (GitHub unreachable, for
  instance) the console stops waiting, says "Repository discovery for … didn't finish in 30 s (GitHub may be
  unreachable); try again", and *Refresh* works again; an error from the service shows the same way at once, and the
  next successful refresh replaces the message. *Add* waits at most 30 s the same way.
  *Implementation (Claude):* `admin.html` keeps the repositories being fetched in `repoBusy`, so the console's
  10-second redraw keeps their button disabled, and its `api()` takes a time-out (`AbortSignal.timeout`). The service
  already shares one fetch per repository and gives up on GitHub after 60 s. `scripts/e2e/extra.py` lets its fake
  GitHub hang: a double click makes one request, the button stays disabled through a redraw, the message comes after
  30 s with *Refresh* usable, and the next refresh succeeds.
- **D-233 · 2026-10-29 · Klaus** — Awards and Results opened from a game's last screen has **Back to game** beside
  *Done*: it closes the window and shows the game's last screen again, with *Awards and Results* still in its corner;
  *Done* still leads to the results in the lobby (D-216). Opened elsewhere (the results page, the Game Viewer), the
  window has only *Done*, as before.
- **D-234 · 2026-10-29 · Klaus** — In the lobby, an AI player's seat plate shows how it plays after *Ready*, on the same
  line: the values of the chosen game's AI options, such as a play style or a strength ("Ready · trader", Chess's
  "Ready · own engine · 1200"). *Why:* the table should see which AI player is which character or strength before the
  game starts, without opening the settings. *Implementation (Claude):* the same text as the settings window's
  players (D-226), from one helper (`aiPlays` in `board.js`), with each option's label and value on hover; a long
  value is cut short with an ellipsis inside the plate. A game without AI options shows *Ready* only.
  `scripts/e2e/ai_style.py` checks the plates.
- **D-235 · 2026-10-29 · Klaus** — **Badges** are a general idea for games: a small tab on a seat plate naming
  something lasting about that player, *Winner* first. For now it is a convention in the developer guide (*Badges on
  seat plates*: where, how it looks, from the view, keeping clear of it), with no common code until a second game
  uses one; then the platform draws them (an option of `seatPlates()`). The cookbook has the request to give a game
  one. *Why:* one game has a Winner badge; others should look and behave the same, without platform code built for a
  single user. *Implementation (Claude):* the guide's rules follow that first badge (a gold tab, 18 px above the
  plate's top edge, 22 px from its right end) and what it taught: boxes near the plates must leave room for a badge.
- **D-236 · 2026-10-30 · Klaus** — A table rule *A player away this long is replaced by an AI player*: off (the
  default), 3 or 5 minutes. With it on, a player of the running game, at the table or remote, whose phone or browser
  has been away that long (or who left the game) gets an AI player in their seat, as *Exchange › AI player* would.
  It amends D-159 for tables that choose it; off, a seat waits as D-159 says and replacing someone stays the table's
  choice. *Why:* a table that plays on without someone who went home should not have to stop and exchange them by
  hand. *Implementation (Claude):* table rules are set in the board's settings outside a game, like a game's
  settings, and kept in memory until a restart (`POST /rules {awayToAi: 0 | 3 | 5}`, state `rules`; remote boards
  with board control may change them too). A timer starts when the player goes away during a game and ends when
  they are back; when it fires and they are still away in the running game, the table calls the same exchange as the
  board ("Ann (AI)", standing in for Ann, so a person at the table who scans the code with that name takes the seat
  back, D-222). An exchange the board has open for that seat wins (the seat stays as it is). `AWAY_TO_AI_MINUTE_MS`
  shortens a minute for the tests.
- **D-237 · 2026-10-30 · Klaus** — A table rule *AI players get different play styles*, on by default: an AI option
  the game marks `random` (D-226) gets a value no other AI player at the table has, while any are left; when every
  value is taken, any of them. Values chosen by hand stay as chosen. *Why:* a table should meet a mix of characters,
  not the same one twice. *Implementation (Claude):* `pickRandomAiOptions` leaves out the other seated AI players'
  values (`POST /rules {distinctAiStyles}`, state `rules`), for a new AI player, for the game being chosen and for an
  exchange to an AI player.
- **D-238 · 2026-10-30 · Klaus** — A game's description may name its settings: `{key}` shows that setting's value, so
  a description that says "be the first to {target} points" says 8 when 8 is chosen. *Why:* a description with a fixed
  number contradicted the setting right beside it. *Implementation (Claude):* the board fills it in where it shows the
  description: the game's tile (the setting's default) and the window that chooses the game, which follows the fields
  as they change; a key that isn't one of the game's settings stays as written, and an on/off setting shows "on" or
  "off". Tables on an older release show the braces as written.

- **D-239 · 2026-10-30 · Klaus** — In Awards and Results, the award holders' names are in their players' colours, as
  the table has them now: a colour changed while the window is open changes the names too. *Implementation (Claude):*
  `openStatistics` takes `colorOf(seat)`; the board gives the current players' colours and recolours an open window on
  every state. The Game Viewer gives none (a past game keeps no colours), so its names stay brass.

- **D-240 · 2026-10-30 · Klaus** — Played from the board (D-175), the lobby's side panel is titled *Single local
  player* and says how to get the QR code back: "The deck beside the board is the one player at the table. Enable
  multiple local players and the local QR code in the Developer settings." It has no *Invite remote player…* of its
  own: the lobby's button row has one.

- **D-241 · 2026-10-30 · Klaus** — A board never shows a join code the table may no longer take. Every start of the
  Table Host makes a new code (D-066; codes have no time limit), so a board left open while the table stops or restarts
  (`scripts/local-table.sh` updates before it starts) hides its QR code, code and link and says it is connecting; the
  new code shows as soon as the table answers. A phone that scans an old code is told at once, before typing a name,
  that the table restarted or made a new code, and to scan the code the board shows now. *Implementation (Claude):*
  the board sets `body.offline` while its connection is closed; the deck reads the 403 of its seat check
  (`/j/<code>/seat`).

- **D-242 · 2026-10-30 · Klaus** — In Awards and Results, the "," and "and" between two or more award holders are white;
  the names stay in their players' colours (D-239), brass where there are none. The game's own table is titled
  *Results* (was *Statistics*), the moves and time *Statistics* (was *Moves and time*).

- **D-243 · 2026-10-31 · Klaus** — `scripts/local-table.sh` is checked end to end: an e2e check starts it as on a
  developer's computer and opens the address in the board's QR code on a phone page, which must show the name form.
  The script says that phones must be on the computer's WiFi, and warns when the QR code's address does not answer on
  the computer itself (a wrong address or port). A phone on another network, or a firewall, shows only on the phone.

- **D-244 · 2026-10-31 · Klaus** — Someone joining without a name starts with one: "Player N", the lowest N no one at
  the table has. A phone that scans the QR code finds it in its name field, and the board's invite dialog fills it in
  for a player (not a watcher); either can be changed before joining. A game's board settings may also show a line of
  text only (`type: "text"`), e.g. a board's seed. *Implementation (Claude):* `Table.suggestedName()`, in the lobby
  state and in the phone's seat check (`/j/<code>/seat`).

- **D-245 · 2026-10-31 · Klaus** — Settings that depend on others, numbers without a keyboard, and deck details.
  A game setting may apply only with certain values of others (`when`): otherwise it is disabled and blank in the
  window that chooses the game, left out of the settings window, and kept at its default by the table. An int with
  `random: true` gets a fresh value whenever it comes to apply (a board's seed when a random board is chosen). Whole
  numbers take digits only (no "e", ".", "-"), at most as many as the largest value has. One with a wide range is typed
  on the board's number pad (digits, Clear, Enter; it turns with the board, also while open), which a game's own
  settings can use too (`type: "number"`). On the deck, *Change name* opens at the top, clear of a phone's keyboard,
  and its field's frame shows whole; before a game is chosen *Leave* sits beside it; the deck beside the board starts
  with "Player N" too. "Another screen on this LAN" (was WiFi).

- **D-246 · 2026-10-31 · Klaus** — A choice can say what its options mean: a setting's `hints` (`{ value: text }`) show
  the chosen value's text under it, in the window that chooses the game (following the choice as it changes) and in the
  settings window; a game's own `choice` item takes a `hint` per option the same way. For boards with a name, e.g.
  "Six forests on strong numbers: wood in plenty."

- **D-247 · 2026-10-31 · Klaus** — Local play without the console, with every game at hand: `scripts/local-table.sh
  --offline` leaves the live service out (as `CLOUD_URL=`), and `--all-games [DIR]` adds every git checkout in DIR (by
  default the folder that holds games-service) with a games/ folder, each brought up to its branch's latest on GitHub
  unless `--no-pull` (one with changes of its own, or that can't fast-forward, is used as it is). Private game
  repositories stay unnamed here: the script finds them where they are checked out.

- **D-248 · 2026-10-31 · Klaus** — The board's pulldowns turn with their window: a native list opened upright on the
  screen, sideways or upside down on a board facing another edge. A cover over the select opens the options as buttons
  under it, inside the window (the select stays for keyboards). A setting that doesn't apply now (`when`) is hidden in
  the window that chooses the game, title and all, as in the settings window. A setting's `labels` (`{ value: text }`)
  say how its values read ("Beginner" for "beginner"); the game still gets the value.

- **D-249 · 2026-11-01 · Klaus** — A game's description can carry what a chosen setting means: `{key.hint}` shows the
  chosen value's `hints` text, so the window that chooses the game adds a paragraph about the board chosen, following
  the choice, and doesn't repeat it under the field. The tile leaves it out. The settings window shows the same text
  under the setting before the game; during it, the locked row leaves it out, so a game's own item can say what its
  value means now (any item takes a `hint`) without the text showing twice.

- **D-250 · 2026-11-01 · Klaus** — The board's pads for typing without a keyboard share one shell:
  - The pads are the name pad (letters, digits by a switch), the number pad (a seed) and the access-code pad.
  - The shell keeps one pad of a kind at a time, faces the front edge and turns with the board while open, and lies
    above the window it was opened from.
  - A tap beside a pad or Escape cancels it. A real keyboard types into it too: the number pad takes digits,
    Backspace or Delete and Enter; it takes at most the digits of the setting's maximum and answers only in range.
  - The window that chooses a game opens the number pad for a wide-range whole number (more than 1000 values, a
    seed), as the settings window does.
  - A future pad (letters and digits for a game's text setting) builds its keys in the same shell.

- **D-251 · 2026-11-01 · Klaus** — A table of `scripts/local-table.sh` says so on the board, once, after it starts
  (`LOCAL_TABLE=1`):
  - Without the service: only people here can join, by the QR code on this network. No remote players or watchers,
    no invites.
  - Games from git checkouts on this computer: their clones run as they are, not what GitHub or the service has.
    Each checkout is named with its branch, commit and whether it has changes not committed, and with its games.
  - *Got it* dismisses it for good on that browser. It comes back only when what it says changes (another branch or
    commit, the service back).
  - The table host finds the checkouts with git at start (`checkouts.ts`); games the service delivered don't count.
    Not on a remote board, and not on tables started otherwise (the tests).

- **D-252 · 2026-11-01 · Klaus** — Every number and every text field on the board is typed on the board's pads, which
  turn with the board: the board is a touchscreen without a keyboard.
  - Numbers (`int`, `number`) open the number pad, in the window that chooses a game, an AI player's window and the
    simulation (Advanced). It shows the range, takes nothing out of range, and has a decimal point for `number` and a
    minus for a negative `min`.
  - Text (`string`) opens the board's keyboard (the name pad), with the setting's `max` (48 by default) and no name
    rules.
  - A real keyboard types into either pad. The fields themselves take no typing.
  - Open dialogs now turn with the board as the pads do, so a pad and the window it came from always face the same
    way.
  - All the games' settings (built-in, extra-games, Loopy, Starforge, Traders) are whole numbers; no game draws an
    input of its own on the board. The settings window keeps − and + for narrow ranges and the pad for wide ones.

- **D-253 · 2026-11-01 · Klaus** — Players' names in the result tables show in their colours, as everywhere else: in
  Awards and Results (the game's Results and the Statistics), and on the finished-game screen. A row's first cell that
  is a seated player's name (from the summary's `players`, also with the * of a seat taken over) takes that seat's
  colour, and follows a colour changed while the window is open. The Game Viewer keeps no colours (D-239).

- **D-254 · 2026-11-01 · Klaus** — The deck's *At the table* list shows each name in that player's colour, with the
  coloured dot before it (a player without a seat stays plain), one's own name in bold, and the place as "South",
  "Southwest", "No seat" (no longer "south seat").
