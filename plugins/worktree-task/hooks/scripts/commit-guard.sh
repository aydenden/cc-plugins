#!/bin/bash
# Stop hook: Block session stop if there are uncommitted changes
set -euo pipefail

# Skip in main session — only active in worktree agents
if [ -z "${HOOK_AGENT_ID:-}" ]; then
  exit 0
fi

# Skip if not a git repo
if ! git rev-parse --git-dir &>/dev/null; then
  exit 0
fi

# No need on main/master (main-guard blocks edits there)
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
  exit 0
fi

# Check for uncommitted changes
CHANGES=$(git status --porcelain 2>/dev/null || true)
if [ -n "$CHANGES" ]; then
  CHANGE_COUNT=$(echo "$CHANGES" | wc -l | tr -d ' ')
  echo "${CHANGE_COUNT} uncommitted change(s) found. Please commit before stopping." >&2
  echo "" >&2
  echo "Changed files:" >&2
  echo "$CHANGES" | head -20 >&2
  if [ "$CHANGE_COUNT" -gt 20 ]; then
    echo "... and $((CHANGE_COUNT - 20)) more" >&2
  fi
  exit 1
fi

# Check for unpushed commits
UNPUSHED=$(git log --oneline @{upstream}..HEAD 2>/dev/null || true)
if [ -n "$UNPUSHED" ]; then
  UNPUSHED_COUNT=$(echo "$UNPUSHED" | wc -l | tr -d ' ')
  # Warn only — do not block
  echo "WARNING: ${UNPUSHED_COUNT} unpushed commit(s). Consider running git push."
fi

exit 0
