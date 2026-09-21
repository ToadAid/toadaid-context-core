#!/usr/bin/env bash
set -uo pipefail

WORKSPACE="${1:-${GITHUB_WORKSPACE:-$(pwd)}}"
FAILED=0

printf '%s\n' '=== CONTEXT CORE BWRAP VERIFICATION ==='
printf 'workspace: %s\n' "$WORKSPACE"

if [ ! -d "$WORKSPACE" ]; then
  echo 'FAILED: workspace directory missing'
  FAILED=1
fi

for cmd in bwrap node bash; do
  if command -v "$cmd" >/dev/null 2>&1; then
    printf '%s: %s\n' "$cmd" "$(command -v "$cmd")"
  else
    printf 'FAILED: required command absent: %s\n' "$cmd"
    FAILED=1
  fi
done

if [ "$FAILED" -eq 0 ]; then
  printf 'bwrap_version: '
  bwrap --version 2>&1 | head -n 1 || FAILED=1
  printf 'node_version: '
  node --version || FAILED=1
fi

if [ "$FAILED" -eq 0 ]; then
  echo 'boundary: source=read-only env=cleared network=unshared home=ephemeral caps=dropped'

  if bwrap \
      --die-with-parent \
      --new-session \
      --unshare-all \
      --cap-drop ALL \
      --clearenv \
      --setenv PATH /usr/local/bin:/usr/bin:/bin \
      --setenv HOME /tmp/home \
      --setenv CI true \
      --ro-bind /usr /usr \
      --ro-bind-try /usr/local /usr/local \
      --ro-bind /lib /lib \
      --ro-bind-try /lib64 /lib64 \
      --dir /etc \
      --ro-bind-try /etc/ld.so.cache /etc/ld.so.cache \
      --ro-bind-try /etc/localtime /etc/localtime \
      --proc /proc \
      --dev /dev \
      --tmpfs /tmp \
      --dir /tmp/home \
      --ro-bind "$WORKSPACE" /workspace \
      --chdir /workspace \
      /usr/bin/bash -c '
        set -uo pipefail
        printf "%s\n" "--- isolated tests ---"
        node --test test/*.test.mjs
        test_status=$?
        printf "test_status: %s\n" "$test_status"

        printf "%s\n" "--- isolated demo ---"
        node bin/demo.mjs > /tmp/context-core-demo.json
        demo_status=$?
        printf "demo_status: %s\n" "$demo_status"

        printf "%s\n" "--- demo JSON validation ---"
        node -e "JSON.parse(require(\"fs\").readFileSync(\"/tmp/context-core-demo.json\", \"utf8\")); console.log(\"demo_json: VALID\")"
        json_status=$?

        if [ "$test_status" -eq 0 ] && [ "$demo_status" -eq 0 ] && [ "$json_status" -eq 0 ]; then
          true
        else
          false
        fi
      '
  then
    echo 'BWRAP_VERIFICATION: PASS'
  else
    echo 'BWRAP_VERIFICATION: FAIL'
    FAILED=1
  fi
fi

if [ "$FAILED" -eq 0 ]; then
  echo 'CI_RESULT: PASS'
  true
else
  echo 'CI_RESULT: FAIL'
  false
fi
