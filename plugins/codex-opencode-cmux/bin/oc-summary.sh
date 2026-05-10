#!/usr/bin/env bash
# Extract a compact summary from opencode --format json output.
# Usage: oc-summary.sh <jsonl-file> [--max-bytes 4000]
# Output (stdout): summary text capped at --max-bytes

set -uo pipefail

FILE="${1:-}"
if [ -z "$FILE" ]; then
  echo "Usage: oc-summary.sh <impl-file> [--max-bytes N]" >&2
  exit 1
fi
if [ ! -f "$FILE" ]; then
  echo "Error: file not found: $FILE" >&2
  exit 1
fi

MAX_BYTES=4000
shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --max-bytes) MAX_BYTES="$2"; shift 2;;
    *) shift;;
  esac
done

if ! command -v jq >/dev/null 2>&1; then
  echo "jq not installed" >&2
  exit 1
fi

# Extract:
# 1) Last text response (primary)
# 2) Tool calls summary (truncated args)
# 3) Errors if any
{
  jq -r 'select(.type=="text") | .part.text' "$FILE" 2>/dev/null | tail -n 50
  echo ""
  jq -r 'select(.type=="tool_use") | "[tool] " + (.part.tool // "?") + ": " + ((.part.args // {}) | tostring | .[0:200])' "$FILE" 2>/dev/null | tail -n 20
  echo ""
  jq -r 'select(.type=="error") | "[ERROR] " + (.part.message // tostring)' "$FILE" 2>/dev/null
} | head -c "$MAX_BYTES"
