#!/bin/sh
# Overlap smoke: every route at desktop + phone widths, in the website and
# with the desktop-shell class, asserting no visual collisions between
# controls, no horizontal overflow, and focus-ring clearance around fields
# (regression: the lookup submit button used to swallow the query input's
# focused ring). Self-boots a stub prod server; needs headless Chrome
# (CHROME_BIN override) and a production build:
#   npm run build && sh scripts/smoke-overlap.sh
set -eu

CHROME_BIN="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
if [ ! -x "$CHROME_BIN" ]; then
  echo "need headless Chrome for smoke-overlap (CHROME_BIN=$CHROME_BIN)" >&2
  exit 2
fi
[ -f .next/standalone/server.js ] || { echo "run npm run build first" >&2; exit 2; }
command -v ffmpeg >/dev/null 2>&1 || { echo "need ffmpeg for smoke-overlap" >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"; kill $APIDS 2>/dev/null || true' EXIT INT TERM
APIDS=""
PORT="${SHOWNCE_OVERLAP_PORT:-3113}"

cd "$(dirname "$0")/.."
export CHROME_BIN

PORT="$PORT" SHOWNCE_PROVIDER=stub SHOWNCE_DATA_DIR="$TMP/data" npm run start >"$TMP/app.log" 2>&1 &
APIDS="$APIDS $!"
i=0
while [ "$i" -lt 60 ]; do
  if curl -s -m 5 -o /dev/null "http://127.0.0.1:$PORT/api/skills"; then break; fi
  sleep 1
  i=$((i + 1))
done
curl -s -m 5 -o /dev/null "http://127.0.0.1:$PORT/api/skills" || { echo "FAIL app never came up"; cat "$TMP/app.log"; exit 1; }
echo "ok overlap server up"

# A learned skill, so the skill and coach pages audit with real content.
PHASES=2 PHASE_SECS=3 sh scripts/make-placeholder-clip.sh "$TMP/clip.mp4" >/dev/null
export OV_SKILL
OV_SKILL="$(curl -s -m 30 -F "clip=@$TMP/clip.mp4;type=video/mp4" -F 'title=Overlap probe' "http://127.0.0.1:$PORT/api/skills" | python3 -c 'import json,sys; print(json.load(sys.stdin)["skillId"])')"
curl -s -m 60 -X POST "http://127.0.0.1:$PORT/api/skills/$OV_SKILL/run" -o /dev/null
echo "ok overlap skill learned ($OV_SKILL)"

node scripts/audit-overlap.mjs "http://127.0.0.1:$PORT" 9361
echo "ok overlap audit: website, all routes, both widths"
OV_SHELL=1 node scripts/audit-overlap.mjs "http://127.0.0.1:$PORT" 9362
echo "ok overlap audit: desktop-shell class, all routes, both widths"

echo "smoke-overlap: all checks passed"
