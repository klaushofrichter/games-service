# Handover (2026-11-01)

Where games-service and extra-games stand as the combined Games cloud session hands over to its replacement (a child
of the "Cluster - Linux" session again). Read [`AGENTS.md`](../AGENTS.md) first; this note covers what isn't written
down elsewhere.

## Deployed now

| Repository | Production | Notes |
| --- | --- | --- |
| games-service | **2026.10.31.1** (`/health`), production at `d888c4a` | includes D-234 to D-244 |
| extra-games | production = main at `e113f17` (release #92) | unchanged since 2026-10-27 |

Tables pick up extra-games' `production` through the console's *Refresh* for a repository, or the hourly refresh.

## In flight

- **games-service #291 "Release to production" (main → production) is open**, head `main` at `6259f4e`. It carries
  D-245 to D-254 (#281 to #290). D-245 (#281) was merged into production before, but its *Deploy production* run
  (41215502297) was cancelled in the 2026-10-31 outage, so production still runs 2026.10.31.1.
  - GitHub reports it `behind`: production has a merge commit main doesn't. Update the branch from `production`
    (a merge, no force), wait for test, codeql and e2e on the new head, then merge with a **merge commit**.
  - Afterwards poll `https://games.skylar.technology/health` until it shows a `2026.11.01.N` version.
  - **Don't merge anything else into main** until #291 is merged.
- **After the deploy:** run every game repository's tests against the new `main` (the private game repos too).
  Before #291 they were all green against `main`, except one Loopy host test that failed once under load and passed
  three times alone.
- **No other pull requests are open** in games-service, extra-games or the private game repositories. A private game
  repository has a release waiting on main; its own `docs/handover.md` says what.

## Waiting on the node agent (the "Cluster - Linux" session)

- Its environment was rebuilt after the 2026-10-31 outage. While the network was down,
  `claude-kube-setup.service` (a user unit that starts `claude remote-control` in tmux) restarted about 2,146 times,
  until 12:42 CST. It has been active since. The unit runs on the **default tmux server**, but the vault's rule is a
  separate tmux server for each unit. That is the Cluster session's to fix.
- **Actions variable `CI_RUNNER`:** Klaus set one private game repository back to `hosted` on 2026-11-01 (the free
  minutes renewed). `loopy-game` and `starforge-game` still say `self`; ask the Cluster session or Klaus whether to
  switch them. kube-setup's ci-budget job does this from the billing report.
- Repository settings, Actions variables, the cluster and the runners belong to the Cluster session or to Klaus.
- Klaus's Obsidian vault now uses Obsidian Sync. The copy in Google Drive may be out of date.

## Requests from Klaus since 2026-10-29, and their status

All of these are merged into main. Those after D-244 wait for #291 to reach production.

- **Table rules:** an away player can be replaced by an AI player (D-236). AI players get different play styles
  (D-237).
- **Lobby and deck:** an AI player's style shows on its seat plate (D-234). A board never shows a join code the
  table may no longer take (D-241). Someone joining without a name starts as "Player N" (D-244). The deck's *At the
  table* list shows names in the players' colours, with places like "South" (D-254).
- **Settings:**
  - `{key}` in a description shows the setting's value (D-238), and `{key.hint}` its hint (D-249).
  - Settings can depend on others (`when`) and can take random seeds (D-245). Each choice can carry a hint (D-246).
  - Pulldowns turn with their window, and options can have labels (D-248).
- **Pads:** all the board's pads share one shell (D-250). Every number and text field on the board, the simulation
  dialog included, opens a pad that follows the board's facing. The number pad takes keyboard input, decimals and a
  minus (D-252).
- **Local play:** `scripts/local-table.sh` is checked end to end (D-243) and has `--offline` and `--all-games [DIR]`
  (D-247). A local table shows a one-time notice listing the game checkouts and their branches (D-251).
- **Awards and Results:** holders' names and the result tables use the players' colours (D-239, D-242, D-253).
- **Badges** on seat plates are an idea for games (D-235); no game uses them yet.
- From the 2026-10-29 note, still open: Klaus will choose which games get 12 or more awards (D-231). Also open: a
  tap beside Awards and Results counts as *Done* (D-233 follow-up); ask Klaus before changing it. Merged branches
  were never deleted; ask before deleting any.

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
  - D-234 to D-244: AI styles on seat plates, badges, the two table rules, `{key}` in descriptions, colours in
    Awards and Results, join codes, `local-table.sh`'s e2e, "Player N".
  - D-245 to D-254: conditional settings and hints, pulldowns that turn, the pads, local-table notices, names in
    players' colours (in #291).
- **Security and privacy:** D-200, D-202.
- **The console's host:** D-204, D-205.
- **Relays:** D-209, D-211.
- **extra-games:** E-034 to E-045 (the latest) cover the recent Backgammon and Chess work. E-039 is wildbg, and E-040 to E-043
  are the online engines.
