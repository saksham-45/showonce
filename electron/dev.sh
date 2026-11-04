#!/bin/sh
# Dev shell: start `next dev`, wait for it, then open the Electron window on
# it. Usage: npm run electron:dev  (or ELECTRON_DEV_URL=http://localhost:3001 electron .)
set -eu

ROOT="$(dirname "$0")/.."
DEV_URL="${ELECTRON_DEV_URL:-http://localhost:3000}"
PORT="$(printf '%s' "$DEV_URL" | sed -E 's#.*:([0-9]+)/?.*#\1#')"

(cd "$ROOT" && npm run dev -- -p "$PORT" >/tmp/showonce-electron-dev.log 2>&1) &
DEV_PID=$!
trap 'kill $DEV_PID 2>/dev/null || true' EXIT INT TERM

i=0
until curl -s -o /dev/null "$DEV_URL/api/skills" || [ "$i" -ge 60 ]; do
  i=$((i + 1))
  sleep 1
done

ELECTRON_DEV_URL="$DEV_URL" npx --no-install electron "$ROOT"
