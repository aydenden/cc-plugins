#!/bin/bash
# PreToolUse hook: Block Edit/Write on protected branches
# Only active when protected-branches is configured in .claude/worktree-task.local.md
set -euo pipefail

# Skip in main session — only protect in worktree agents
if [ -z "${HOOK_AGENT_ID:-}" ]; then
  exit 0
fi

# Check project config — skip if not present
LOCAL_CONFIG="${CLAUDE_PROJECT_DIR:-.}/.claude/worktree-task.local.md"
if [ ! -f "$LOCAL_CONFIG" ]; then
  exit 0
fi

# Parse protected-branches from YAML frontmatter
PROTECTED_BRANCHES=$(sed -n '/^---$/,/^---$/p' "$LOCAL_CONFIG" \
  | grep -A 100 'protected-branches:' \
  | grep '^\s*-\s*' \
  | sed 's/^\s*-\s*//' \
  | tr '\n' ' ' || true)

# Skip if protected-branches list is empty
if [ -z "$PROTECTED_BRANCHES" ]; then
  exit 0
fi

# Current branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

# Check if current branch is in protected list
for branch in $PROTECTED_BRANCHES; do
  if [ "$CURRENT_BRANCH" = "$branch" ]; then
    echo "Code modification is not allowed on branch '${CURRENT_BRANCH}'. Use /worktree-task:create <name> to create a worktree." >&2
    exit 2
  fi
done

exit 0
