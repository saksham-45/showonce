#!/bin/sh
# Build the placeholder how-to clip: 60s, five 12s phases standing in for the
# five steps of a paper-airplane fold. Each phase has a distinct hue and tone so
# frames and the audio track visibly change across steps.
# Source: fully synthesized with ffmpeg lavfi inputs (testsrc2 + sine); no real
# footage. Swap for the real expert clip via SHOWNCE_CLIP or the upload form.
set -eu

OUT="${1:-placeholder-clip.mp4}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

i=0
SEGS=""
while [ "$i" -lt 5 ]; do
  HUE=$((i * 72))
  FREQ=$((220 + i * 110))
  SEG="$TMP/seg$i.mp4"
  ffmpeg -y -v error \
    -f lavfi -i "testsrc2=size=320x240:rate=30, hue=h=$HUE" \
    -f lavfi -i "sine=frequency=$FREQ:duration=12" \
    -t 12 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$SEG"
  echo "file '$SEG'" >> "$TMP/list.txt"
  SEGS="$SEGS $SEG"
  i=$((i + 1))
done

ffmpeg -y -v error -f concat -safe 0 -i "$TMP/list.txt" -c copy "$OUT"
echo "wrote $OUT"
