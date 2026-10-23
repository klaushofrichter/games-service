# Notes for coding agents

- **Writing or changing a game?** Read [`docs/developers/game-development.md`](docs/developers/game-development.md)
  first: the contract between games and the platform (also served at `https://games.skylar.technology/llms.txt`).
  Start from `games/coin-flip`. A game never reimplements what the platform owns (lobby, seats, joining, leaving,
  away phones, exchanging players, pauses, AI scheduling).
- **Asked to set it up and run it?** Follow [`docs/runbooks/local-docker.md`](docs/runbooks/local-docker.md): the
  Table Host with the built-in games in Docker on one machine, no cloud service, DNS or HTTPS.
  Without Docker: `scripts/local-table.sh` (Node 26) runs one from the latest `main`, `--branch NAME`, and
  `--extra ../other-repo` for games not released yet (developer guide, section 14).
- **Changing the platform?** Decisions are recorded in [`docs/decisions.md`](docs/decisions.md) (D-nnn); add one for
  every product decision in the same pull request. Keep the developer guide, `llms.txt` and the SDK comments in step:
  `tests/developer-docs.test.ts` checks that every rules hook, manifest field and UI `info` field is documented.
- Rules must stay deterministic (randomness from `ctx.random()`, time from `ctx.now()`); every finished game is
  replayed and must reach the same state.
- A change in a game's folder takes a new calendar version: `node scripts/check-game-versions.ts --base origin/main --fix`.
- Tests: `npm test`, `npm run typecheck`; browser checks: `scripts/e2e/run-all.sh out/` (Playwright, Chromium).
