#!/bin/bash
# SessionStart hook (asyncRewake): once-a-day deterministic health check of the
# auto-memory for THIS session's project. Runs in the background; if it finds
# stale/bloated/broken items it exits 2 so the result surfaces to the main
# session as a system reminder, where the agent does the semantic judgement.
#
# Deterministic only (free, no LLM): broken internal links, oversized index,
# and date-based staleness. Never deletes anything.
#
# Concurrency: a single `mkdir` of a per-project, per-day lock dir is atomic,
# so among N sessions starting the same day exactly one runs the check.
set -euo pipefail

# --- Limits ---
INDEX_MAX_BYTES=24000
INDEX_MAX_LINES=190
STALE_DAYS=90

command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat)
SOURCE=$(printf '%s' "$INPUT" | jq -r '.source // empty')
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty')

# Only on a brand-new session (skip resume / clear / compact).
[ "$SOURCE" = "startup" ] || exit 0
[ -n "$TRANSCRIPT" ] || exit 0

PROJ_DIR=$(dirname "$TRANSCRIPT")           # ~/.claude/projects/<encoded>
PROJ_ENC=$(basename "$PROJ_DIR")
MEMORY_DIR="$PROJ_DIR/memory"
INDEX="$MEMORY_DIR/MEMORY.md"

# Nothing to check if this project has no auto memory.
[ -f "$INDEX" ] || exit 0

# --- Once-a-day lock (atomic) ---
DATA_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.claude/memory-guard}"
mkdir -p "$DATA_DIR" 2>/dev/null || exit 0
TODAY=$(date +%Y-%m-%d)
LOCK="$DATA_DIR/done-${PROJ_ENC}-${TODAY}"
if ! mkdir "$LOCK" 2>/dev/null; then
  exit 0   # already ran today (or another session is running it now)
fi
# Best-effort cleanup of old lock dirs (>7 days).
find "$DATA_DIR" -maxdepth 1 -type d -name 'done-*' -mtime +7 -exec rm -rf {} + 2>/dev/null || true

# --- Date helpers (BSD/macOS first, then GNU) ---
to_epoch() { date -j -f "%Y-%m-%d" "$1" +%s 2>/dev/null || date -d "$1" +%s 2>/dev/null || echo 0; }
NOW=$(date +%s)

CAND=""
add() { CAND="${CAND}  $1"$'\n'; }

# --- Known memory name: slugs (for wikilink resolution by frontmatter slug) ---
# Wikilinks [[name]] resolve by the target memory's frontmatter `name:` slug,
# which differs from its filename (files carry type prefixes like project_).
# Collect every file's first `name:` value so slug-based links are not flagged.
NAME_SLUGS=$(grep -hm1 -E '^name:[[:space:]]*\S' "$MEMORY_DIR"/*.md 2>/dev/null \
  | sed -E 's/^name:[[:space:]]*//; s/[[:space:]]+$//' || true)

# --- Index size ---
IDX_BYTES=$(wc -c < "$INDEX" | tr -d ' ')
IDX_LINES=$(wc -l < "$INDEX" | tr -d ' ')
if [ "$IDX_BYTES" -gt "$INDEX_MAX_BYTES" ] || [ "$IDX_LINES" -gt "$INDEX_MAX_LINES" ]; then
  add "index-oversized: MEMORY.md ${IDX_BYTES}B / ${IDX_LINES} lines (limit ${INDEX_MAX_BYTES}B / ${INDEX_MAX_LINES})"
fi

# --- Per-file checks over index + topic files ---
# The glob *.md already includes MEMORY.md, so do not list $INDEX separately
# (that would double-count the index's broken links).
for f in "$MEMORY_DIR"/*.md; do
  [ -f "$f" ] || continue
  base=$(basename "$f")

  # Broken markdown links to .md files (internal, relative to memory dir).
  while IFS= read -r target; do
    [ -z "$target" ] && continue
    case "$target" in http*|/*) continue ;; esac   # skip external / absolute
    if [ ! -e "$MEMORY_DIR/$target" ]; then
      add "broken-link: $base -> $target"
    fi
  done < <(grep -oE '\]\([^)]*\.md\)' "$f" 2>/dev/null | sed -E 's/.*\(//; s/\)$//' || true)

  # Broken wikilinks [[name]] or [[name|alias]]. A link resolves if it matches
  # a file by name OR a known frontmatter `name:` slug (the documented form).
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    if [ ! -e "$MEMORY_DIR/$name.md" ] && [ ! -e "$MEMORY_DIR/$name" ] \
       && ! printf '%s\n' "$NAME_SLUGS" | grep -Fxq "$name"; then
      add "broken-wikilink: $base -> [[$name]]"
    fi
  done < <(grep -oE '\[\[[^]]+\]\]' "$f" 2>/dev/null | sed -E 's/^\[\[//; s/\]\]$//; s/\|.*$//' || true)

  # Staleness by latest date stamp in the file body.
  latest=$(grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' "$f" 2>/dev/null | LC_ALL=C sort | tail -1 || true)
  if [ -n "$latest" ]; then
    le=$(to_epoch "$latest")
    if [ "$le" -gt 0 ]; then
      days=$(( (NOW - le) / 86400 ))
      if [ "$days" -gt "$STALE_DAYS" ]; then
        add "stale-date: $base (latest $latest, ${days}d ago)"
      fi
    fi
  fi
done

# Quiet when healthy.
[ -z "$CAND" ] && exit 0

{
  echo "[memory-guard] Daily memory check found items needing attention in $MEMORY_DIR:"
  printf '%s' "$CAND"
  echo "Action (do NOT auto-delete):"
  echo "  - index-oversized      : move detail into topic files, keep index lines lean"
  echo "  - broken-link/wikilink : fix the link, or remove the dead reference"
  echo "  - stale-date           : verify the underlying source; keep / update / archive"
  echo "  Archive to $MEMORY_DIR/archive/ (or mark) and confirm with the user."
  echo "  Verify any code-link/source claims yourself before acting."
} >&2
exit 2
