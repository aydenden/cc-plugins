#!/bin/bash
# WorktreeCreate hook script — runs when Agent tool uses isolation: "worktree"
# stdin: JSON { "name": "...", "cwd": "..." }
set -euo pipefail

log() { echo "[worktree-create] $*" >&2; }

# Read input from stdin
INPUT=$(cat)
NAME=$(echo "$INPUT" | jq -r '.name')
CWD=$(echo "$INPUT" | jq -r '.cwd')

# Fallback to main worktree if CWD is missing
if [ ! -d "$CWD" ]; then
  CWD=$(git worktree list | grep '\[main\]' | awk '{print $1}' || pwd)
fi

# Bare repo root
BARE_ROOT=$(cd "$CWD" && git rev-parse --git-common-dir | xargs dirname)
WORKTREE_DIR="$BARE_ROOT/$NAME"

# Main worktree path
MAIN_DIR=$(cd "$CWD" && git worktree list | grep '\[main\]' | awk '{print $1}' || echo "")

# Create git worktree
log "Creating worktree: $WORKTREE_DIR"
cd "$CWD" && git worktree add "$WORKTREE_DIR" -b "worktree-$NAME" >&2

# Copy .env
if [ -n "$MAIN_DIR" ] && [ -f "$MAIN_DIR/.env" ] && [ ! -f "$WORKTREE_DIR/.env" ]; then
  cp "$MAIN_DIR/.env" "$WORKTREE_DIR/"
  log ".env copied"
fi

# memsearch memory symlink
MEMSEARCH_DIR="$BARE_ROOT/.memsearch/memory"
if [ ! -d "$MEMSEARCH_DIR" ] && [ -n "$MAIN_DIR" ]; then
  MEMSEARCH_DIR="$MAIN_DIR/.memsearch/memory"
fi
if [ -d "$MEMSEARCH_DIR" ]; then
  mkdir -p "$WORKTREE_DIR/.memsearch"
  ln -sfn "$MEMSEARCH_DIR" "$WORKTREE_DIR/.memsearch/memory"
  log "memsearch symlink created"
fi

# beads redirect
if [ -n "$MAIN_DIR" ] && [ -d "$MAIN_DIR/.beads" ]; then
  mkdir -p "$WORKTREE_DIR/.beads"
  echo "$MAIN_DIR/.beads" > "$WORKTREE_DIR/.beads/redirect"
  log "beads redirect created"
fi

# Run project-specific post-create script
LOCAL_CONFIG="$MAIN_DIR/.claude/worktree-task.local.md"
if [ -f "$LOCAL_CONFIG" ]; then
  POST_CREATE=$(sed -n '/^---$/,/^---$/p' "$LOCAL_CONFIG" \
    | grep 'post-create:' \
    | sed 's/.*post-create:\s*//' || true)
  if [ -n "$POST_CREATE" ]; then
    SCRIPT_PATH="$MAIN_DIR/$POST_CREATE"
    if [ -f "$SCRIPT_PATH" ]; then
      log "Running post-create: $SCRIPT_PATH"
      bash "$SCRIPT_PATH" "$WORKTREE_DIR" "$(cd "$CWD" && git rev-parse --abbrev-ref HEAD)" >&2
    fi
  fi
fi

log "Done: $WORKTREE_DIR"

# Output absolute path to stdout
echo "$WORKTREE_DIR"
