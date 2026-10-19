#!/usr/bin/env bash
# Runs every browser end-to-end check, as the `e2e` job in production-checks.yml does:
# a dev Table Host on port 8090 for the game and layout checks, then the admin portal and
# remote play checks (each starts its own cloud service and table host).
#   scripts/e2e/run-all.sh out/
# Needs: node, python3 with `playwright` and Chromium (pip install playwright && playwright install chromium).
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="${1:-e2e-out}"
mkdir -p "$OUT"
DATA="$(mktemp -d)"

PORT=8090 TABLE_KEY=devkey AI_DELAY_MS=300 PUBLIC_URL=http://127.0.0.1:8090 SHOW_TEST_GAMES=1 DATA_DIR="$DATA" \
  node apps/table-host/src/main.ts >"$OUT/table-host.log" 2>&1 &
HOST=$!
trap 'kill $HOST 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -fs http://127.0.0.1:8090/health >/dev/null && break; sleep 0.5; done
curl -fs http://127.0.0.1:8090/health >/dev/null || { echo "::error::the dev Table Host did not start"; cat "$OUT/table-host.log"; exit 1; }

failed=()
run() {
  echo "::group::$*"
  if ! "$@"; then failed+=("$*"); fi
  echo "::endgroup::"
}
for game in roulette pachisi holdem coinflip endings dialogs rules tabs; do run python3 scripts/e2e/play.py "$game" "$OUT"; done
run python3 scripts/e2e/layout.py "$OUT"
run python3 scripts/e2e/admin.py "$OUT"
run python3 scripts/e2e/codes.py "$OUT"
run python3 scripts/e2e/remote.py "$OUT"
run python3 scripts/e2e/invite_name.py "$OUT"
run python3 scripts/e2e/extra.py "$OUT"
run python3 scripts/e2e/ai_wait.py "$OUT"
run python3 scripts/e2e/logs.py "$OUT"
run python3 scripts/e2e/developer.py "$OUT"
run python3 scripts/e2e/seat_loss.py "$OUT"
run python3 scripts/e2e/seats_full.py "$OUT"
run python3 scripts/e2e/rejoin.py "$OUT"
run python3 scripts/e2e/names.py "$OUT"
run python3 scripts/e2e/away.py "$OUT"
run python3 scripts/e2e/exchange.py "$OUT"
run python3 scripts/e2e/exchange_remote.py "$OUT"
run python3 scripts/e2e/viewer.py "$OUT"
run python3 scripts/e2e/one_board.py "$OUT"
run python3 scripts/e2e/settings_choice.py "$OUT"
run python3 scripts/e2e/next_hand.py "$OUT"

if ((${#failed[@]})); then
  printf '::error::e2e failed: %s\n' "${failed[@]}"
  exit 1
fi
echo "all e2e checks passed"
