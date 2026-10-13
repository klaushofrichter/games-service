#!/usr/bin/env bash
# Fails the `codeql` check on any CodeQL finding, because the analyze action alone never fails the job.
# Each finding is reported with its rule, file, line and message, so nobody has to dig through the action log.
# Accepted findings live in .github/codeql-accepted.tsv (ruleId<TAB>path<TAB>reason): changing that file takes a
# PR, so accepting a finding is reviewed like any other change. Accepted ones are reported as notices, not hidden.
# CodeQL's own in-source suppressions (results with a `suppressions` entry) are honoured the same way.
#   .github/scripts/codeql-gate.sh sarif-results
set -euo pipefail
DIR="${1:-sarif-results}"
ACCEPTED="$(dirname "$0")/../codeql-accepted.tsv"
shopt -s nullglob
files=("$DIR"/*.sarif)
if [ ${#files[@]} -eq 0 ]; then echo "::error::no SARIF files in $DIR: did CodeQL run?"; exit 1; fi

accepted_keys=""
if [ -f "$ACCEPTED" ]; then
  accepted_keys="$(awk -F'\t' '!/^[[:space:]]*#/ && NF>=3 {print $1"\t"$2}' "$ACCEPTED")"
fi

# jq writes to a file first: inside `< <(...)` a jq error escapes set -e and the gate would read nothing and pass.
results=$(mktemp)
trap 'rm -f "$results"' EXIT
jq -r '.runs[] | (.results // error("a run without results: is this CodeQL SARIF?"))[] | [
    .ruleId,
    (.locations[0].physicalLocation.artifactLocation.uri // "?"),
    (.locations[0].physicalLocation.region.startLine // 0 | tostring),
    ((.suppressions // []) | length > 0 | tostring),
    ((.message.text // "(no message)") | gsub("[\t\n]"; " "))
  ] | @tsv' "${files[@]}" > "$results"

failed=0 noted=0
while IFS=$'\t' read -r rule path line suppressed msg; do
  [ -z "$rule" ] && continue
  if [ "$suppressed" = "true" ] || printf '%s\n' "$accepted_keys" | grep -qxF "$rule"$'\t'"$path"; then
    echo "::notice file=$path,line=$line::accepted CodeQL finding $rule: $msg"
    noted=$((noted + 1))
  else
    echo "::error file=$path,line=$line::CodeQL $rule: $msg"
    failed=$((failed + 1))
  fi
done < "$results"

echo "CodeQL: $failed finding(s) failing the gate, $noted accepted"
[ "$failed" -eq 0 ]
