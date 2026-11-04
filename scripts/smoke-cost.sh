#!/bin/sh
# API cost-budgeting smoke: fixed budgets, zero-call reruns, caps, usage.
# Boots its own servers (stub + a fake Meta API counting every request), so
# it needs no ambient server and spends no real key:
#   npm run build && sh scripts/smoke-cost.sh
# Needs: ffmpeg, python3, curl, a production build.
set -eu

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"; kill $APIDS $FAKE_PID 2>/dev/null || true' EXIT INT TERM
APIDS=""
FAKE_PID=""
pass=0

FAKE_PORT="${SHOWNCE_COST_FAKE_PORT:-3123}"
STUB_PORT="${SHOWNCE_COST_STUB_PORT:-3111}"
META_PORT="${SHOWNCE_COST_META_PORT:-3112}"
COUNTS="$TMP/counts.log"
: > "$COUNTS"

need() { command -v "$1" >/dev/null 2>&1 || { echo "need $1 for smoke-cost" >&2; exit 2; }; }
need ffmpeg; need python3; need curl; need node; need npm
[ -f .next/standalone/server.js ] || { echo "run npm run build first" >&2; exit 2; }

check() { # check <name> <expected-status> <curl-args...>
  name="$1"; want="$2"; shift 2
  got="$(curl -s -m 90 -o "$TMP/body" -w '%{http_code}' "$@")"
  if [ "$got" != "$want" ]; then
    echo "FAIL $name: want HTTP $want, got HTTP $got" >&2
    cat "$TMP/body" >&2
    exit 1
  fi
  pass=$((pass + 1))
  echo "ok $name (HTTP $got)"
}

calls() { # calls [substring] -> number of fake-Meta requests (optionally filtered)
  if [ $# -eq 0 ]; then wc -l < "$COUNTS" | tr -d ' '; else grep -c "$1" "$COUNTS" || true; fi
}

start_app() { # start_app <port> <data-dir> <cache-dir>; extra env via $APP_ENV
  port="$1"; datadir="$2"; cachedir="$3"
  mkdir -p "$datadir" "$cachedir"
  # shellcheck disable=SC2086
  env PORT="$port" SHOWNCE_DATA_DIR="$datadir" SHOWNCE_CACHE_DIR="$cachedir" $APP_ENV npm run start >"$TMP/app-$port.log" 2>&1 &
  echo "started app on $port (pid $!)"
  APIDS="$APIDS $!"
  i=0
  while [ "$i" -lt 60 ]; do
    if curl -s -m 5 -o /dev/null "http://127.0.0.1:$port/api/skills"; then return 0; fi
    sleep 1; i=$((i + 1))
  done
  echo "FAIL app on $port never came up" >&2
  cat "$TMP/app-$port.log" >&2
  exit 1
}

stop_apps() {
  # shellcheck disable=SC2086
  kill $APIDS 2>/dev/null || true
  APIDS=""
  sleep 1
}

cd "$(dirname "$0")/.."

echo "--- phase A: stub path makes zero API calls, usage starts at zero ---"
APP_ENV="SHOWNCE_PROVIDER=stub" start_app "$STUB_PORT" "$TMP/stub-data" "$TMP/stub-cache"
STUB="http://127.0.0.1:$STUB_PORT"

check "usage-starts-zero" 200 "$STUB/api/usage"
python3 - "$TMP/body" <<'EOF'
import json, sys
u = json.load(open(sys.argv[1]))
assert u["apiCalls"]["total"] == 0, u["apiCalls"]
assert u["runs"] == {"learn": 0, "lookup": 0, "coach": 0, "coachMeta": 0}, u["runs"]
assert u["cacheHits"] == 0 and u["dedupHits"] == 0
print("ok usage starts at zero")
EOF
pass=$((pass + 1))

PHASES=2 PHASE_SECS=3 sh scripts/make-placeholder-clip.sh "$TMP/clip6.mp4" >/dev/null
ID="$(curl -s -m 30 -F "clip=@$TMP/clip6.mp4;type=video/mp4" -F 'title=Cost tune' "$STUB/api/skills" | python3 -c 'import json,sys; print(json.load(sys.stdin)["skillId"])')"
check "stub-learn-run" 200 -X POST "$STUB/api/skills/$ID/run"
python3 - "$ID" "$TMP/body" <<'EOF'
import json, sys
graph = json.load(open(sys.argv[2]))
assert graph["skillId"] == sys.argv[1], "skill id mismatch"
assert len(graph["steps"]) == 5, f'want 5 steps, got {len(graph["steps"])}'
print("ok stub graph: 5 steps, same features")
EOF
pass=$((pass + 1))

check "stub-usage-still-zero-calls" 200 "$STUB/api/usage"
python3 - "$TMP/body" <<'EOF'
import json, sys
u = json.load(open(sys.argv[1]))
assert u["apiCalls"]["total"] == 0, u["apiCalls"]
assert u["runs"]["learn"] == 1, u["runs"]
print("ok stub learn ran with zero API calls")
EOF
pass=$((pass + 1))

check "stub-lookup" 200 -X POST "$STUB/api/lookup" -H 'Content-Type: application/json' -d '{"query":"fold a paper airplane"}'
grep -q '"via":"stub"' "$TMP/body" || { echo "FAIL stub lookup via missing" >&2; exit 1; }
echo "ok stub lookup via"
pass=$((pass + 1))
check "stub-lookup-no-calls" 200 "$STUB/api/usage"
python3 - "$TMP/body" <<'EOF'
import json, sys
u = json.load(open(sys.argv[1]))
assert u["apiCalls"]["total"] == 0, u["apiCalls"]
assert u["runs"]["lookup"] == 1, u["runs"]
print("ok stub lookup added zero API calls")
EOF
pass=$((pass + 1))

# The usage section lives on /profile (moved from home in #11); its SSR
# first paint carries the loading state before the client fetch resolves.
curl -s "$STUB/profile" -o "$TMP/profile.html"
grep -q 'API usage' "$TMP/profile.html" || { echo "FAIL profile usage section missing" >&2; exit 1; }
grep -q 'Loading usage' "$TMP/profile.html" || { echo "FAIL profile usage loading-first state missing" >&2; exit 1; }
echo "ok profile usage section with loading-first state"
pass=$((pass + 1))
stop_apps

echo "--- phase B: metered Meta path against the counting fake ---"
export SHOWNCE_COST_COUNTS="$COUNTS"
python3 scripts/fake-meta.py "$FAKE_PORT" >"$TMP/fake.log" 2>&1 &
FAKE_PID="$!"
i=0
while [ "$i" -lt 30 ]; do
  if curl -s -m 2 -o /dev/null "http://127.0.0.1:$FAKE_PORT/"; then break; fi
  sleep 1; i=$((i + 1))
done
curl -s -m 2 -o /dev/null "http://127.0.0.1:$FAKE_PORT/" || { echo "FAIL fake Meta never came up" >&2; exit 1; }
echo "ok fake Meta up"

APP_ENV="SHOWNCE_PROVIDER=meta META_API_KEY=fake-test-key META_API_BASE=http://127.0.0.1:$FAKE_PORT" \
  start_app "$META_PORT" "$TMP/meta-data" "$TMP/meta-cache"
META="http://127.0.0.1:$META_PORT"

ID="$(curl -s -m 30 -F "clip=@$TMP/clip6.mp4;type=video/mp4" -F 'title=Cost tune' "$META/api/skills" | python3 -c 'import json,sys; print(json.load(sys.stdin)["skillId"])')"
check "meta-learn-run" 200 -X POST "$META/api/skills/$ID/run"
python3 - "$ID" "$TMP/body" <<'EOF'
import json, sys
graph = json.load(open(sys.argv[2]))
assert graph["skillId"] == sys.argv[1], "skill id mismatch"
assert len(graph["steps"]) == 5, f'want 5 steps, got {len(graph["steps"])}'
print("ok metered graph: 5 steps, same features")
EOF
pass=$((pass + 1))

# Cold run over 6 frames, 5 steps: 6 segment + 1 transcribe + 1 fuse = 8
# /responses calls + 5 reference calls. This is the "before" number every
# rerun used to repay.
[ "$(calls /responses)" = "8" ] || { echo "FAIL want 8 responses, got $(calls /responses)" >&2; exit 1; }
[ "$(calls /images/generations)" = "5" ] || { echo "FAIL want 5 reference images" >&2; exit 1; }
[ "$(calls)" = "13" ] || { echo "FAIL want 13 calls, got $(calls)" >&2; exit 1; }
echo "ok cold learn cost exactly 13 calls (8 responses + 5 images)"
pass=$((pass + 1))

check "meta-rerun" 200 -X POST "$META/api/skills/$ID/run"
[ "$(calls)" = "13" ] || { echo "FAIL rerun made new calls: $(calls) total" >&2; exit 1; }
echo "ok identical rerun made zero new calls"
pass=$((pass + 1))
check "meta-rerun-cache-hits" 200 "$META/api/usage"
python3 - "$TMP/body" <<'EOF'
import json, sys
u = json.load(open(sys.argv[1]))
assert u["apiCalls"]["total"] == 13, u["apiCalls"]
assert u["cacheHits"] >= 13, u["cacheHits"]
assert u["runs"]["learn"] == 2, u["runs"]
print(f'ok rerun served from cache ({u["cacheHits"]} hits, 13 calls total)')
EOF
pass=$((pass + 1))

check "meta-lookup" 200 -X POST "$META/api/lookup" -H 'Content-Type: application/json' -d '{"query":"fake skill query"}'
grep -q '"via":"meta"' "$TMP/body" || { echo "FAIL meta lookup via missing" >&2; exit 1; }
echo "ok meta lookup via"
pass=$((pass + 1))
# 8 learn responses + 1 lookup response.
[ "$(calls /responses)" = "9" ] || { echo "FAIL want 9 responses, got $(calls /responses)" >&2; exit 1; }
check "meta-lookup-repeat" 200 -X POST "$META/api/lookup" -H 'Content-Type: application/json' -d '{"query":"  FAKE Skill   Query "}'
[ "$(calls /responses)" = "9" ] || { echo "FAIL repeated query made a new call" >&2; exit 1; }
python3 - "$TMP/body" <<'EOF'
import json, sys
guide = json.load(open(sys.argv[1]))
assert len(guide["steps"]) == 5, "repeat lookup must parse the same 5 steps"
assert guide["query"] == "FAKE Skill Query", guide["query"]
print("ok repeated query: zero new calls, same steps, current spelling echoed")
EOF
pass=$((pass + 1))

FRAME="$(head -c 2000 /dev/urandom | base64 | tr -d '\n')"
printf '{"stepId":"step-1","frame":"data:image/jpeg;base64,%s"}' "$FRAME" > "$TMP/frame.json"
responses_before="$(calls /responses)"
check "meta-coach" 200 -X POST "$META/api/skills/$ID/coach" -H 'Content-Type: application/json' -d @"$TMP/frame.json"
grep -q '"verdict":"correct"' "$TMP/body" || { echo "FAIL coach verdict missing" >&2; exit 1; }
grep -q '"advance":true' "$TMP/body" || { echo "FAIL coach advance missing" >&2; exit 1; }
cp "$TMP/body" "$TMP/coach-first.json"
[ "$(calls /responses)" = "$((responses_before + 2))" ] || { echo "FAIL want segment+judge calls" >&2; exit 1; }
echo "ok coach tick costs segment+judge (2 calls)"
pass=$((pass + 1))
check "meta-coach-repeat" 200 -X POST "$META/api/skills/$ID/coach" -H 'Content-Type: application/json' -d @"$TMP/frame.json"
cmp -s "$TMP/coach-first.json" "$TMP/body" || { echo "FAIL deduped verdict differs" >&2; exit 1; }
[ "$(calls /responses)" = "$((responses_before + 2))" ] || { echo "FAIL repeated tick made new calls" >&2; exit 1; }
echo "ok identical tick dedups to zero new calls with the same verdict"
pass=$((pass + 1))
# Streaming variant on a fresh frame: phases plus the meta verdict.
FRAME2="$(head -c 2000 /dev/urandom | base64 | tr -d '\n')"
printf '{"stepId":"step-2","frame":"data:image/jpeg;base64,%s"}' "$FRAME2" > "$TMP/frame2.json"
check "meta-coach-stream" 200 -X POST "$META/api/skills/$ID/coach" -H 'Content-Type: application/json' -H 'Accept: application/x-ndjson' -d @"$TMP/frame2.json"
grep -q '"phase":"received"' "$TMP/body" || { echo "FAIL stream received phase missing" >&2; exit 1; }
grep -q '"verdict":"correct"' "$TMP/body" || { echo "FAIL stream verdict missing" >&2; exit 1; }
grep -q '"via":"meta"' "$TMP/body" || { echo "FAIL stream meta via missing" >&2; exit 1; }
echo "ok stream phases plus meta verdict"
pass=$((pass + 1))

check "usage-cumulative" 200 "$META/api/usage"
python3 - "$TMP/body" <<'EOF'
import json, sys
u = json.load(open(sys.argv[1]))
assert u["apiCalls"]["total"] == 18, u["apiCalls"]
assert u["framesSent"] == 6, u["framesSent"]
assert u["transcriptCharsSent"] > 0, u["transcriptCharsSent"]
assert u["tokens"]["total"] > 0, u.get("tokens")
assert u["runs"]["learn"] == 2 and u["runs"]["lookup"] == 2, u["runs"]
assert u["runs"]["coach"] == 3 and u["runs"]["coachMeta"] == 2, u["runs"]
assert u["budgets"]["apiCallCap"] == 124, u["budgets"]
print(f'ok cumulative usage: 18 calls {u["apiCalls"]["byModel"]} tokens {u["tokens"]}, dedup {u["dedupHits"]}')
EOF
pass=$((pass + 1))
stop_apps

echo "--- phase C: per-run cap fails fast with a named 429 ---"
APP_ENV="SHOWNCE_PROVIDER=meta META_API_KEY=fake-test-key META_API_BASE=http://127.0.0.1:$FAKE_PORT SHOWNCE_API_CALL_CAP=2" \
  start_app "$META_PORT" "$TMP/cap-data" "$TMP/cap-cache"
capped_before="$(calls)"
ID="$(curl -s -m 30 -F "clip=@$TMP/clip6.mp4;type=video/mp4" -F 'title=Cap probe' "$META/api/skills" | python3 -c 'import json,sys; print(json.load(sys.stdin)["skillId"])')"
check "cap-run-refused" 429 -X POST "$META/api/skills/$ID/run"
grep -q "API call cap" "$TMP/body" || { echo "FAIL cap message must name the cap" >&2; exit 1; }
echo "ok capped run answers 429 naming the cap"
pass=$((pass + 1))
[ "$(( $(calls) - capped_before ))" = "2" ] || { echo "FAIL cap must trip after exactly 2 attempts" >&2; exit 1; }
echo "ok cap tripped after exactly 2 attempts, then refused"
pass=$((pass + 1))
stop_apps

echo "--- phase D: frame budget holds on the metered path ---"
PHASES=4 PHASE_SECS=3 sh scripts/make-placeholder-clip.sh "$TMP/clip12.mp4" >/dev/null
b_responses="$(calls /responses)"
b_imgs="$(calls /images/generations)"; b_total="$(calls)"
APP_ENV="SHOWNCE_PROVIDER=meta META_API_KEY=fake-test-key META_API_BASE=http://127.0.0.1:$FAKE_PORT SHOWNCE_MODEL_FRAMES=8" \
  start_app "$META_PORT" "$TMP/budget-data" "$TMP/budget-cache"
ID="$(curl -s -m 30 -F "clip=@$TMP/clip12.mp4;type=video/mp4" -F 'title=Budget probe' "$META/api/skills" | python3 -c 'import json,sys; print(json.load(sys.stdin)["skillId"])')"
check "budget-learn-run" 200 -X POST "$META/api/skills/$ID/run"
# 12 sampled frames reduced to the 8-frame budget: 8 segment + 1 transcribe
# + 1 fuse = 10 /responses + 5 reference images = 15 calls (an unbudgeted
# run would have cost 12+1+1+5 = 19).
[ "$(( $(calls /responses) - b_responses ))" = "10" ] || { echo "FAIL want 10 responses, diff $(( $(calls /responses) - b_responses ))" >&2; exit 1; }
[ "$(( $(calls /images/generations) - b_imgs ))" = "5" ] || { echo "FAIL want 5 reference images" >&2; exit 1; }
[ "$(( $(calls) - b_total ))" = "15" ] || { echo "FAIL want 15 calls, diff $(( $(calls) - b_total ))" >&2; exit 1; }
echo "ok 12-frame clip cost the 8-frame budget: 10 responses + 5 images = 15 calls"
pass=$((pass + 1))
check "budget-usage-frames" 200 "$META/api/usage"
python3 - "$TMP/body" <<'EOF'
import json, sys
u = json.load(open(sys.argv[1]))
assert u["framesSent"] == 8, u["framesSent"]
print("ok usage reports exactly the 8 budgeted frames sent")
EOF
pass=$((pass + 1))
stop_apps

echo "smoke-cost: $pass checks passed"
