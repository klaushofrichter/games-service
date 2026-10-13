#!/usr/bin/env bash
# Creates the GitHub release $TAG at this commit with the given notes. Runs only after the deploy verified the
# build, so a failed deploy cuts no release. A re-run of the same deploy does not release twice.
set -euo pipefail
: "${TAG:?}" "${GITHUB_REPOSITORY:?}" "${GITHUB_SHA:?}"
NOTES="${1:?notes file}"
if gh release view "$TAG" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
  echo "$TAG already released - skipping."; exit 0
fi
gh release create "$TAG" --repo "$GITHUB_REPOSITORY" --target "$GITHUB_SHA" --title "$TAG" --notes-file "$NOTES"
