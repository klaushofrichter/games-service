# Handover (2026-10-29)

Where games-service and extra-games stand as one coding session hands over to the next. Read
[`AGENTS.md`](../AGENTS.md) first; this note covers what isn't written down elsewhere.

## Deployed now

| Repository | Production | Notes |
| --- | --- | --- |
| games-service | **2026.10.29.2** (`/health`), production = main at `47adefb` | includes D-224 to D-233 |
| extra-games | production = main at `e113f17` (release #92) | Chess 2026.10.27.3, Backgammon 2026.10.27.5 |

Tables pick up extra-games' `production` through the console's *Refresh* for a repository, or the hourly refresh.

## Open work

- **No pull requests are open** in games-service or extra-games, and main equals production in both.
- **Awards:** D-231 recommends that games offer 12 or more awards. The guide says so, but no cap is enforced. Klaus
  will pick which games get more later. Counts today: Roulette 15, Last Card 10, Chess 8, Hold'em 7, Backgammon 6,
  Mexican Train 5, Coin Flip 4, Pachisi 0, Liar's Dice 0. The platform owns the Awards and Results window
  (`apps/table-host/public/board/stats.js`); each game owns its award definitions.
- **Possible follow-up to D-233:** a tap beside Awards and Results still counts as *Done*, which leads to the
  results (D-216). Someone who came from the last screen might expect it to go back to the game instead. Ask Klaus
  before changing it.
- **Housekeeping:** merged feature branches were never deleted on either remote, and
  `dependabot/pip/scripts/e2e/playwright-1.64.1` in extra-games has no pull request. Ask before deleting any of
  them.

## Requests from Klaus, and their status

- **Console *Refresh* for a repository:** done in D-232 (#256), and deployed. The button is disabled while the
  repository is fetched. After 30 s without an answer it shows a message and works again. `scripts/e2e/extra.py`
  covers this with a fake GitHub that hangs.
- **Console tooltips on every label:** done, D-225.
- **Lobby tiles of equal height:** done, D-228.
- **Awards and Results:** done and deployed. Its scrollbar stays inside the rounded corners (D-229), and the window
  has *Back to game* (D-233).
- **Chess engines on the internet:** done in extra-games E-040 to E-043. The engines are stockfish.online, the
  Lichess cloud and the Lichess tablebase. Stockfish's depth is the lower of what the Elo asks and what the time
  allows. Every AI move is tagged with where it came from.
- **Backgammon:** the Auto-Roll label (E-044) and picking any checker on the bar (E-045) are done.

## Release process and conventions

1. A feature branch, then a pull request into `main`, merged as a **squash**.
2. A release pull request from `main` into `production`, titled "Release to production", merged with a **merge
   commit**.
3. games-service only: pushing to `production` runs *Deploy production*. It versions the release `YYYY.MM.DD.N`
   (America/Chicago) at deploy time. Afterwards check `https://games.skylar.technology/health` for the new version.
   extra-games has no deploy: tables fetch its `production`.

Conventions:

- Merge when test, codeql and e2e are green.
- Don't merge into `main` while a release pull request is waiting. Release the first change, then merge the next.
- A change in a game's folder needs a new calendar version: `node scripts/check-game-versions.ts --base origin/main
  --fix`. In extra-games, the script is under `.games-service/scripts/`.
- Every product decision gets a record in the same pull request: D-nnn here, E-nnn in extra-games. Records marked
  *Klaus* are binding. Add a CHANGELOG line under `## [Unreleased]`.
- Keep the developer guide, `llms.txt` and the SDK comments in step: `tests/developer-docs.test.ts` checks them.
- D-200 covers what this public repository may say about private repositories: their names, but not their details.
- Never commit secrets. Credentials live in Klaus's `.env` and reach the cluster through his sync script. A session
  names keys, never values, and never asks for a value in chat.

What a session can do itself: branches, pull requests, merges, release pull requests (through the GitHub REST API,
and without changing protections or settings). Deploys run themselves from `production`.

What it can't do: change the cluster, its runners or its secrets. Those belong to the cluster's own session.

## Gotchas and CI quirks

- **`gh pr view` fails with a GraphQL 403** in cloud sessions. Use the REST API instead, for example
  `gh api repos/klaushofrichter/games-service/pulls/N`.
- **e2e failures:** the e2e job sometimes fails once on timing. Re-run the failed jobs once before you investigate.
  Recent real races were fixed by waiting for the state, not by sleeping (a tile being present; Last Card's armed
  state).
- **Local e2e in a cloud container:** Playwright's own Chromium download isn't there. Point it at the pre-installed
  browser: `CHROMIUM_PATH`, or patch `chromium.launch` with `executable_path` set to the browser under
  `/opt/pw-browsers/`.
- **Node `fetch` behind the session proxy** (for example, chess's online engines in tests) needs
  `NODE_USE_ENV_PROXY=1` and `NODE_EXTRA_CA_CERTS` set to the proxy's CA bundle.
- **Game repositories pin a copy of the platform in `.games-service/`.** Their weekly check runs against this
  repository's `main`, so a platform change that breaks a game shows up there first. After a platform change, run
  each game repository's tests against the new `main`.
- **Background jobs in a cloud container** stop when the container restarts. Check that a long job is still running
  before you trust that it is.

## Decision pointers

- **Recent platform decisions:**
  - D-215 to D-218: the board's settings, and the awards on the way to the results.
  - D-224: `ai.notice`.
  - D-226: AI options with `random: true`.
  - D-227: `facing: "any"`.
  - D-228 to D-233: lobby tiles, scrolling windows, deselecting a player, 12+ awards, the console's *Refresh*, *Back
    to game*.
- **Security and privacy:** D-200, D-202.
- **The console's host:** D-204, D-205.
- **Relays:** D-209, D-211.
- **extra-games:** E-034 to E-045 cover the recent Backgammon and Chess work. E-039 is wildbg, and E-040 to E-043
  are the online engines.
