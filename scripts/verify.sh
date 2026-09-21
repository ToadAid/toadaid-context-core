#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

printf '%s\n' '=== TOADAID CONTEXT CORE P1 VERIFY ==='
printf 'node: '
node --version
printf '\n%s\n' '--- tests ---'
node --test test/*.test.mjs
status=$?

printf '\n%s\n' '--- tree ---'
find . -maxdepth 3 -type f \
  -not -path './.git/*' \
  -not -path './.toadaid-context/*' \
  | sort

exit "$status"
