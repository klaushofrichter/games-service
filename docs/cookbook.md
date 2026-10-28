# Cookbook: Game Table with your AI agent

Recipes for people who want to play, build or host Game Table, and let an AI coding agent (Claude, or any agent that
can read web pages and run commands) do the work. Each recipe says what you need, what to ask, and how to tell that it
worked. The agent reads the details itself: [`llms.txt`](https://games.skylar.technology/llms.txt) points it to the
developer guide and the Docker runbook, and those are written for agents as much as for people.

How the parts fit together: [`architecture.md`](architecture.md). The words used here (board, deck, seat plate,
watcher, sling, console…): [`glossary.md`](glossary.md).

**Good habits with an agent**

- Start every request with *"Read https://games.skylar.technology/llms.txt"*. It is the agent's way into the
  contract between games and the platform; without it, it guesses.
- Ask for one thing at a time, and play the result before asking for the next.
- Say what you see, not what you think the code does: "the dice on the board are stacked; they should be side by
  side" works better than "fix the CSS". A screenshot or a photo of the board helps.
- Let the agent run the tests and the browser checks, and ask it to show you a screenshot of the board.
- Keep keys to yourself: the table key, tokens and passwords stay in `.env` files, never in a chat, an issue or a
  commit.

## 1. Play something, fast: a table with the extra games

**You need:** a computer on the same WiFi as the phones (a Mac, a Linux PC, or a Windows PC with Docker Desktop), with
Docker (or Node 26), and git. A touchscreen is
optional: a mouse works, and an iPad can be the board (see the tip below).

**Ask:**

> Read https://games.skylar.technology/llms.txt. Set up Game Table on this computer with the built-in games and the
> games from https://github.com/klaushofrichter/extra-games, then open the board and tell me how my phone joins.

The agent follows the [local runbook](runbooks/local-docker.md): Part A (the table in Docker), then Part B1 (the
extra games). No cloud service, no DNS entry, no HTTPS. With Node 26 instead of Docker, it can also run
`CLOUD_URL= scripts/local-table.sh --extra ../extra-games` (README, *A table on your computer*).

**It worked when** the board shows *Pick a game* with nine games (three to a page), and a phone that scans the QR code gets a seat.
Without a phone at hand, turn on *Advanced* (hammer and wrench) › *Developer* › *Games without a player at the table*,
add AI players and press *Start game*; or turn on *Play from the board*; or ask the agent to run a simulation.

**Tip, an iPad as the board:** open the board's settings (the gear) › *Board on another screen…* and scan the QR
code with the iPad. The board moves there; the table keeps running on the computer. Good enough to try a game or
test your own. Sound starts after the first tap on the iPad.

## 2. Build a simple game

**You need:** recipe 1 done, a GitHub account, and your own copy of
[extra-games](https://github.com/klaushofrichter/extra-games) (fork it on GitHub and clone it next to games-service).

**Ask** (tested: this prompt produces a playable Yahtzee):

> Read https://games.skylar.technology/llms.txt and write a new game for Game Table in my copy of extra-games:
> Yahtzee for 2–6 players, with an AI player.

Or in one go, with the setup:

> Read https://games.skylar.technology/llms.txt, set up Game Table on my computer, and write a new game for it:
> Yahtzee for 2–6 players.

The agent writes `games/yahtzee/` (manifest, rules, board, phone, rules for players, tests), runs the tests on a real
Table Host and the browser checks, and shows you screenshots. Then play it: restart the table with your games
(recipe 1, or `CLOUD_URL= scripts/local-table.sh --extra ../extra-games` with your copy) and pick it on the board.

**Then improve it, one request at a time**, for example:

> The dice on the phone are too small; make them half the screen wide.
> Add an award for the player who scored Yahtzee most often.
> Let the board show each player's score card at their seat.

**Before you call it done,** go through the [game checklist](#5-the-game-checklist) with the agent.

## 3. Private games

A game does not have to be public. A private GitHub repository works like extra-games, and only the people (and
tables) you give access see it.

**Ask, to start one:**

> Read https://games.skylar.technology/llms.txt. Create a private repository for my Game Table games, laid out like
> https://github.com/klaushofrichter/extra-games (games/, tests against games-service, CI), and move my game
> games/yahtzee into it.

**To play private games at your own table**, no service is needed: the table runs any game folder it is given.

> Add the games from my private repository <owner>/<repo> to my local Game Table (runbook Part B2).

The agent clones it with your own git access (it asks you if that fails) and points the table at its games. No token
goes into the table's settings.

**To bring them to tables connected to a game service** (yours, recipe 4): the service fetches the repository with a
read-only token (`GAME_REPO_TOKEN`, a fine-grained GitHub token with *Contents: read*), and an admin adds it under *Game repositories* in the
console (or in `deploy/game-repos.json`) and ticks it for the tables that may have it, or gives those tables an access code that includes it. Ticking a repository
trusts its code on that table's PC: only tick repositories you trust.

## 4. Your own game service, with real remote players

The game service is what lets people play from anywhere: it connects tables, brings remote players and watchers to a
table through an invite link, keeps the game logs, and has the console for admins. A table works without it (recipes
1–3); you need it for remote players outside your room.

**What the console does** (for admins only; `/admin` on the service, or its own host with `CONSOLE_URL`, like
https://games-console.skylar.technology):

- **Overview:** how many tables, how many online now, remote players and watchers connected now, games played, the
  service's storage.
- **Tables:** a new table shows a pairing code on its board; an admin approves it here. Each table's row shows
  whether it is online (with its remote players, away ones and watchers, as counts), its games played and which game
  repositories it has; *Disconnect* and *Reconnect* it.
- **Access codes:** codes that approve a table at once (no pairing code), with a validity and the games it brings;
  give one to someone who sets up a table (`TABLE_CODE`, or the board's Advanced window).
- **Game repositories:** the extra-game repositories the service offers (public, or private with
  `GAME_REPO_TOKEN`), and which tables get them.
- **Game logs** and **Download tokens:** finished games uploaded by the tables, to download, and tokens that let
  someone (or an AI agent) download them to analyse a game.
- **Log retention:** how long logs are kept (90 days by default).
- And the website, at `/`.

**Try it on one machine first** (no DNS, no HTTPS; remote play works only in a browser on that machine):

> Read https://games.skylar.technology/llms.txt. Set up Game Table locally with a local cloud service (runbook Part C),
> approve my table in the console, and show me what the console does.

**For real remote players** the service must be reachable on the internet on **HTTPS**, because browsers allow remote
play only there. You provide:

- a **domain name** (for example `games.example.com`) with a DNS record pointing to the machine that runs the service,
  and ports 80 and 443 open to it;
- an **HTTPS certificate** (a reverse proxy such as Caddy or Traefik gets one from Let's Encrypt by itself);
- a **Google OAuth client** for the admin sign-in (an https service requires it), and the e-mail addresses that may
  sign in (`ALLOWED_EMAILS`);
- optionally a **relay** for remote players on a phone's hotspot or cellular data: a Cloudflare TURN key
  (`CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN`) or your own TURN server (`ICE_SERVERS`); see the
  [relays runbook](runbooks/remote-play-relays.md);
- recommended, a **second domain name for the console** (for example `games-console.example.com`, `CONSOLE_URL`) with
  its own DNS record and certificate: an invite page runs code that the inviting table sends, and on a host of its own
  the console's sign-in is out of that code's reach.

**Ask:**

> Read https://games.skylar.technology/llms.txt and the README of https://github.com/klaushofrichter/games-service
> (*Cloud service configuration*, *Remote play*). Run the Game Table cloud service on this server at
> https://games.example.com behind Caddy, with its data kept on disk, the console at https://games-console.example.com,
> Google sign-in for admins (allowed: me@example.com), and connect my table at home to it. Tell me which values I have to create myself, and
> where to put them; don't put secrets into the repository.

**It worked when** `https://games.example.com/health` answers, you can sign in to the console, your table shows
online there after you approve it, and an invite from the board (*Invite remote player…*) opens on a phone on mobile
data and gets a seat.

## 5. The game checklist

What a complete game has. Ask the agent to go through it for your game ("Check my game against the cookbook's game
checklist and tell me what is missing"), or one point at a time with the prompts below. The developer guide has the
details; the section names are given.

### The game idea

One or two sentences: what players do, how a game ends, how long it takes, for how many players. Name it with a word
of your own: a well-known game's name is often a trademark (that is why this project's UNO-style game is called
*Last Card*).

> I want a game where …; 2–6 players, about 20 minutes. Suggest a name that isn't a trademark.

### The mechanics: what is on the phone, what is on the board

The heart of a Game Table game: what each player keeps **private on their phone** (their hand, their dice under the
cup, their bet), and what everyone sees **on the board** (the table, the pile, whose turn it is). The phone is also
where a player acts, unless moves are made by touching the board (`boardIntents`), or with the sling.

> Describe how this game splits between the board and the phones before writing code: what each phone shows and
> does, what the board shows, and what must never reach another player's phone.

(Guide: *The table in one minute*, *The rules*: `view`, `boardView`.)

### The rules

- **For the computer:** `rules.ts`, pure functions on a JSON state. Randomness only from `ctx.random()` and time from
  `ctx.now()`, so every game can be replayed and checked.
- **For players:** `how-to-play.md`, shown on the phones and the board, with the table's settings; an illustration
  helps.

> Write the rules for players in how-to-play.md: short, with an example turn and a picture of the board.

(Guide: *The rules*, *Rules for players*.)

### Awards

The end of a game opens the statistics window with awards: who did the most (or the least) of something. They make
the end a story. Use `mostAward` and `leastAward`; an award shows only when someone stands out, so offer 12 or more
(D-231): then every game ends with a few, ideally one for each player.

> Invent twelve awards for this game that would make people laugh at the end, and add them.

(Guide: *The end of a game*.)

### Player placement

- `players` (how many), `seatLayouts` (2, 4, 6 or 8 seats) and `edges` (which edges of the table may have seats).
- `localSeat`: for a game with a front, like chess, where a single person at the table sits.
- `dynamicPlayers`: whether people can join during a game.
- Which way the board faces, and that text faces the player it is for. The seat names: glossary, *Seats and their
  names*.

> Which seat layouts suit this game? Make sure each player's things on the board face them, and test it with
> 2, 4 and 6 players.

(Guide: *The manifest*, *Players and seats*, *The board UI*: facing.)

### Custom game settings

Choices the table makes before a game starts, in the lobby: rounds, a time limit per turn, house rules. They are
`settings` in the manifest and reach the rules in `setup`. Not to be confused with **preferences**: how the board
looks and sounds, changeable any time from the board's settings (`settings()` in `board.js`, `setPrefs`).

> Add game settings for the number of rounds and a time limit per turn (0 = none), and a preference for the speed
> of the animations.

(Guide: *The manifest*: `settings`, *The board UI*: settings.)

### The developer settings

Behind the hammer-and-wrench button beside the gear on the board (*Advanced*), for testing; not needed to play:

- **Simulation…** plays games with AI players only, as fast as possible, to find rules errors and weak AI.
- **Game logs…** lists finished games move by move; the **Game Viewer** steps through one.
- **Developer › Games without a player at the table:** start games with AI (and remote) players only.
- **Developer › Play from the board:** one player's deck beside the board, so you can develop without a phone.
- **Developer › Live status…** what holds a game up right now (an AI player, the board, a phone).
- Test games (`"test": true` in the manifest, like Card Sling) show only on tables with `SHOW_TEST_GAMES=1`.

> Run 50 simulated games of my game with 4 AI players and tell me how long they take, who wins how often, and any
> errors. Then open the log of the longest one and explain its last ten moves.

(Guide: *Logs, replay and the Game Viewer*, *Testing*.)

### Customization options

The platform draws the lobby and the seat plates; a game can make the rest its own. Mexican Train in extra-games is
the demo that changes nearly everything; copy from it.

- **The board's look:** its own background (even animated), tiles, cards and pieces, and restyled seat plates.
- **Sound and music:** effects with `playSound` (they follow the table's sound setting); Mexican Train even composes
  its own tunes.
- **Preferences:** a background, card faces, animation speed, in the board's settings.
- **Moves on the board:** touch a piece to move it (`boardIntents`), skip a pause ("Next hand", `skipTimers`).
- **The sling:** push a card off the top of the phone onto the board (`/shared/sling.js`); Last Card uses it.
- **The Game Viewer:** extra columns and readable move descriptions (`describe`, `viewer`).
- **Where the Lobby button sits** during the game (`lobbyButton`), to keep a corner free.

> Give the board an animated background that suits the game, with a preference to switch it off, and sound effects
> for the main moves, but no music.

(Guide: *The board UI*, *The phone UI*, *Slinging things from the phone to the board*.)

### Before you share it

> Check my game against the developer guide's checklist (section 16), run all tests and browser checks, set the
> game's new version, and open a pull request.

## 6. The GitHub pipeline, and deploying your own

Both repositories (games-service and extra-games) work the same way; a game repository of your own copies it.

**Branches**

| Branch | What it is | Protection |
| --- | --- | --- |
| `main` | Where every change lands first, by pull request; tested by the pull request's checks (games-service also builds it on every push, `build-push.yml`); never deployed. | None on GitHub: changes arrive by pull request with green checks, by habit. A fork may want to protect it (required checks). |
| `production` | What is live: games-service deploys it, and game services give tables the games of an extra-game repository's `production` branch. Changes only through a release pull request from `main`. | Required checks `test`, `codeql` and `e2e`, branch up to date before merging, no force pushes, no deletion. |
| feature branches | One change each, named in kebab-case after what it does: `last-card-polish`, `board-sound-unlock`, `glossary-tos`. `experiment/<name>` for a trial that may never merge (`experiment/card-sling`). Dependabot opens `dependabot/…`. | Deleted on GitHub when merged. |

**The flow**

```
feature branch ──PR (squash)──▶ main ──release PR (merge commit)──▶ production ──▶ deploy
```

- Every pull request runs three checks: **`test`** (game versions, unit tests, typecheck, `npm audit`, and in
  games-service both images built and run), **`e2e`** (every browser check on a real Table Host) and **`codeql`**
  (code scanning); in extra-games `test` also runs a soak of AI-only games. A pull request to `production` can merge
  only when all three are green; on `main` we wait for green by habit.
- A change in a game's folder needs a new calendar version (`YYYY.MM.DD.N`); the `test` check fails otherwise, and
  `node scripts/check-game-versions.ts --base origin/main --fix` sets it (in extra-games and other game repositories:
  `node .games-service/scripts/check-game-versions.ts --base origin/main --fix`).
- Every decision goes into `docs/decisions.md` (D-nnn in games-service, E-nnn in extra-games) in the same pull
  request; release notes for games-service under `## [Unreleased]` in `CHANGELOG.md`.
- **extra-games is tested on every pull request against the games-service ref in its `games-service.ref` (now
  `main`), and every Monday against games-service `main`**, so a platform change that breaks a game shows up within a
  week. A game change that needs a platform change waits until the platform's pull request is merged.
- A release: a pull request from `main` to `production`, merged when green. games-service then deploys by itself,
  with the release's version, and publishes a GitHub release; extra-games' `production` is picked up by the game
  services that list it.

**Ask:**

> Read AGENTS.md (CLAUDE.md in extra-games) and the README's *Branches, CI and deployment* (*Branches and checks* in
> extra-games). Make this change on a new branch, open a pull
> request to main with a decision record, wait for test, e2e and codeql, and merge it when green. Then release main to
> production the same way.

**Deploying your own game service.** `deploy-production.yml` deploys to *this project's* Kubernetes cluster: it runs
on a self-hosted runner inside that cluster and updates that cluster's manifests in a private repository with a
token only this project has. In a fork it cannot run; turn it off or replace it. `build-push.yml` (images to your own
`ghcr.io/<you>/…` on every push to `main`) and `production-checks.yml` (the three checks) work in a fork as they are.

Ways to run your own service instead:

- **A server with Docker:** the cloud image behind a reverse proxy with HTTPS (Caddy or Traefik), its data on disk;
  recipe 4 says what you need (a domain, DNS, a certificate, a Google OAuth client).
- **Your own Kubernetes:** the same image as a Deployment with exactly one replica (and `MAX_REPLICAS=1` in its
  environment, which the service checks), a persistent volume
  for `DATA_DIR`, and an ingress with TLS.

> This is a fork of games-service. Replace the deploy workflow with one that deploys the cloud service to my server
> at games.example.com with Docker Compose and Caddy when production changes, keeps the version and health check of
> the original, and tells me which secrets to add to the repository. Leave build-push and the PR checks as they are.
