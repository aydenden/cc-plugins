#!/usr/bin/env bash
# cmux-spawn-oc.sh — open a right-split cmux pane that tails the OC NDJSON stream
# piped through oc-stream-format.sh, so the pane shows live human-readable progress.
#   $1 = SESSION (cc session id, used in title only)
#   $2 = TAIL_TARGET (file path — typically events.ndjson from opencode CLI)
# stdout: surface id (e.g. "surface:42") or empty when cmux missing.
#
# Notes on the cmux contract (as observed on v0.64.x):
#   * `cmux new-split <dir>` returns a line like "OK surface:77 workspace:3" — there
#     is NO `--command` flag yet, despite some old docs. We use the two-step
#     pattern: new-split first, then `send` the command + Enter.
#   * Surface ids must be extracted from the response via `grep -oE 'surface:[0-9]+'`;
#     a naive `${raw#surface:}` leaves the "OK " prefix and breaks subsequent calls.
set -euo pipefail

SESSION="${1:?session id required}"
TAIL="${2:?tail target file required}"

if ! command -v cmux >/dev/null 2>&1; then
  exit 0
fi

# ensure tail target's parent exists; create the file only if missing so we
# never truncate a file the agent has already started writing to.
mkdir -p "$(dirname "$TAIL")"
[ -e "$TAIL" ] || : > "$TAIL"

PLUGIN_BIN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORMATTER="$PLUGIN_BIN/oc-stream-format.sh"
if [ -x "$FORMATTER" ]; then
  # formatter follows the file itself — no `tail -F | ...` (which block-buffers
  # on macOS BSD tail and never flushes for small files).
  CMD="clear; '$FORMATTER' '$TAIL'"
else
  CMD="clear; tail -F '$TAIL'"
fi

# 1) create the split
raw=$(cmux new-split right 2>/dev/null || true)
SURFACE=$(printf '%s' "$raw" | grep -oE 'surface:[0-9]+' | head -1)
if [ -z "$SURFACE" ]; then
  # could not parse — bail out silently so the agent still proceeds
  exit 0
fi

# 2) send the command + Enter into the new surface
#    cmux interprets a literal newline as Enter for `send`.
cmux send --surface "$SURFACE" "$CMD"$'\n' >/dev/null 2>&1 || true

echo "$SURFACE"
