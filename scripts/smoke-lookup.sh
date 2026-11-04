#!/bin/sh
# Web-lookup smoke: stub end-to-end proof of the search-and-distill flow.
# Needs a server running with SHOWNCE_PROVIDER=stub:
#   PORT=3101 SHOWNCE_PROVIDER=stub npm run start &
#   sh scripts/smoke-lookup.sh http://localhost:3101
set -eu

BASE="${1:-http://localhost:3101}"

pass=0
check() { # check <name> <expected-status> <curl-args...>
  name="$1"; want="$2"; shift 2
  got="$(curl -s -m 30 -o /tmp/smoke-lookup-body -w '%{http_code}' "$@")"
  if [ "$got" != "$want" ]; then
    echo "FAIL $name: want HTTP $want, got HTTP $got" >&2
    cat /tmp/smoke-lookup-body >&2
    exit 1
  fi
  pass=$((pass + 1))
  echo "ok $name (HTTP $got)"
}

check "lookup-empty-rejected" 400 -X POST "$BASE/api/lookup" -H 'Content-Type: application/json' -d '{"query":""}'
check "lookup-missing-rejected" 400 -X POST "$BASE/api/lookup" -H 'Content-Type: application/json' -d '{}'
check "lookup-malformed-rejected" 400 -X POST "$BASE/api/lookup" -H 'Content-Type: application/json' -d 'not json{{{'
LONG="$(python3 -c 'print("x"*141)')"
check "lookup-long-rejected" 400 -X POST "$BASE/api/lookup" -H 'Content-Type: application/json' -d "{\"query\":\"$LONG\"}"

check "lookup-ok" 200 -X POST "$BASE/api/lookup" -H 'Content-Type: application/json' -d '{"query":"fold a paper airplane"}'
python3 - <<'EOF'
import json
guide = json.load(open("/tmp/smoke-lookup-body"))
assert guide["query"] == "fold a paper airplane", guide.get("query")
assert guide["via"] == "stub", guide.get("via")
assert len(guide["videos"]) >= 2, "want videos to watch"
assert len(guide["articles"]) >= 2, "want written instructions"
assert len(guide["steps"]) == 5, f'want 5 steps, got {len(guide["steps"])}'
assert len(guide["sources"]) >= 4, "want cited sources"
for video in guide["videos"]:
    assert video["title"] and video["url"], f"video incomplete: {video}"
for article in guide["articles"]:
    assert article["title"] and article["url"], f"article incomplete: {article}"
for step in guide["steps"]:
    for key in ("instruction", "checkpoint", "mistakes"):
        assert step[key], f'step missing {key}'
for source in guide["sources"]:
    assert source["title"] and source["url"].startswith("http"), f"source uncited: {source}"
print("ok lookup guide: videos, articles, 5 steps, cited sources")
EOF
pass=$((pass + 1))

# Saving the guide creates a coachable skill with cited sources attached.
GUIDE="$(cat /tmp/smoke-lookup-body)"
ID="$(curl -s -m 30 -X POST "$BASE/api/skills/from-guide" -H 'Content-Type: application/json' \
  -d "$(python3 -c 'import json,sys; print(json.dumps({"title": "Fold a paper airplane (web)", "guide": json.load(open("/tmp/smoke-lookup-body"))}))')" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["skillId"])')"
check "from-guide-graph" 200 "$BASE/api/skills/$ID"
python3 - "$ID" <<'EOF'
import json, sys
graph = json.load(open("/tmp/smoke-lookup-body"))
assert graph["skillId"] == sys.argv[1], "skill id mismatch"
assert len(graph["steps"]) == 5, "guide skill needs the 5 distilled steps"
for step in graph["steps"]:
    for key in ("id", "instruction", "checkpoint", "keyframe", "referenceImage", "mistakes"):
        assert step[key], f'{step.get("id")}: empty {key}'
print("ok guide skill: 5 complete steps")
EOF
pass=$((pass + 1))

check "guide-sources" 200 "$BASE/api/skills/$ID/guide"
python3 - <<'EOF'
import json
guide = json.load(open("/tmp/smoke-lookup-body"))
assert len(guide["videos"]) >= 2 and len(guide["articles"]) >= 2, "saved sources missing"
assert len(guide["sources"]) >= 4, "saved citations missing"
print("ok saved guide serves videos, articles, citations")
EOF
pass=$((pass + 1))

# Guide art serves for a skill saved after boot (PNG placeholders).
check "guide-keyframe-serves" 200 "$BASE/skills/$ID/keyframes/step-1.png"
check "guide-reference-serves" 200 "$BASE/skills/$ID/references/step-1.png"
check "guide-skill-page" 200 "$BASE/skills/$ID"

# The saved guide feeds the existing coach loop: a usable frame advances.
FRAME="$(head -c 2000 /dev/urandom | base64 | tr -d '\n')"
check "guide-coach-advance" 200 -X POST "$BASE/api/skills/$ID/coach" -H 'Content-Type: application/json' \
  -d "{\"stepId\":\"step-1\",\"frame\":\"data:image/jpeg;base64,$FRAME\"}"
grep -q '"verdict":"correct"' /tmp/smoke-lookup-body || { echo "FAIL guide coach verdict missing" >&2; exit 1; }
grep -q '"advance":true' /tmp/smoke-lookup-body || { echo "FAIL guide coach advance missing" >&2; exit 1; }
echo "ok guide skill coaches: correct verdict advances"
pass=$((pass + 1))

# Guide skills need no clip: the skill-assets route 404s instead of hanging.
check "guide-clip-absent" 404 "$BASE/skills/$ID/clip.mp4"
check "guide-missing" 404 "$BASE/api/skills/doesnotexist/guide"

# Saving validates its input: no empty titles, no stepless guides, no
# sourceless saves, no non-URL citations.
check "from-guide-empty-title" 400 -X POST "$BASE/api/skills/from-guide" -H 'Content-Type: application/json' -d '{"title":"","guide":{"steps":[]}}'
check "from-guide-no-steps" 400 -X POST "$BASE/api/skills/from-guide" -H 'Content-Type: application/json' -d '{"title":"x","guide":{"steps":[]}}'
check "from-guide-no-guide" 400 -X POST "$BASE/api/skills/from-guide" -H 'Content-Type: application/json' -d '{"title":"x"}'
check "from-guide-no-sources" 400 -X POST "$BASE/api/skills/from-guide" -H 'Content-Type: application/json' \
  -d '{"title":"x","guide":{"steps":[{"instruction":"do it","checkpoint":"see it","mistakes":[]}],"videos":[],"articles":[],"sources":[]}}'

# The home first paint offers the lookup entry alongside the typed finder.
curl -s "$BASE/" -o /tmp/smoke-lookup-home.html
grep -q 'Search the web for a skill' /tmp/smoke-lookup-home.html || { echo "FAIL home lookup entry missing" >&2; exit 1; }
echo "ok home offers web lookup"
pass=$((pass + 1))

# Voice search: a mic control sits beside each typed query, anchored to its
# field, with the typed input always present as fallback. The SSR first
# paint is the no-recognition state (headless curl has no SpeechRecognition),
# which proves the unsupported path; capable browsers upgrade on hydration.
for field in finder-home web-lookup; do
  grep -q "data-voice-for=\"$field\"" /tmp/smoke-lookup-home.html || { echo "FAIL home voice mic for $field missing" >&2; exit 1; }
  grep -q "id=\"$field\"" /tmp/smoke-lookup-home.html || { echo "FAIL home typed fallback for $field missing" >&2; exit 1; }
done
echo "ok home voice mics anchored to typed fields (finder-home, web-lookup)"
pass=$((pass + 1))
grep -q 'data-testid="voice-mic"' /tmp/smoke-lookup-home.html || { echo "FAIL home voice mic missing" >&2; exit 1; }
grep -q 'Voice search not supported in this browser' /tmp/smoke-lookup-home.html || { echo "FAIL home voice fallback note missing" >&2; exit 1; }
echo "ok home voice fallback state (typed path, no-support note)"
pass=$((pass + 1))

echo "smoke-lookup: $pass checks passed (skill $ID)"
