#!/bin/bash
# PreToolUse hook: Block direct "git worktree remove" via Bash tool
# Allows removal only when authorized via marker file (set by /worktree-task:remove skill)
set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if echo "$COMMAND" | grep -qE 'git\s+worktree\s+remove'; then
  # Check marker file for authorization from /worktree-task:remove skill
  REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
  MARKER_FILE="${REPO_ROOT:-.}/.claude/pending-worktree-cleanup.json"

  if [ -f "$MARKER_FILE" ] && jq -e '.authorized == true' "$MARKER_FILE" > /dev/null 2>&1; then
    exit 0
  fi

  echo "BLOCKED: Do not run 'git worktree remove' directly — it will crash the session." >&2
  echo "Use /worktree-task:remove instead. It safely changes the working directory before deletion." >&2
  exit 2
fi

exit 0
