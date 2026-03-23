#!/bin/bash
# WorktreeRemove hook — write cleanup marker instead of deleting
# Actual cleanup is deferred to main session via SubagentStop hook
# stdin: { "worktree_path": "..." }
set -euo pipefail

log() { echo "[worktree-remove] $*" >&2; }

INPUT=$(cat)
WORKTREE_PATH=$(echo "$INPUT" | jq -r '.worktree_path')

if [ -z "$WORKTREE_PATH" ] || [ ! -d "$WORKTREE_PATH" ]; then
  log "Worktree not found: $WORKTREE_PATH"
  exit 0
fi

# Collect info before deferring cleanup
BRANCH=$(cd "$WORKTREE_PATH" && git rev-parse --abbrev-ref HEAD 2>/dev/null || true)

REPO_ROOT=$(git -C "$WORKTREE_PATH" rev-parse --path-format=absolute --git-common-dir 2>/dev/null | sed 's|/\.bare$||; s|/\.git$||')
if [ -z "$REPO_ROOT" ]; then
  log "Cannot determine repo root"
  exit 0
fi

# Collect commit info for review
BASE_BRANCH=$(cd "$REPO_ROOT" && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
COMMIT_COUNT=$(cd "$WORKTREE_PATH" && git rev-list --count "$BASE_BRANCH".."$BRANCH" 2>/dev/null || echo "0")
FIRST_COMMIT=$(cd "$WORKTREE_PATH" && git rev-list --reverse "$BASE_BRANCH".."$BRANCH" 2>/dev/null | head -1 | cut -c1-7 || true)
LAST_COMMIT=$(cd "$WORKTREE_PATH" && git rev-parse --short HEAD 2>/dev/null || true)

# Write marker file for SubagentStop hook to pick up
MARKER_DIR="$REPO_ROOT/.claude"
mkdir -p "$MARKER_DIR"
MARKER_FILE="$MARKER_DIR/pending-worktree-cleanup.json"

cat > "$MARKER_FILE" <<MARKER_EOF
{
  "worktree_path": "$WORKTREE_PATH",
  "branch": "$BRANCH",
  "base_branch": "$BASE_BRANCH",
  "repo_root": "$REPO_ROOT",
  "commit_count": $COMMIT_COUNT,
  "first_commit": "$FIRST_COMMIT",
  "last_commit": "$LAST_COMMIT",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
MARKER_EOF

log "Cleanup deferred — marker written: $MARKER_FILE"
log "Branch: $BRANCH ($COMMIT_COUNT commits)"
