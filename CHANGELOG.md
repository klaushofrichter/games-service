# Changelog

Curated notes for the next release go under **[Unreleased]**, one line (or a few wrapped lines) per change worth a
note. The deploy puts the lines added here since the previous release into that release's notes on GitHub, followed
by the commit list and what the deploy verified (`scripts/release-notes.sh`), so each note is published once even if
the section is not emptied; empty it now and then. The file needs no version headings: the releases page is the
history.

## [Unreleased]

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
