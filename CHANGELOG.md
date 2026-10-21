# Changelog

Curated notes for the next release go under **[Unreleased]**, one line (or a few wrapped lines) per change worth a
note. The deploy puts the lines added here since the previous release into that release's notes on GitHub, followed
by the commit list and what the deploy verified (`scripts/release-notes.sh`), so each note is published once even if
the section is not emptied; empty it now and then. The file needs no version headings: the releases page is the
history.

## [Unreleased]

- *Play from the board*, a developer setting under Advanced: one player at the table plays from a deck beside the
  board, laid out like a remote player's page, without a phone; no QR code meanwhile; remote players, watchers and AI
  players as usual (D-175, `BOARD_DECK=1`).
- Local installation: `llms.txt` points to the runbook, now also at `/docs/local-docker.md`; it needs no cloud
  service, also not for games from private repositories, which are cloned (D-174).
- The release notes take only the CHANGELOG lines added since the previous release; the section was emptied of 67
  notes that every release had repeated (D-173).
