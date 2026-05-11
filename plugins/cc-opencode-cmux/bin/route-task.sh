#!/usr/bin/env bash
# route-task.sh — classify task spec into one of: implement|refactor|summarize|cjk-doc|single-file|batch
# Usage: route-task.sh "<spec>"
# Output: <task_type>\t<agent_name>\t<perm_file>
set -euo pipefail

SPEC="${1:-}"
if [ -z "$SPEC" ]; then
  echo "ERROR: spec required" >&2
  exit 1
fi

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
CONFIG_DIR="$PLUGIN_ROOT/config"

LOWER="$(echo "$SPEC" | tr '[:upper:]' '[:lower:]')"

# CJK-doc detection: Korean/Chinese characters in spec OR doc-related keywords
if echo "$SPEC" | LC_ALL=C grep -q '[^[:print:][:space:]]' \
   || echo "$LOWER" | grep -qE '(한글|한국어|문서|readme|docstring|주석|韩文|文档|注释)'; then
  echo -e "cjk-doc\toc-cjk-doc\t$CONFIG_DIR/perm-cjk-doc.json"
  exit 0
fi

# Summarize detection
if echo "$LOWER" | grep -qE '(summarize|summary|explain|describe|analyze|review|outline)'; then
  echo -e "summarize\toc-summarize\t$CONFIG_DIR/perm-summarize.json"
  exit 0
fi

# Refactor detection
if echo "$LOWER" | grep -qE '(refactor|rename|extract|inline|simplify|cleanup|reorganize)'; then
  echo -e "refactor\toc-refactor\t$CONFIG_DIR/perm-refactor.json"
  exit 0
fi

# Batch detection (multiple files mentioned)
# grep may return exit 1 on no match — guard against pipefail termination
set +o pipefail
FILE_COUNT="$(echo "$SPEC" | grep -oE '[a-zA-Z0-9_/-]+\.(rs|ts|tsx|js|jsx|py|go|java|md|json|toml|yaml)' 2>/dev/null | sort -u | wc -l | tr -d ' ')"
set -o pipefail
FILE_COUNT="${FILE_COUNT:-0}"
if [ "$FILE_COUNT" -ge 5 ]; then
  echo -e "batch\toc-implement\t$CONFIG_DIR/perm-implement.json"
  exit 0
fi

# Single-file detection
if [ "$FILE_COUNT" -eq 1 ] && ! echo "$LOWER" | grep -qE '(implement|create|build|add|new)'; then
  echo -e "single-file\toc-implement\t$CONFIG_DIR/perm-implement.json"
  exit 0
fi

# Default: implement
echo -e "implement\toc-implement\t$CONFIG_DIR/perm-implement.json"
