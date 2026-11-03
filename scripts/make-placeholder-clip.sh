#!/bin/sh
# Build a synthetic how-to clip: N phases of M seconds, each with a distinct
# hue and tone so frames and the audio track visibly change across steps.
# Defaults reproduce the 60s five-phase placeholder; overrides build distinct
# example skills through the same unmodified pipeline:
#   PHASES=4 PHASE_SECS=9 HUE_BASE=200 sh scripts/make-placeholder-clip.sh b.mp4
# Source: fully synthesized with ffmpeg lavfi inputs (testsrc2 + sine); no real
# footage. Swap for the real expert clip via SHOWNCE_CLIP or the upload form.
set -eu

OUT="${1:-placeholder-clip.mp4}"
PHASES="${PHASES:-5}"
# NB: not SECONDS — bash already owns that name (shell uptime), so an
# override would silently build a zero-length clip.
PHASE_SECS="${PHASE_SECS:-12}"
HUE_BASE="${HUE_BASE:-0}"
HUE_STEP="${HUE_STEP:-72}"
FREQ_BASE="${FREQ_BASE:-220}"
FREQ_STEP="${FREQ_STEP:-110}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

i=0
SEGS=""
while [ "$i" -lt "$PHASES" ]; do
  HUE=$((HUE_BASE + i * HUE_STEP))
  FREQ=$((FREQ_BASE + i * FREQ_STEP))
  SEG="$TMP/seg$i.mp4"
  ffmpeg -y -v error \
    -f lavfi -i "testsrc2=size=320x240:rate=30, hue=h=$HUE" \
    -f lavfi -i "sine=frequency=$FREQ:duration=$PHASE_SECS" \
    -t "$PHASE_SECS" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$SEG"
  echo "file '$SEG'" >> "$TMP/list.txt"
  SEGS="$SEGS $SEG"
  i=$((i + 1))
done

ffmpeg -y -v error -f concat -safe 0 -i "$TMP/list.txt" -c copy "$OUT"
echo "wrote $OUT ($PHASES phases x ${PHASE_SECS}s)"
