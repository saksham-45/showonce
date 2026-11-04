#!/bin/sh
# Desktop-shell smoke: proves the native Electron experience and the
# premium redesign shipped, without needing a display. Static checks cover
# the main-process chrome (titlebar, menu, shortcuts, window state) and the
# renderer shell (drop zone, rail, offline bar, notifications); live checks
# run against a prod server the same way the other smokes do:
#   SHOWNCE_PROVIDER=stub npm run start -- -p 3102 &
#   sh scripts/smoke-desktop.sh http://localhost:3102
set -eu

BASE="${1:-http://localhost:3102}"
ROOT="$(dirname "$0")/.."

pass=0
ok() { pass=$((pass + 1)); echo "ok $1"; }
fail() { echo "FAIL $1" >&2; exit 1; }
need() { # need <name> <file> <pattern>
  grep -q -e "$3" "$ROOT/$2" || fail "$1 ($2 lacks $3)"
  ok "$1"
}

# --- Main process: native chrome, menu, shortcuts, state. ---
[ -f "$ROOT/electron/main.js" ] || fail "electron main missing"
node --check "$ROOT/electron/main.js" || fail "electron main syntax"
ok "electron main parses"
node --check "$ROOT/electron/preload.js" || fail "electron preload syntax"
ok "electron preload parses"

need "hidden titlebar (macOS)" electron/main.js "titleBarStyle.*hidden"
need "traffic-light position" electron/main.js "trafficLightPosition"
need "overlay controls (Windows)" electron/main.js "titleBarOverlay"
need "app menu" electron/main.js "Menu.buildFromTemplate"
need "section shortcuts 1-3" electron/main.js "CmdOrCtrl+1"
need "library shortcut" electron/main.js "CmdOrCtrl+2"
need "profile shortcut" electron/main.js "CmdOrCtrl+3"
need "import-clip shortcut" electron/main.js "CmdOrCtrl+O"
need "window-state persistence" electron/main.js "showonce-window.json"
need "single-instance lock" electron/main.js "requestSingleInstanceLock"
need "about panel" electron/main.js "setAboutPanelOptions"
need "loading page" electron/main.js "loading.html"
need "navigate channel" electron/main.js "showonce:navigate"
need "import channel" electron/main.js "showonce:import-clip"
[ -f "$ROOT/electron/loading.html" ] || fail "loading page missing"
grep -q 'data-testid="desktop-loading"' "$ROOT/electron/loading.html" || fail "loading page markup"
ok "loading page present"
grep -q "electron/loading.html" "$ROOT/electron-builder.yml" || fail "loading page not packaged"
ok "loading page packaged"

# --- Preload: the typed desktop bridge. ---
need "preload desktop flag" electron/preload.js "desktop: true"
need "preload navigate" electron/preload.js "onNavigate"
need "preload import" electron/preload.js "onImportClip"

# --- Renderer: redesign world, shell chrome, notifications. ---
need "neutral theme owns accent" app/globals.css "--accent: #1e6b3f"
need "drop-zone styles" app/globals.css ".dropzone"
need "sidebar rail styles" app/globals.css ".rail"
need "offline bar styles" app/globals.css ".offline-bar"
need "drag strip styles" app/globals.css ".dtitle"
! grep -rq "#3395ff\|#0064e0\|#0a1428\|gradient(" "$ROOT/app" "$ROOT/electron" --include="*.css" --include="*.tsx" --include="*.ts" --include="*.js" --include="*.html" || fail "blue-forward remnants"
ok "no blue-forward remnants in app or shell"
need "refined display face" app/layout.tsx "Fraunces"
need "shell chrome" app/components/ShellChrome.tsx 'data-testid="desktop-shell"'
need "menu IPC answers" app/components/ShellChrome.tsx "onImportClip"
need "offline state" app/components/ShellChrome.tsx 'data-testid="offline-bar"'
need "desktop guard" app/components/desktop.ts "isDesktop"
need "native notices" app/components/desktop.ts "new Notification"
need "clip well" app/components/ClipDropzone.tsx 'data-testid="clip-dropzone"'
need "menu import reaches well" app/components/ClipDropzone.tsx "showonce:import-clip"
need "coach completion notice" "app/coach/[id]/page.tsx" "notifyDesktop"
need "learn finish notice" "app/skills/[id]/page.tsx" "notifyDesktop"

# --- Live prod surface: the new shell UI serves green. ---
HOME_BODY="$(mktemp)"
CODE="$(curl -s -o "$HOME_BODY" -w '%{http_code}' "$BASE/")"
[ "$CODE" = 200 ] || { echo "FAIL GET /: HTTP $CODE" >&2; exit 1; }
ok "GET / serves (HTTP 200)"
grep -q 'data-testid="clip-dropzone"' "$HOME_BODY" || fail "served home lacks drop zone"
ok "served home carries the drop zone"
grep -q 'id="skill-clip"' "$HOME_BODY" || fail "served home lacks clip input"
ok "served home carries the clip input"
grep -q 'class="topbar"' "$HOME_BODY" || fail "served web chrome lacks top bar"
ok "served web chrome keeps the top bar"
grep -q 'desktop-shell' "$HOME_BODY" && fail "web SSR leaks desktop shell" || true
ok "web SSR stays browser chrome"
rm -f "$HOME_BODY"

CSS_FILE="$(find "$ROOT/.next/static" -name '*.css' 2>/dev/null | head -1 || true)"
[ -n "$CSS_FILE" ] || fail "no built CSS to inspect"
grep -q '\.rail' "$CSS_FILE" || fail "built CSS lacks sidebar rail"
grep -q '\.dropzone' "$CSS_FILE" || fail "built CSS lacks drop zone"
grep -q 'Fraunces' "$CSS_FILE" || fail "built CSS lacks display face"
! grep -q '#3395ff' "$CSS_FILE" || fail "built CSS leaks Meta blue"
ok "built CSS ships the redesign"

echo "smoke-desktop: $pass checks passed"
