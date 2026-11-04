#!/bin/sh
# Electron smoke: prove the packaged macOS app boots its bundled server.
# Run after `npm run dist:mac`; points at dist/ and launches the app binary
# with --showonce-smoke, which starts the server, hits /api/skills, and
# exits 0/1 without opening a window.
#
#   sh scripts/smoke-electron.sh
set -eu

ROOT="$(dirname "$0")/.."
APP="$(find "$ROOT/dist" -maxdepth 2 -name '*.app' 2>/dev/null | head -1 || true)"
if [ -z "$APP" ]; then
  echo "no packaged .app in $ROOT/dist — run 'npm run dist:mac' first" >&2
  exit 2
fi
BIN="$APP/Contents/MacOS/ShowOnce"
if [ ! -x "$BIN" ]; then
  echo "app binary missing: $BIN" >&2
  exit 2
fi

pass=0
[ -f "$ROOT/electron/main.js" ] || { echo "FAIL electron main missing" >&2; exit 1; }
pass=$((pass + 1)); echo "ok electron main present"
[ -f "$ROOT/electron-builder.yml" ] || { echo "FAIL builder config missing" >&2; exit 1; }
pass=$((pass + 1)); echo "ok builder config present"
[ -f "$ROOT/.next/standalone/server.js" ] || { echo "FAIL standalone server not staged" >&2; exit 1; }
pass=$((pass + 1)); echo "ok standalone server staged"

OUT_FILE="$(mktemp)"
# Watchdog: a windowed app that cannot init (headless CI, no WindowServer)
# must fail loudly, not hang the smoke.
SHOWNCE_ELECTRON_SMOKE=1 "$BIN" --showonce-smoke >"$OUT_FILE" 2>&1 &
PID=$!
i=0
while kill -0 $PID 2>/dev/null && [ "$i" -lt 120 ]; do sleep 1; i=$((i + 1)); done
if kill -0 $PID 2>/dev/null; then
  kill $PID 2>/dev/null || true
  echo "FAIL packaged app did not exit within 120s (no WindowServer?)" >&2
  tail -5 "$OUT_FILE" >&2
  exit 1
fi
wait $PID || { echo "FAIL packaged app exited nonzero" >&2; cat "$OUT_FILE" >&2; exit 1; }
tail -5 "$OUT_FILE"
grep -q "electron-smoke ok GET" "$OUT_FILE" || { echo "FAIL packaged app did not boot" >&2; exit 1; }
grep -q "electron-smoke ok POST /api/lookup" "$OUT_FILE" || { echo "FAIL packaged app route missing" >&2; exit 1; }
grep -q "electron-smoke ok GET /$" "$OUT_FILE" || { echo "FAIL packaged app home missing" >&2; exit 1; }
rm -f "$OUT_FILE"
pass=$((pass + 1)); echo "ok packaged macOS app boots and serves"

echo "smoke-electron: $pass checks passed ($APP)"
