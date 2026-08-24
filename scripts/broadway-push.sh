#!/usr/bin/env bash
# broadway-push.sh — upload a local static build to Broadway for instant preview
#
# Usage:
#   BROADWAY_TOKEN=<your-token> ./scripts/broadway-push.sh <slug> <build-dir>
#
# Example (Next.js):
#   next build          # produces out/
#   BROADWAY_TOKEN=<your-token> ./scripts/broadway-push.sh akashml ./out
#
# Example (Astro):
#   astro build         # produces dist/
#   BROADWAY_TOKEN=<your-token> ./scripts/broadway-push.sh my-site ./dist
#
# The preview will be live at: https://branch-<slug>.akash.world

set -euo pipefail

SLUG="${1:?Usage: broadway-push.sh <slug> <build-dir>}"
DIR="${2:?Usage: broadway-push.sh <slug> <build-dir>}"
TOKEN="${BROADWAY_TOKEN:?Set BROADWAY_TOKEN env var}"
BROADWAY="${BROADWAY_URL:-https://broadway.akash.world}"

if [ ! -d "$DIR" ]; then
  echo "Error: '$DIR' is not a directory" >&2
  exit 1
fi

TMP=$(mktemp /tmp/broadway-XXXXXX.zip)
trap 'rm -f "$TMP"' EXIT

echo "Zipping $DIR…"
(cd "$DIR" && zip -r "$TMP" . -x "*.DS_Store" -x "__MACOSX/*" > /dev/null)

SIZE=$(du -sh "$TMP" | cut -f1)
echo "Uploading ${SIZE} as 'branch-${SLUG}'…"

RESPONSE=$(curl -sf -X POST "$BROADWAY/api/upload" \
  -H "x-deploy-token: $TOKEN" \
  -F "slug=$SLUG" \
  -F "file=@$TMP")

URL=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['previewUrl'])" 2>/dev/null || echo "")

if [ -n "$URL" ]; then
  echo ""
  echo "✓ Live at: $URL"
else
  echo "Upload failed: $RESPONSE" >&2
  exit 1
fi
