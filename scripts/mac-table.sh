#!/usr/bin/env bash
# Run a Table Host on this Mac against the live Game Table service, for development and testing.
#   scripts/mac-table.sh              start it, and open the board in the default browser
#   scripts/mac-table.sh --no-open    start it without opening the board
# Overrides (environment): TABLE_NAME, PORT, CLOUD_URL (empty = no cloud), PUBLIC_URL, SHOW_TEST_GAMES, DATA_DIR.
#
# The table's identity (tableId, and its token once approved) and its board API key live in DATA_DIR
# (default ~/.gametable-mac), so a restart is the same table and needs no new approval. The cloud keeps
# pairings in memory, though: after a deploy of games-cloud the board shows a pairing code again.
set -euo pipefail
cd "$(dirname "$0")/.."

OPEN=1
[ "${1:-}" = "--no-open" ] && OPEN=0

major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$major" -lt 26 ]; then
  echo "Node 26 is needed (found: $(node --version 2>/dev/null || echo none)). With nvm: nvm install 26 && nvm use 26" >&2
  exit 1
fi
[ -d node_modules ] || npm ci

DATA_DIR=${DATA_DIR:-$HOME/.gametable-mac}
mkdir -p "$DATA_DIR"
chmod 700 "$DATA_DIR"
KEY_FILE="$DATA_DIR/table-key"
if [ ! -s "$KEY_FILE" ]; then
  (umask 077 && openssl rand -hex 16 > "$KEY_FILE")
fi

PORT=${PORT:-8080}
# The QR code must carry the address phones on the WiFi can reach. Ask macOS which interface the default route
# uses: the host's own guess may pick a VPN or a Docker network instead.
if [ -z "${PUBLIC_URL:-}" ]; then
  ip=""
  if [ "$(uname)" = "Darwin" ]; then
    iface=$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')
    [ -n "$iface" ] && ip=$(ipconfig getifaddr "$iface" 2>/dev/null || true)
  fi
  [ -n "$ip" ] && PUBLIC_URL="http://$ip:$PORT"
fi

default_name="Game Table"
[ "$(uname)" = "Darwin" ] && default_name="$(scutil --get ComputerName 2>/dev/null || echo "Game Table")"

export PORT DATA_DIR
export TABLE_KEY="$(cat "$KEY_FILE")"
export TABLE_NAME="${TABLE_NAME:-$default_name}"
export CLOUD_URL="${CLOUD_URL-https://games.skylar.technology}"
export SHOW_TEST_GAMES="${SHOW_TEST_GAMES:-0}"
[ -n "${PUBLIC_URL:-}" ] && export PUBLIC_URL

cat <<EOF
Game Table host on this Mac
  board:     http://localhost:$PORT/board/   (only from this Mac)
  phones:    scan the QR code on the board${PUBLIC_URL:+ ($PUBLIC_URL)}
  service:   ${CLOUD_URL:-none (development mode)}
  data:      $DATA_DIR   (API key: X-Table-Key from $KEY_FILE)
If macOS asks whether "node" may accept incoming connections, allow it, or phones cannot join.
If the board shows a pairing code, approve it at ${CLOUD_URL:-the service}/admin.
Stop with Ctrl-C.

EOF

if [ "$OPEN" = 1 ] && command -v open >/dev/null 2>&1; then
  # Open the board once the host answers (in the background, so the host's log stays in this terminal).
  ( for _ in $(seq 1 60); do
      curl -fs "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && { open "http://localhost:$PORT/board/"; exit 0; }
      sleep 0.5
    done ) &
fi

exec node apps/table-host/src/main.ts
