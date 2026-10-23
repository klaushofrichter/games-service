#!/usr/bin/env bash
# Run a Table Host on this computer (macOS or Linux) against the live Game Table service, without containers, for
# development and testing. scripts/mac-table.sh is its old name and still works.
#   scripts/local-table.sh              update to the latest main, start it, and open the board in the browser
#   scripts/local-table.sh --branch production            the same with another branch, e.g. production or
#   scripts/local-table.sh --branch experiment/card-sling   an experiment (also -b NAME)
#   scripts/local-table.sh --no-pull    start this checkout as it is: no fetch, no switching branches
#   scripts/local-table.sh --extra ../extra-games      also the games of another checkout, as it is (repeatable);
#                                                      with CLOUD_URL= the live service adds none of its own
#   scripts/local-table.sh --no-open    start it without opening the board
#   scripts/local-table.sh --code ABCD-EFGH    approved at once with an access code from the console (D-113)
# Updating (D-188) switches to the branch and fast-forwards it to GitHub's; it stops instead when this checkout has
# changes of its own or the local branch has commits GitHub doesn't. No containers are built: Node runs the code.
# Overrides (environment): TABLE_NAME, PORT, CLOUD_URL (empty = no cloud), PUBLIC_URL, SHOW_TEST_GAMES, DATA_DIR,
# TABLE_CODE (an access code; the same as --code).
#
# The table's identity (tableId, and its token once approved) and its board API key live in DATA_DIR (default
# ~/.gametable-local, or ~/.gametable-mac where an older table lives), so a restart is the same table and needs no new
# approval; the service keeps its pairings across its own restarts too (D-114).
set -euo pipefail

# Switching branches rewrites this file while bash is still reading it: run from a copy, with the checkout's path.
if [ -z "${LOCAL_TABLE_REPO:-}" ]; then
  repo="$(cd "$(dirname "$0")/.." && pwd)"
  copy="$(mktemp "${TMPDIR:-/tmp}/local-table.XXXXXX")"
  cp "$0" "$copy"
  LOCAL_TABLE_REPO="$repo" LOCAL_TABLE_CWD="$PWD" exec bash "$copy" ${1+"$@"} # ${1+...}: bash 3.2 with set -u and no arguments
fi
case "$0" in "${TMPDIR:-/tmp}"/local-table.*) rm -f "$0" ;; esac # bash has it open; the copy goes when it ends
cd "$LOCAL_TABLE_REPO"

OPEN=1
PULL=1
BRANCH=main
EXTRA=()
NEXTRA=0 # bash 3.2 (macOS) calls an empty array unbound under set -u: count instead
while [ $# -gt 0 ]; do
  case "$1" in
    --no-open) OPEN=0 ;;
    --no-pull) PULL=0 ;;
    --branch | -b) [ $# -ge 2 ] || { echo "$1 needs a branch, e.g. --branch production" >&2; exit 2; }; BRANCH="$2"; shift ;;
    --branch=*) BRANCH="${1#--branch=}" ;;
    --extra) [ $# -ge 2 ] || { echo "--extra needs a checkout, e.g. --extra ../extra-games" >&2; exit 2; }; EXTRA+=("$2"); NEXTRA=$((NEXTRA + 1)); shift ;;
    --extra=*) EXTRA+=("${1#--extra=}"); NEXTRA=$((NEXTRA + 1)) ;;
    --code) [ $# -ge 2 ] || { echo "--code needs a value, e.g. --code ABCD-EFGH" >&2; exit 2; }; TABLE_CODE="$2"; shift ;;
    --code=*) TABLE_CODE="${1#--code=}" ;;
    *) echo "unknown option: $1 (use --branch NAME, --extra DIR, --no-pull, --no-open, --code ABCD-EFGH)" >&2; exit 2 ;;
  esac
  shift
done

if [ "$PULL" = 1 ]; then
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "This checkout has changes of its own; commit or stash them, or start it as it is with --no-pull:" >&2
    git status --short --untracked-files=no >&2
    exit 1
  fi
  echo "Updating to origin/${BRANCH}..." # braces: bash 3.2 (macOS) may read non-ASCII text after a name as part of it
  git fetch origin "$BRANCH" || { echo "No branch \"$BRANCH\" on GitHub (git fetch failed)." >&2; exit 1; }
  if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git checkout --quiet "$BRANCH"
    git merge --ff-only --quiet FETCH_HEAD || { echo "Local $BRANCH has commits GitHub doesn't; push them, or start with --no-pull." >&2; exit 1; }
  else
    git checkout --quiet -b "$BRANCH" --track "origin/$BRANCH" 2>/dev/null || git checkout --quiet -b "$BRANCH" FETCH_HEAD
  fi
fi
echo "Running $(git rev-parse --abbrev-ref HEAD) at $(git log -1 --format='%h %s' | cut -c1-80)"

major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$major" -lt 26 ]; then
  echo "Node 26 is needed (found: $(node --version 2>/dev/null || echo none)). With nvm: nvm install 26 && nvm use 26" >&2
  exit 1
fi
# Install the dependencies when package-lock.json differs from the one they were installed for (a new branch may need
# others).
lock=$(git hash-object package-lock.json)
if [ ! -d node_modules ] || [ "$(cat node_modules/.local-table-lock 2>/dev/null)" != "$lock" ]; then
  npm ci
  echo "$lock" > node_modules/.local-table-lock
fi

if [ -z "${DATA_DIR:-}" ]; then
  DATA_DIR=$HOME/.gametable-local
  [ -d "$HOME/.gametable-mac" ] && [ ! -d "$DATA_DIR" ] && DATA_DIR=$HOME/.gametable-mac # the same table as before the rename
fi
mkdir -p "$DATA_DIR"
chmod 700 "$DATA_DIR"
KEY_FILE="$DATA_DIR/table-key"
if [ ! -s "$KEY_FILE" ]; then
  (umask 077 && openssl rand -hex 16 > "$KEY_FILE")
fi

PORT=${PORT:-8080}
# The QR code must carry the address phones on the WiFi can reach. Ask the system which interface the default route
# uses: the host's own guess may pick a VPN or a Docker network instead.
if [ -z "${PUBLIC_URL:-}" ]; then
  ip=""
  if [ "$(uname)" = "Darwin" ]; then
    iface=$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')
    [ -n "$iface" ] && ip=$(ipconfig getifaddr "$iface" 2>/dev/null || true)
  elif command -v ip >/dev/null 2>&1; then
    ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit }}')
  fi
  [ -n "$ip" ] && PUBLIC_URL="http://$ip:$PORT"
fi

default_name="$(hostname -s 2>/dev/null || echo "Game Table")"
[ "$(uname)" = "Darwin" ] && default_name="$(scutil --get ComputerName 2>/dev/null || echo "$default_name")"

# Extra games from other checkouts (D-188): this repository's games and theirs, linked into one folder.
if [ "$NEXTRA" -gt 0 ]; then
  GAMES_DIR="$DATA_DIR/games"
  rm -rf "$GAMES_DIR"
  mkdir -p "$GAMES_DIR"
  for g in "$PWD"/games/*/; do ln -s "${g%/}" "$GAMES_DIR/"; done
  for dir in "${EXTRA[@]}"; do
    case "$dir" in /*) ;; *) dir="${LOCAL_TABLE_CWD:-$PWD}/$dir" ;; esac
    [ -d "$dir/games" ] || { echo "--extra $dir: no games/ folder there" >&2; exit 1; }
    for g in "$dir"/games/*/; do ln -sfn "$(cd "$g" && pwd)" "$GAMES_DIR/"; done
    echo "Extra games from $dir ($(git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')): $(cd "$dir/games" && ls -d */ | tr -d / | tr '\n' ' ')"
  done
  export GAMES_DIR
fi
export PORT DATA_DIR
export TABLE_KEY="$(cat "$KEY_FILE")"
export TABLE_NAME="${TABLE_NAME:-$default_name}"
export CLOUD_URL="${CLOUD_URL-https://games.skylar.technology}"
export SHOW_TEST_GAMES="${SHOW_TEST_GAMES:-0}"
[ -n "${PUBLIC_URL:-}" ] && export PUBLIC_URL
[ -n "${TABLE_CODE:-}" ] && export TABLE_CODE

cat <<EOF
Game Table host on this computer
  board:     http://localhost:$PORT/board/   (only from this computer)
  phones:    scan the QR code on the board${PUBLIC_URL:+ ($PUBLIC_URL)}
  service:   ${CLOUD_URL:-none (development mode)}
  data:      $DATA_DIR   (API key: X-Table-Key from $KEY_FILE)
If the system asks whether "node" may accept incoming connections, allow it, or phones cannot join.
If the board shows a pairing code, approve it at ${CLOUD_URL:-the service}/admin, or give the table an
access code from the console: start with --code ABCD-EFGH, or type it in the board's settings.
Stop with Ctrl-C.

EOF

opener=""
[ "$(uname)" = "Darwin" ] && opener=open
[ -z "$opener" ] && command -v xdg-open >/dev/null 2>&1 && opener=xdg-open
if [ "$OPEN" = 1 ] && [ -n "$opener" ]; then
  # Open the board once the host answers (in the background, so the host's log stays in this terminal).
  ( for _ in $(seq 1 60); do
      curl -fs "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && { "$opener" "http://localhost:$PORT/board/" >/dev/null 2>&1; exit 0; }
      sleep 0.5
    done ) &
fi

exec node apps/table-host/src/main.ts
