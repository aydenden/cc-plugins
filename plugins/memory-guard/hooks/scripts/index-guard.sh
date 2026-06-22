#!/bin/bash
# PreToolUse hook: block writes that bloat the auto-memory index (MEMORY.md).
#
# Strategy: deny ONLY writes that grow the index past its limits. Shrinking
# (cleanup) writes always pass, so the "fix" path is never blocked. Detail
# belongs in topic .md files; the index stays a lean one-line-per-memory list.
#
# Limits are size/line/per-entry based. The result size of an Edit is computed
# from a byte delta (no exact replacement needed): new = old - len(old_string)
# + len(new_string), which is exact for a single replacement.
set -euo pipefail

# --- Limits ---
MAX_BYTES=24000        # ~24KB; SessionStart loads only the first ~24.4KB of MEMORY.md
MAX_LINES=190
ITEM_MAX_CHARS=250     # a single index entry line ("- ...")

# No jq -> cannot inspect tool input; fail open (do not block).
command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty')
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')

# Guard only the auto-memory index file (any project's memory/MEMORY.md).
case "$FILE" in
  */memory/MEMORY.md) ;;
  *) exit 0 ;;
esac

# byte length of a string (no trailing newline added)
blen() { printf '%s' "${1-}" | wc -c | tr -d ' '; }
# line count of a string ("" -> 0)
llen() { [ -z "${1-}" ] && { echo 0; return; }; printf '%s\n' "$1" | wc -l | tr -d ' '; }

if [ -f "$FILE" ]; then
  OLD_BYTES=$(wc -c < "$FILE" | tr -d ' ')
  OLD_LINES=$(wc -l < "$FILE" | tr -d ' ')
else
  OLD_BYTES=0
  OLD_LINES=0
fi

ADDED=""
case "$TOOL" in
  Write)
    CONTENT=$(printf '%s' "$INPUT" | jq -r '.tool_input.content // empty')
    NEW_BYTES=$(blen "$CONTENT")
    NEW_LINES=$(llen "$CONTENT")
    ADDED="$CONTENT"
    ;;
  Edit)
    OLD_STR=$(printf '%s' "$INPUT" | jq -r '.tool_input.old_string // empty')
    NEW_STR=$(printf '%s' "$INPUT" | jq -r '.tool_input.new_string // empty')
    ADDED="$NEW_STR"
    OB=$(blen "$OLD_STR"); NB=$(blen "$NEW_STR")
    OL=$(llen "$OLD_STR"); NL=$(llen "$NEW_STR")
    NEW_BYTES=$(( OLD_BYTES - OB + NB ))
    NEW_LINES=$(( OLD_LINES - OL + NL ))
    ;;
  *) exit 0 ;;
esac

# Shrinking or same size? Always allow — this is the cleanup path.
if [ "$NEW_BYTES" -le "$OLD_BYTES" ]; then
  exit 0
fi

# Longest entry line being ADDED by this write (true UTF-8 char count via wc -m;
# BWK awk on macOS counts bytes, so wc -m is used to honour the "~chars" rule).
# here-string keeps a single expansion of "$ADDED" (no re-execution of any
# command substitution inside the value) and is clearer than a heredoc.
LONGEST_ADDED=0
while IFS= read -r line; do
  printf '%s' "$line" | grep -qE '^[[:space:]]*-[[:space:]]' || continue
  c=$(printf '%s' "$line" | LC_ALL=en_US.UTF-8 wc -m | tr -d ' ')
  if [ "$c" -gt "$LONGEST_ADDED" ]; then LONGEST_ADDED="$c"; fi
done <<< "$ADDED"

# Decide
REASON=""
if [ "$NEW_BYTES" -gt "$MAX_BYTES" ]; then
  REASON="size ${NEW_BYTES}B > ${MAX_BYTES}B"
elif [ "$NEW_LINES" -gt "$MAX_LINES" ]; then
  REASON="lines ${NEW_LINES} > ${MAX_LINES}"
elif [ "$LONGEST_ADDED" -gt "$ITEM_MAX_CHARS" ]; then
  REASON="an added entry is ${LONGEST_ADDED} chars > ${ITEM_MAX_CHARS} (detail belongs in a topic file)"
fi

[ -z "$REASON" ] && exit 0

# Build a diagnostic: the longest current index entries are the best move-out candidates.
TOP_RAW=""
while IFS= read -r entry; do
  ln=${entry%%:*}; body=${entry#*:}
  c=$(printf '%s' "$body" | LC_ALL=en_US.UTF-8 wc -m | tr -d ' ')
  TOP_RAW="${TOP_RAW}${c} L${ln}
"
done < <(grep -nE '^[[:space:]]*-[[:space:]]' "$FILE" 2>/dev/null || true)
TOP=$(printf '%s' "$TOP_RAW" | LC_ALL=C sort -rn | head -5 | awk '{ print "    "$2": "$1" chars" }' || true)

{
  echo "BLOCKED: writing $FILE would bloat the auto-memory index ($REASON)."
  echo "  current: ${OLD_BYTES}B / ${OLD_LINES} lines  ->  after this write: ${NEW_BYTES}B / ${NEW_LINES} lines"
  echo "  limits : ${MAX_BYTES}B / ${MAX_LINES} lines / ${ITEM_MAX_CHARS} chars per entry"
  echo "Fix: move detail (commit hashes, metrics, \"next=...\") into a topic .md file body,"
  echo "     keep only a one-line summary + link in the index. Shrinking/cleanup edits are never blocked."
  if [ -n "$TOP" ]; then
    echo "Longest current index entries (move these to topic files first):"
    echo "$TOP"
  fi
} >&2
exit 2
