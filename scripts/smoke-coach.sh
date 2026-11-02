#!/bin/sh
# Coach-loop smoke: stub end-to-end proof of the compare endpoint and its
# wiring to the Learn pipeline. Needs a server running with
# SHOWNCE_PROVIDER=stub and a clip:
#   SHOWNCE_PROVIDER=stub npm run start -- -p 3101 &
#   SHOWNCE_SMOKE_CLIP=path/to/clip.mp4 sh scripts/smoke-coach.sh http://localhost:3101
set -eu

BASE="${1:-http://localhost:3101}"
CLIP="${SHOWNCE_SMOKE_CLIP:-}"
if [ -z "$CLIP" ]; then
  echo "set SHOWNCE_SMOKE_CLIP to a short clip file" >&2
  exit 2
fi

pass=0
check() { # check <name> <expected-status> <curl-args...>
  name="$1"; want="$2"; shift 2
  got="$(curl -s -m 30 -o /tmp/smoke-coach-body -w '%{http_code}' "$@")"
  if [ "$got" != "$want" ]; then
    echo "FAIL $name: want HTTP $want, got HTTP $got" >&2
    cat /tmp/smoke-coach-body >&2
    exit 1
  fi
  pass=$((pass + 1))
  echo "ok $name (HTTP $got)"
}

ID="$(curl -s -m 60 -F "clip=@$CLIP;type=video/mp4" -F 'title=Fold a paper airplane' "$BASE/api/skills")"
ID="$(printf '%s' "$ID" | python3 -c 'import json,sys; print(json.load(sys.stdin)["skillId"])')"
check "coach-learn-run" 200 -X POST "$BASE/api/skills/$ID/run"
python3 - "$ID" <<'EOF'
import json, sys
graph = json.load(open("/tmp/smoke-coach-body"))
assert graph["skillId"] == sys.argv[1], "skill id mismatch"
assert len(graph["steps"]) == 5, "coach needs the 5 learned steps"
open("/tmp/smoke-coach-steps", "w").write("\n".join(s["id"] for s in graph["steps"]) + "\n")
EOF
pass=$((pass + 1))
echo "ok coach graph: 5 steps listed"

check "coach-page" 200 "$BASE/coach/$ID"
check "learn-page" 200 "$BASE/skills/$ID"
# The coach view shows this reference image; like the clip, it must serve for
# a skill learned after the server booted.
check "coach-reference-serves" 200 "$BASE/skills/$ID/references/step-1.png"

# A usable still frame passes the current step.
FRAME="$(head -c 2000 /dev/urandom | base64 | tr -d '\n')"
printf '{"stepId":"%s","frame":"data:image/jpeg;base64,%s"}' "step-1" "$FRAME" > /tmp/smoke-coach-frame.json
check "compare-correct" 200 -X POST "$BASE/api/skills/$ID/coach" -H 'Content-Type: application/json' -d @/tmp/smoke-coach-frame.json
grep -q '"verdict":"correct"' /tmp/smoke-coach-body || { echo "FAIL correct verdict missing"; exit 1; }
grep -q '"advance":true' /tmp/smoke-coach-body || { echo "FAIL correct advance missing"; exit 1; }
echo "ok correct verdict advances"
pass=$((pass + 1))

# A 1x1 probe frame is visible but useless: hold the learner, do not pass.
printf '{"stepId":"%s","frame":"aGk="}' "step-2" > /tmp/smoke-coach-frame.json
check "compare-nudge" 200 -X POST "$BASE/api/skills/$ID/coach" -H 'Content-Type: application/json' -d @/tmp/smoke-coach-frame.json
grep -q '"verdict":"nudge"' /tmp/smoke-coach-body || { echo "FAIL nudge verdict missing"; exit 1; }
grep -q '"advance":false' /tmp/smoke-coach-body || { echo "FAIL nudge hold missing"; exit 1; }
echo "ok nudge verdict holds"
pass=$((pass + 1))

# No frame at all: the learner is not visible, stay on the step.
printf '{"stepId":"%s","frame":""}' "step-3" > /tmp/smoke-coach-frame.json
check "compare-wrong" 200 -X POST "$BASE/api/skills/$ID/coach" -H 'Content-Type: application/json' -d @/tmp/smoke-coach-frame.json
grep -q '"verdict":"wrong"' /tmp/smoke-coach-body || { echo "FAIL wrong verdict missing"; exit 1; }
grep -q '"advance":false' /tmp/smoke-coach-body || { echo "FAIL wrong hold missing"; exit 1; }
echo "ok wrong verdict holds"
pass=$((pass + 1))

check "unknown-skill-rejected" 404 -X POST "$BASE/api/skills/doesnotexist/coach" -H 'Content-Type: application/json' -d '{"stepId":"step-1","frame":"aGk="}'
check "unknown-step-rejected" 400 -X POST "$BASE/api/skills/$ID/coach" -H 'Content-Type: application/json' -d '{"stepId":"step-9","frame":"aGk="}'
check "missing-step-rejected" 400 -X POST "$BASE/api/skills/$ID/coach" -H 'Content-Type: application/json' -d '{"frame":"aGk="}'
check "malformed-body-rejected" 400 -X POST "$BASE/api/skills/$ID/coach" -H 'Content-Type: application/json' -d 'not json{{{'

# Every learned step must advance on a usable frame: N of N advances is what
# lights the completion badge on the coach page.
n=0
while read -r step; do
  printf '{"stepId":"%s","frame":"data:image/jpeg;base64,%s"}' "$step" "$FRAME" > /tmp/smoke-coach-frame.json
  got="$(curl -s -m 30 -X POST "$BASE/api/skills/$ID/coach" -H 'Content-Type: application/json' -d @/tmp/smoke-coach-frame.json)"
  case "$got" in
    *'"advance":true'*) n=$((n + 1)); echo "ok advance $step";;
    *) echo "FAIL $step did not advance: $got" >&2; exit 1;;
  esac
done < /tmp/smoke-coach-steps
[ "$n" = 5 ] || { echo "FAIL want 5 advances, got $n" >&2; exit 1; }
pass=$((pass + n))

echo "smoke-coach: $pass checks passed (skill $ID)"
