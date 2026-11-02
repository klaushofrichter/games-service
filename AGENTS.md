# Notes for coding agents

- **Writing or changing a game?** Read [`docs/developers/game-development.md`](docs/developers/game-development.md)
  first: the contract between games and the platform (also served at `https://games.skylar.technology/llms.txt`).
  Start from `games/coin-flip`. A game never reimplements what the platform owns (lobby, seats, joining, leaving,
  away phones, exchanging players, pauses, AI scheduling).
- **Asked to set it up and run it?** Follow [`docs/runbooks/local-docker.md`](docs/runbooks/local-docker.md): the
  Table Host with the built-in games in Docker on one machine, no cloud service, DNS or HTTPS.
  Without Docker: `scripts/local-table.sh` (Node 26) runs one from the latest `main`, `--branch NAME`, and
  `--extra ../other-repo` for games not released yet, `--offline --all-games` for every game checked out beside it (developer guide, section 14).
  For playing only, packages for Windows, macOS and Linux: [`docs/install/`](docs/install/) (D-256); on Windows also
  `scripts/windows/game-table.ps1` ([`docs/runbooks/windows.md`](docs/runbooks/windows.md), D-255). The board can move to an iPad
  or a TV on the same network: board settings › *Board on another screen…* (README, D-190).
- **Words:** [`docs/glossary.md`](docs/glossary.md) names the platform's parts and their names in the code (board,
  deck, seat plate, watcher, sling, console, the seat names). Use them in docs, UI text and new code.
- **The big picture:** [`docs/architecture.md`](docs/architecture.md) (the parts, how a game runs, what the platform
  owns); [`docs/cookbook.md`](docs/cookbook.md) is how people ask for things, with the game checklist and the GitHub
  pipeline (branches, checks, releases; the deploy workflow is this project's cluster only).
- **Changing the platform?** Decisions are recorded in [`docs/decisions.md`](docs/decisions.md) (D-nnn); add one for
  every product decision in the same pull request. Keep the developer guide, `llms.txt` and the SDK comments in step:
  `tests/developer-docs.test.ts` checks that every rules hook, manifest field and UI `info` field is documented.
- Rules must stay deterministic (randomness from `ctx.random()`, time from `ctx.now()`); every finished game is
  replayed and must reach the same state.
- A change in a game's folder takes a new calendar version: `node scripts/check-game-versions.ts --base origin/main --fix`.
- Tests: `npm test`, `npm run typecheck`; browser checks: `scripts/e2e/run-all.sh out/` (Playwright, Chromium).
