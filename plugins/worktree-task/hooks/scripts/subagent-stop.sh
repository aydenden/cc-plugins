#!/bin/bash
# SubagentStop hook — notify main session about pending worktree cleanup
# Reads marker file written by WorktreeRemove hook and outputs review instructions
set -euo pipefail

# Find repo root from cwd
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$REPO_ROOT" ]; then
  exit 0
fi

MARKER_FILE="$REPO_ROOT/.claude/pending-worktree-cleanup.json"

if [ ! -f "$MARKER_FILE" ]; then
  exit 0
fi

# Read marker
WORKTREE_PATH=$(jq -r '.worktree_path' "$MARKER_FILE")
BRANCH=$(jq -r '.branch' "$MARKER_FILE")
BASE_BRANCH=$(jq -r '.base_branch' "$MARKER_FILE")
COMMIT_COUNT=$(jq -r '.commit_count' "$MARKER_FILE")
FIRST_COMMIT=$(jq -r '.first_commit' "$MARKER_FILE")
LAST_COMMIT=$(jq -r '.last_commit' "$MARKER_FILE")

# Output review instructions as systemMessage
cat <<EOF
Pending worktree cleanup:
  Path:    $WORKTREE_PATH
  Branch:  $BRANCH
  Base:    $BASE_BRANCH
  Commits: $COMMIT_COUNT ($FIRST_COMMIT..$LAST_COMMIT)

Review the agent's work, then clean up:
  1. git log ${BASE_BRANCH}..${BRANCH} --oneline
  2. git diff ${BASE_BRANCH}..${BRANCH}
  3. /worktree-task:remove ${WORKTREE_PATH}

CRITICAL: You MUST use /worktree-task:remove for cleanup.
Do NOT run "git worktree remove" directly via Bash — it WILL crash the session.
The remove skill protects Claude Code's working directory before deletion.
Do NOT skip the review. Inspect commits and diffs before deciding to merge or discard.
EOF
