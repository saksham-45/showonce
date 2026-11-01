#!/bin/sh
# Reusable Learn-pipeline smoke: stub end-to-end proof plus upload/pipeline
# edge cases. Needs a dev server running with SHOWNCE_PROVIDER=stub and a clip:
#   SHOWNCE_PROVIDER=stub npm run dev -- -p 3101 &
#   SHOWNCE_SMOKE_CLIP=path/to/clip.mp4 sh scripts/smoke-learn.sh http://localhost:3101
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
  got="$(curl -s -o /tmp/smoke-learn-body -w '%{http_code}' "$@")"
  if [ "$got" != "$want" ]; then
    echo "FAIL $name: want HTTP $want, got HTTP $got" >&2
    cat /tmp/smoke-learn-body >&2
    exit 1
  fi
  pass=$((pass + 1))
  echo "ok $name (HTTP $got)"
}

check "list-skills" 200 "$BASE/api/skills"

: > /tmp/smoke-empty.mp4
check "empty-upload-rejected" 400 -F 'clip=@/tmp/smoke-empty.mp4' -F 'title=x' "$BASE/api/skills"

echo "not a video" > /tmp/smoke-note.txt
check "wrong-type-rejected" 400 -F 'clip=@/tmp/smoke-note.txt;type=text/plain' -F 'title=x' "$BASE/api/skills"

ID="$(curl -s -F 'clip=@/tmp/smoke-note.txt;type=video/mp4' -F 'title=junk' "$BASE/api/skills" | python3 -c 'import json,sys; print(json.load(sys.stdin)["skillId"])')"
check "invalid-video-run-rejected" 400 -X POST "$BASE/api/skills/$ID/run"
grep -q "not valid video" /tmp/smoke-learn-body || { echo "FAIL invalid-video message"; exit 1; }
echo "ok invalid-video message names the cause"

ID="$(curl -s -F "clip=@$CLIP;type=video/mp4" -F 'title=Fold a paper airplane' "$BASE/api/skills" | python3 -c 'import json,sys; print(json.load(sys.stdin)["skillId"])')"
check "learn-run" 200 -X POST "$BASE/api/skills/$ID/run"
python3 - "$ID" <<'EOF'
import json, sys
skill = sys.argv[1]
body = open("/tmp/smoke-learn-body").read()
graph = json.loads(body)
assert graph["skillId"] == skill, "skill id mismatch"
assert len(graph["steps"]) == 5, f'want 5 steps, got {len(graph["steps"])}'
for step in graph["steps"]:
    for key in ("id", "instruction", "checkpoint", "keyframe", "referenceImage", "mistakes"):
        assert step[key], f'{step.get("id")}: empty {key}'
print("ok skill graph: 5 complete steps")
EOF
pass=$((pass + 1))

check "clip-serves" 200 "$BASE/skills/$ID/clip.mp4"
check "keyframe-serves" 200 "$BASE/skills/$ID/keyframes/step-1.jpg"
check "reference-serves" 200 "$BASE/skills/$ID/references/step-1.png"
check "skill-page" 200 "$BASE/skills/$ID"

echo "smoke-learn: $pass checks passed (skill $ID)"
