#!/bin/sh
# Responses transport smoke: every Meta call the Learn + coach flow makes
# must hit POST /responses with the probed shapes (text string, vision
# input_text/input_image, audio input_text/input_audio mp3), and the parser
# must pull answer text out of recorded-style payloads (a leading
# non-message entry plus the message/output_text entry plus a usage block).
# Boots its own servers (strict validating fake + production app), so it
# needs no ambient server and spends no real key:
#   npm run build && sh scripts/smoke-meta-responses.sh
# Needs: ffmpeg (with ffprobe + libmp3lame), python3, curl, a production build.
set -eu

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"; kill $APIDS $STRICT_PID 2>/dev/null || true' EXIT INT TERM
APIDS=""
STRICT_PID=""
pass=0

STRICT_PORT="${SHOWNCE_RT_FAKE_PORT:-3127}"
META_PORT="${SHOWNCE_RT_META_PORT:-3126}"
BODIES="$TMP/bodies.jsonl"
: > "$BODIES"

need() { command -v "$1" >/dev/null 2>&1 || { echo "need $1 for smoke-meta-responses" >&2; exit 2; }; }
need ffmpeg; need ffprobe; need python3; need curl; need node; need npm
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

cd "$(dirname "$0")/.."

echo "--- strict fake up ---"
export STRICT_BODIES="$BODIES"
python3 scripts/fake-meta-strict.py "$STRICT_PORT" >"$TMP/strict.log" 2>&1 &
STRICT_PID="$!"
i=0
while [ "$i" -lt 30 ]; do
  if curl -s -m 2 -o /dev/null "http://127.0.0.1:$STRICT_PORT/"; then break; fi
  sleep 1; i=$((i + 1))
done
curl -s -m 2 -o /dev/null "http://127.0.0.1:$STRICT_PORT/" || { echo "FAIL strict fake never came up" >&2; exit 1; }
echo "ok strict fake up"

echo "--- app up ---"
mkdir -p "$TMP/meta-data" "$TMP/meta-cache"
env PORT="$META_PORT" SHOWNCE_DATA_DIR="$TMP/meta-data" SHOWNCE_CACHE_DIR="$TMP/meta-cache" \
  SHOWNCE_PROVIDER=meta META_API_KEY=fake-test-key META_API_BASE="http://127.0.0.1:$STRICT_PORT" \
  npm run start >"$TMP/app.log" 2>&1 &
APIDS="$!"
META="http://127.0.0.1:$META_PORT"
i=0
while [ "$i" -lt 60 ]; do
  if curl -s -m 5 -o /dev/null "$META/api/skills"; then break; fi
  sleep 1; i=$((i + 1))
done
curl -s -m 5 -o /dev/null "$META/api/skills" || { echo "FAIL app never came up" >&2; cat "$TMP/app.log" >&2; exit 1; }
echo "ok app up"

echo "--- learn over 2 frames ---"
PHASES=1 PHASE_SECS=2 sh scripts/make-placeholder-clip.sh "$TMP/clip2.mp4" >/dev/null
ID="$(curl -s -m 30 -F "clip=@$TMP/clip2.mp4;type=video/mp4" -F 'title=Responses probe' "$META/api/skills" | python3 -c 'import json,sys; print(json.load(sys.stdin)["skillId"])')"
check "responses-learn-run" 200 -X POST "$META/api/skills/$ID/run"
python3 - "$ID" "$TMP/body" <<'EOF'
import json, sys
graph = json.load(open(sys.argv[2]))
assert graph["skillId"] == sys.argv[1], "skill id mismatch"
assert len(graph["steps"]) == 5, f'want 5 steps, got {len(graph["steps"])}'
print("ok learn graph: 5 steps parsed from the recorded-style payload")
EOF
pass=$((pass + 1))

# The strict fake answers NONE to transcription and empty text to sam-3.1:
# the transcript must be empty and every mask regionless, with the run
# still succeeding through the non-fatal paths.
python3 - "$TMP/meta-data/$ID" <<'EOF'
import json, glob, sys
transcript = json.load(open(f"{sys.argv[1]}/transcript.json"))
assert transcript["segments"] == [], transcript
masks = sorted(glob.glob(f"{sys.argv[1]}/masks/*.json"))
assert len(masks) == 2, masks
for m in masks:
    assert json.load(open(m))["regions"] == [], m
print("ok NONE transcript is empty and sam silence fused as zero regions")
EOF
pass=$((pass + 1))

echo "--- coach tick ---"
FRAME="$(head -c 2000 /dev/urandom | base64 | tr -d '\n')"
printf '%s' "$FRAME" > "$TMP/sent-frame.b64"
printf '{"stepId":"step-1","frame":"data:image/jpeg;base64,%s"}' "$FRAME" > "$TMP/frame.json"
check "responses-coach" 200 -X POST "$META/api/skills/$ID/coach" -H 'Content-Type: application/json' -d @"$TMP/frame.json"
grep -q '"verdict":"correct"' "$TMP/body" || { echo "FAIL coach verdict missing" >&2; exit 1; }
grep -q '"advance":true' "$TMP/body" || { echo "FAIL coach advance missing" >&2; exit 1; }
# The non-stream route carries no via marker; the recorded judge body below
# proves the Meta path (not the stub fallback) served this verdict.
echo "ok coach verdict correct with regions unavailable"
pass=$((pass + 1))

echo "--- recorded request bodies match shapes 2-4 ---"
SENT_FRAME="$TMP/sent-frame.b64" BODIES="$BODIES" OUT_MP3="$TMP/sent-audio.mp3" python3 - <<'EOF'
import base64, json, os

rows = [json.loads(line) for line in open(os.environ["BODIES"]) if line.strip()]
paths = [r["path"] for r in rows]
assert set(paths) <= {"/responses", "/images/generations"}, paths
assert "/chat/completions" not in paths and "/audio/transcriptions" not in paths, paths
bodies = [r["body"] for r in rows if r["path"] == "/responses"]
assert len(bodies) == 6, f"want 2 segment + 1 transcribe + 1 fuse + 2 coach, got {len(bodies)}"

segs = [b for b in bodies if b.get("model") == "sam-3.1"]
assert len(segs) == 3, f"want 2 learn + 1 coach sam-3.1 calls, got {len(segs)}"
for b in segs:
    (item,) = b["input"]
    assert item["role"] == "user"
    text, image = item["content"]
    assert text["type"] == "input_text" and text["text"].startswith("List the visible hands")
    assert image["type"] == "input_image"
    assert image["image_url"].startswith("data:image/jpeg;base64,")

fuses = [b for b in bodies if isinstance(b.get("input"), str)]
assert len(fuses) == 1, f"want 1 text fuse call, got {len(fuses)}"
assert fuses[0]["model"] == "muse-spark-1.3"
assert "You fuse video segmentation summaries" in fuses[0]["input"]
payload = json.loads(fuses[0]["input"][fuses[0]["input"].rindex("\n{") + 1:])
assert set(("frames", "segmentations", "transcript")) <= set(payload), payload.keys()

audios = [b for b in bodies if isinstance(b.get("input"), list) and any(
    p.get("type") == "input_audio" for i in b["input"] for p in i.get("content", []))]
assert len(audios) == 1, f"want 1 audio call, got {len(audios)}"
(item,) = audios[0]["input"]
text, audio = item["content"]
assert audios[0]["model"] == "muse-spark-1.3"
assert text == {"type": "input_text",
                "text": "Transcribe any speech in this audio. If none, reply NONE."}, text
assert audio["type"] == "input_audio"
assert audio["input_audio"]["format"] == "mp3"
open(os.environ["OUT_MP3"], "wb").write(base64.b64decode(audio["input_audio"]["data"]))

judges = [b for b in bodies if b not in segs and b not in fuses and b not in audios]
assert len(judges) == 1, f"want 1 judge call, got {len(judges)}"
(item,) = judges[0]["input"]
assert judges[0]["model"] == "muse-spark-1.3"
text, live, ref = item["content"]
assert text["type"] == "input_text" and '"verdict"' in text["text"]
assert live == {"type": "input_image",
                "image_url": "data:image/jpeg;base64," + open(os.environ["SENT_FRAME"]).read()}, "live frame must go first, byte-identical"
assert ref["type"] == "input_image" and ref["image_url"].startswith("data:image/png;base64,")
print("ok 6 /responses bodies match the text / vision / audio shapes, live frame first")
EOF
pass=$((pass + 1))

# The transcribe payload must be a real mp3, not relabeled bytes.
CODEC="$(ffprobe -v error -show_entries stream=codec_name -of csv=p=0 "$TMP/sent-audio.mp3")"
[ "$CODEC" = "mp3" ] || { echo "FAIL transcribe audio is $CODEC, want mp3" >&2; exit 1; }
echo "ok transcribe audio probes as mp3"
pass=$((pass + 1))

check "responses-usage" 200 "$META/api/usage"
python3 - "$TMP/body" <<'EOF'
import json, sys
u = json.load(open(sys.argv[1]))
assert u["apiCalls"]["total"] == 11, u["apiCalls"]
assert u["apiCalls"]["byModel"] == {"sam-3.1": 3, "muse-spark-1.3": 3, "muse-image-1.0": 5}, u["apiCalls"]
assert u["tokens"]["total"] > 0, u.get("tokens")
print(f'ok usage: 11 calls {u["apiCalls"]["byModel"]}, tokens {u["tokens"]}')
EOF
pass=$((pass + 1))

echo "smoke-meta-responses: $pass checks passed"
