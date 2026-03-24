#!/bin/bash
# PreToolUse hook: Block direct "git worktree remove" via Bash tool
# Forces use of /worktree-task:remove which protects Claude Code's cwd
set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if echo "$COMMAND" | grep -qE 'git\s+worktree\s+remove'; then
  echo "BLOCKED: Do not run 'git worktree remove' directly — it will crash the session." >&2
  echo "Use /worktree-task:remove instead. It safely changes the working directory before deletion." >&2
  exit 2
fi

exit 0
