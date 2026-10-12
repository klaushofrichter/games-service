# Decision log

Decisions that shape the Game Table platform, newest last. Each entry records what was decided, why, and who decided. "Klaus" marks product decisions from the project owner; "Claude" marks implementation choices made while building, which Klaus can overrule. The full reasoning lives in the *Game Table — Concept & Architecture* document.

Format: **D-nnn · date · decided by** — decision. *Why:* reason.

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
- **D-033 · 2026-10-12 · Claude** — Join codes and invite codes use a 32-character alphabet without 0/O and 1/I. Join codes are single-use and rotate every 5 minutes.
- **D-034 · 2026-10-12 · Claude** — The board page is served only to loopback clients and receives the table key there; everything else needs `X-Table-Key`. *Why:* decks on the LAN must not be able to drive the board API.
- **D-035 · 2026-10-12 · Claude** — Phase 1a runs game rules in-process. The isolated sandbox is deferred until third-party games (D-016).
- **D-036 · 2026-10-12 · Claude** — The cloud skeleton stores state in memory (single replica) and tables authenticate with an issued bearer token. PostgreSQL and key-pair authentication come before production.
- **D-037 · 2026-10-12 · Claude** — Seat numbering: South edge first, then North, then East, then West; numbered left to right as seen from that edge.
