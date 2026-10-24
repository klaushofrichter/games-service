#!/usr/bin/env bash
# Prints a release's notes, in the order the cluster's requirements set: the curated CHANGELOG [Unreleased] notes
# (dropped when empty), the commits since the previous release tag, and "Verified at release": what the deploy
# itself observed. Run by deploy-production.yml after the smoke test passed; render it locally with stub values:
#   TAG=v2026.10.12.1 SERVED=2026.10.12.1 PAGE_CODE=200 ADMIN="302 https://games.skylar.technology/" \
#   CHECKED_AT=2026-10-12T21:00:00Z GITHUB_RUN_ID=1 GITHUB_REPOSITORY=klaushofrichter/games-service scripts/release-notes.sh
set -euo pipefail
: "${TAG:?}" "${SERVED:?}" "${PAGE_CODE:?}" "${ADMIN:?}" "${CHECKED_AT:?}" "${GITHUB_RUN_ID:?}" "${GITHUB_REPOSITORY:?}"
BASE="${BASE:-https://games.skylar.technology}"
SERVER="${GITHUB_SERVER_URL:-https://github.com}"
cd "$(dirname "$0")/.."

# PREV: the previous release, by default the newest tag but this one (set it to render an older release's notes again).
prev=${PREV:-$(git tag --list 'v*' --sort=-creatordate | grep -vx "$TAG" | head -1 || true)}

# The curated notes: the [Unreleased] lines of CHANGELOG.md that were added since the previous release, so each note is
# published once, even when the section is not emptied after a release (D-173). Without a previous release: all of it.
section=$(awk '/^## \[Unreleased\]/{on=1; next} /^## /{on=0} on' CHANGELOG.md 2>/dev/null || true)
if [ -n "$prev" ]; then
  added=$(git diff --unified=0 "$prev" HEAD -- CHANGELOG.md | grep '^+' | grep -v '^+++' | cut -c2- || true)
  curated=$(awk 'NR == FNR { if ($0 != "") a[$0] = 1; next } ($0 in a)' <(printf '%s\n' "$added") <(printf '%s\n' "$section"))
else
  curated=$section
fi
curated=$(printf '%s\n' "$curated" | sed '/./,$!d')
if [ -n "$(printf '%s' "$curated" | tr -d '[:space:]')" ]; then printf '%s\n\n' "$curated"; fi

printf '### Changes\n\n'
if [ -n "$prev" ]; then
  git log --no-merges --pretty='- %s' "$prev..HEAD"
  printf '\n[Compare %s...%s](%s/%s/compare/%s...%s)\n' "$prev" "$TAG" "$SERVER" "$GITHUB_REPOSITORY" "$prev" "$TAG"
else
  git log --no-merges --pretty='- %s' -n 30 HEAD
  printf '\nFirst release.\n'
fi

printf '\n### Verified at release\n\n'
printf -- '- Rollout: deployment/games-cloud reached its new generation with every replica available\n'
printf -- '- `GET %s/health` -> 200, reported version `%s`, matching the build this run stamped\n' "$BASE" "$SERVED"
printf -- '- `GET %s/` -> %s, version label `%s` present\n' "$BASE" "$PAGE_CODE" "$SERVED"
printf -- '- `GET %s` without a session -> `%s` (sign-in enforced)\n' "${ADMIN_URL:-$BASE/admin}" "$ADMIN"
printf -- '- Checked at %s by [run %s](%s/%s/actions/runs/%s)\n' "$CHECKED_AT" "$GITHUB_RUN_ID" "$SERVER" "$GITHUB_REPOSITORY" "$GITHUB_RUN_ID"
