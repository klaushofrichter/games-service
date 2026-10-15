# Changelog

Curated notes for the next release go under **[Unreleased]**. The deploy copies them into the GitHub release,
followed by the commit list and what the deploy verified, so this file needs no version headings: the releases
page is the history. Leave it empty if there is nothing to add beyond the commit list, and empty it again after a release.

## [Unreleased]

- First deployment to the cluster: the cloud service at https://games.skylar.technology with Google sign-in for
  administrators, and the table-host image for table PCs.
- Extra-game repositories: the console lists GitHub repositories with games (private ones too, with
  `GAME_REPO_TOKEN`), and an administrator ticks them per table, at approval or later. Tables install those games
  between games, and remote players see them too. Games in such a repository import `@game-table/sdk`.
- The repository list survives restarts: `deploy/game-repos.json` is baked into the cloud image (shown as *deploy
  config* in the console); repositories added in the console last until the next restart.
- Rules for every game on the phones: a **Rules** button opens the chosen game's rules, with illustrations and the
  settings chosen at this table. Games provide them as `how-to-play.md` with images in `assets/`.
- Games on the board face north or south only, using the long sides; a turn-around button left of the gear turns a
  game 180° without moving the players. Remote players on an east or west seat can show the board upright, at full
  width. The seat plates now sit the same distance from the edge on all four sides, and each phone shows the
  player's colour in its seat badge.
- Pachisi: sound effects (rolling, moving, a six, a token sent back); a **Pieces** setting to show icons instead of
  numbers; and tokens can be moved by tapping them on the board, for players at the table and remote players on their
  own board. Games can allow such board moves with `boardIntents` in their manifest.
- An AI player's window has a **Remove** button, and opens before a game is chosen too.
- The phones' *At the table* list shows each player's colour before their name.
- Scrollbars in the console (e.g. Game logs), the invite page and the sign-in pages use the green felt colours instead of white.
