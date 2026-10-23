#!/usr/bin/env bash
# The old name of scripts/local-table.sh (D-188): the same options, e.g. --branch production.
exec "$(dirname "$0")/local-table.sh" "$@"
