#!/bin/sh
# Generalization smoke: the same unmodified upload+run path must serve any
# physical skill, not one baked-in example. Learns two distinct synthetic
# clips plus a short third clip, asserting only the generic skill-graph
# contract (steps with id/instruction/checkpoint/keyframe/referenceImage/
# mistakes, assets that serve, pages that render) — never example content.
# Graceful degradation (corrupt clip rejected with a clear 400) rides the
# same path. Needs a stub server:
#   PORT=3101 SHOWNCE_PROVIDER=stub npm run start &
#   sh scripts/smoke-generalize.sh http://localhost:3101
set -eu

BASE="${1:-http://localhost:3101}"
TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT

pass=0
learn() { # learn <clip> <title> — prints skill id
  clip="$1"; title="$2"
  curl -s -m 60 -F "clip=@$clip;type=video/mp4" -F "title=$title" "$BASE/api/skills" |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["skillId"])'
}

check_graph() { # check_graph <skill-id> <label>
  id="$1"; label="$2"
  code="$(curl -s -m 120 -o "$TMPD/graph-$id.json" -w '%{http_code}' -X POST "$BASE/api/skills/$id/run")"
  [ "$code" = 200 ] || { echo "FAIL $label run: HTTP $code"; cat "$TMPD/graph-$id.json"; exit 1; }
  python3 - "$TMPD/graph-$id.json" "$id" <<'EOF'
import json, sys
graph = json.load(open(sys.argv[1]))
assert graph["skillId"] == sys.argv[2], "skill id mismatch"
assert len(graph["steps"]) >= 1, "need at least one step"
for step in graph["steps"]:
    for key in ("id", "instruction", "checkpoint", "keyframe", "referenceImage", "mistakes"):
        assert step[key], f'{step.get("id")}: empty {key}'
EOF
  pass=$((pass + 1))
  echo "ok $label: generic graph validates ($(python3 -c "import json; print(len(json.load(open('$TMPD/graph-$id.json'))['steps']))") steps)"
  for asset in "clip.mp4" "keyframes/step-1.jpg" "references/step-1.png"; do
    code="$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$BASE/skills/$id/$asset")"
    [ "$code" = 200 ] || { echo "FAIL $label asset $asset: HTTP $code"; exit 1; }
  done
  pass=$((pass + 1))
  echo "ok $label: clip, keyframe, and reference serve"
  code="$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$BASE/skills/$id")"
  [ "$code" = 200 ] || { echo "FAIL $label page: HTTP $code"; exit 1; }
  code="$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$BASE/coach/$id")"
  [ "$code" = 200 ] || { echo "FAIL $label coach page: HTTP $code"; exit 1; }
  pass=$((pass + 1))
  echo "ok $label: skill and coach pages render"
}

# Example A: the default 60s five-phase clip.
sh scripts/make-placeholder-clip.sh "$TMPD/a.mp4" >/dev/null
A="$(learn "$TMPD/a.mp4" 'Example A sunset routine')"
check_graph "$A" "example-a"

# Example B: a distinct 36s four-phase clip — different hues, tones, length.
PHASES=4 PHASE_SECS=9 HUE_BASE=200 FREQ_BASE=330 sh scripts/make-placeholder-clip.sh "$TMPD/b.mp4" >/dev/null
B="$(learn "$TMPD/b.mp4" 'Example B morning drill')"
check_graph "$B" "example-b"

# Example C: a 3s micro-clip learns the same generic shape; a corrupt clip on
# the same path fails gracefully with a clear client error, never a hang.
PHASES=1 PHASE_SECS=3 sh scripts/make-placeholder-clip.sh "$TMPD/c.mp4" >/dev/null
C="$(learn "$TMPD/c.mp4" 'Example C micro move')"
check_graph "$C" "example-c"
echo "not a video" > "$TMPD/junk.mp4"
JUNK="$(learn "$TMPD/junk.mp4" 'junk')"
code="$(curl -s -m 60 -o "$TMPD/junk-body" -w '%{http_code}' -X POST "$BASE/api/skills/$JUNK/run")"
[ "$code" = 400 ] || { echo "FAIL corrupt run: want HTTP 400, got HTTP $code"; exit 1; }
grep -q "not valid video" "$TMPD/junk-body" || { echo "FAIL corrupt message names the cause"; exit 1; }
pass=$((pass + 1))
echo "ok example-c: corrupt clip rejected gracefully (HTTP 400, names the cause)"

echo "smoke-generalize: $pass checks passed (skills $A $B $C)"
