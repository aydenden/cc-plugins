#!/usr/bin/env bash
# Route a task description to an opencode-go model id by keyword matching.
# Usage: route-task.sh "<task description>"
# Output (stdout): opencode-go/<model-id>

set -uo pipefail

TASK="${1:-}"
if [ -z "$TASK" ]; then
  echo "Usage: route-task.sh \"<task description>\"" >&2
  exit 1
fi

# Normalize for matching
TASK_LOWER=$(printf '%s' "$TASK" | tr '[:upper:]' '[:lower:]')

DEFAULT_MODEL="${COCM_DEFAULT_MODEL:-opencode-go/deepseek-v4-pro}"

# Allow user override via settings file (~/.claude/codex-opencode-cmux.local.md frontmatter not parsed here;
# users export COCM_ROUTE_<KEY>=opencode-go/<id> for finer control)
ROUTE_BULK="${COCM_ROUTE_BULK:-opencode-go/deepseek-v4-flash}"
ROUTE_REFACTOR="${COCM_ROUTE_REFACTOR:-opencode-go/kimi-k2.6}"
ROUTE_BOILERPLATE="${COCM_ROUTE_BOILERPLATE:-opencode-go/minimax-m2.7}"
ROUTE_REVIEW="${COCM_ROUTE_REVIEW:-opencode-go/deepseek-v4-pro}"
ROUTE_IMPLEMENT="${COCM_ROUTE_IMPLEMENT:-opencode-go/deepseek-v4-pro}"

# Order matters: most specific first
if echo "$TASK_LOWER" | grep -qE 'bulk|대량|다수|migration|수십개|수백개|100\+'; then
  echo "$ROUTE_BULK"
elif echo "$TASK_LOWER" | grep -qE 'refactor|리팩터|재구성|restructure'; then
  echo "$ROUTE_REFACTOR"
elif echo "$TASK_LOWER" | grep -qE 'boilerplate|보일러|반복|crud|simple'; then
  echo "$ROUTE_BOILERPLATE"
elif echo "$TASK_LOWER" | grep -qE 'review|리뷰|검토|audit|점검'; then
  echo "$ROUTE_REVIEW"
elif echo "$TASK_LOWER" | grep -qE 'implement|구현|작성|build|develop'; then
  echo "$ROUTE_IMPLEMENT"
else
  echo "$DEFAULT_MODEL"
fi
