#!/usr/bin/env bash
# The release notes of "local-table" (D-256, D-276), from the packages' manifests and checksums in one folder:
#   scripts/package/release-notes.sh DIR
# DIR holds game-table-<os>.manifest.json and game-table-SHA256SUMS.txt (a build's, or the release's own files).
# Used by the publish step and by a notes-only run of local-table-packages, so both write the same text.
set -euo pipefail
dir=${1:?usage: release-notes.sh DIR}
m=$(ls "$dir"/game-table-*.manifest.json | head -1)
ver=$(jq -r .package.version "$m")
ref=$(jq -r '.gamesService.ref // "production"' "$m")
commit=$(jq -r .gamesService.commit "$m" | cut -c1-7)
built=$(jq -r .package.built "$m")
site=https://games.skylar.technology/docs/install
cat <<NOTES
Game Table for one computer, without the Game Table service: players here join with their phones on the same network.

Version $ver, the same that \`game-table --version\` shows. Built from games-service $ref ($commit) on $(echo "${built:0:16}" | tr T " ") UTC.

- Windows 11: game-table-windows.exe ([install guide]($site/windows.md))
- macOS: game-table-macos.pkg ([install guide]($site/macos.md))
- Linux: game-table-linux.tar.gz ([install guide]($site/linux.md))

The packages hold the platform and its built-in games. The extra games, like Chess and Backgammon, are in a separate repository, [klaushofrichter/extra-games](https://github.com/klaushofrichter/extra-games): each start downloads them and adds them to the table automatically, with no sign-in. Private game repositories you name are added the same way; only those need your GitHub sign-in.

The packages aren't signed, but there is a SHA-256 checksum for each, below and in game-table-SHA256SUMS.txt.

$(awk '{print "- " $2 ": `" $1 "`"}' "$dir/game-table-SHA256SUMS.txt")

Each package holds MANIFEST.json (also here as game-table-<os>.manifest.json): its version, build time, Node.js and built-in games. After a start, games.json in the table's folder lists every game on the table with its version, repository and commit (\`game-table --version\`).

Built-in games: $(jq -r '[.games[] | select(.test | not) | "\(.name) \(.version)"] | join(", ")' "$m")
NOTES
