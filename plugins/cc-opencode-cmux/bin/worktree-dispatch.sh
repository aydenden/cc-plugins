#!/usr/bin/env bash
# worktree-dispatch.sh — run safe-oc.sh inside an isolated git worktree
# Usage: worktree-dispatch.sh <task_type> <project_dir> <prompt_file>
set -euo pipefail

TASK_TYPE="${1:?task_type required}"
PROJECT_DIR="${2:?project_dir required}"
PROMPT_FILE="${3:?prompt_file required}"

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
TS="$(date +%Y%m%d-%H%M%S)"
# Append short uuid (or PID fallback) so parallel dispatches in the same
# second don't collide on worktree path / branch name.
UNIQ="$(uuidgen 2>/dev/null | tr 'A-Z' 'a-z' | cut -c1-8 || echo "$$")"
WT_PATH="${PROJECT_DIR}/../wt-oc-${TS}-${UNIQ}"
WT_BRANCH="oc/${TASK_TYPE}-${TS}-${UNIQ}"

cd "$PROJECT_DIR"
git worktree add -b "$WT_BRANCH" "$WT_PATH" HEAD
echo "worktree created: $WT_PATH (branch $WT_BRANCH)"

# Copy prompt to worktree-local path so opencode reads from correct context
PROMPT_BASENAME="$(basename "$PROMPT_FILE")"
cp "$PROMPT_FILE" "$WT_PATH/$PROMPT_BASENAME"

"$PLUGIN_ROOT/bin/oc-route.sh" "$TASK_TYPE" "$WT_PATH" "$WT_PATH/$PROMPT_BASENAME"

echo ""
echo "Worktree changes:"
git -C "$WT_PATH" status --short
echo ""
echo "To review:    git -C $WT_PATH diff"
echo "To merge:     git -C $PROJECT_DIR merge $WT_BRANCH"
echo "To discard:   git worktree remove --force $WT_PATH && git branch -D $WT_BRANCH"
