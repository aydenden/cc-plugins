#!/usr/bin/env bash
# safe-oc.sh — standard opencode delegation wrapper
# Usage: safe-oc.sh <task_type> <project_dir> <prompt_file> [model_override]
# - Reads serve daemon metadata from /tmp/cc-oc-serve.env (must be started first).
# - Injects OPENCODE_PERMISSION from config/perm-<task_type>.json.
# - Calls `opencode run --attach <url> --agent oc-<task_type> --format json < prompt.md`
# - Wall-clock timeout per task type as safety net.
# - Records workdir to $SESSION_DIR/workdir so post-oc-run hook can diff the right tree.
set -uo pipefail

TASK_TYPE="${1:?task_type required}"
PROJECT_DIR="${2:?project_dir required}"
PROMPT_FILE="${3:?prompt_file required}"
MODEL_OVERRIDE="${4:-}"

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
META_FILE="/tmp/cc-oc-serve.env"

if [ ! -f "$META_FILE" ]; then
  echo "ERROR: opencode serve not running. Run /cc-opencode-cmux:serve-start first." >&2
  exit 1
fi

# shellcheck disable=SC1090
. "$META_FILE"

PERM_FILE="$PLUGIN_ROOT/config/perm-${TASK_TYPE}.json"
if [ ! -f "$PERM_FILE" ]; then
  echo "ERROR: permission file not found: $PERM_FILE" >&2
  exit 1
fi

AGENT="oc-${TASK_TYPE}"

# Wall-clock safety net per task type (seconds)
case "$TASK_TYPE" in
  summarize)   WALL=300  ;;
  single-file) WALL=480  ;;
  refactor)    WALL=600  ;;
  implement)   WALL=1800 ;;
  cjk-doc)     WALL=600  ;;
  batch)       WALL=3600 ;;
  *)           WALL=600  ;;
esac

SESSION_ID="${CC_OC_SESSION_ID:-$(uuidgen 2>/dev/null || date +%s-$$)}"
SESSION_DIR="/tmp/cc-oc-$SESSION_ID"
mkdir -p "$SESSION_DIR"
echo "$PROJECT_DIR" > "$SESSION_DIR/workdir"

# Inject permissions and disable dangerous flags
OPENCODE_PERMISSION="$(cat "$PERM_FILE")"
export OPENCODE_PERMISSION
export OPENCODE_DISABLE_AUTOUPDATE=1

# Build argv as a positional array, then append extras. Avoids empty-array expansion
# bugs under macOS bash 3.2 + `set -u`.
set -- opencode run \
  --attach "$CC_OC_ATTACH_URL" \
  --dir "$PROJECT_DIR" \
  --agent "$AGENT" \
  --format json \
  --title "[cc-bridge] ${TASK_TYPE} $(date +%H%M%S)" \
  --username opencode \
  --password "$OPENCODE_SERVER_PASSWORD"

if [ -n "$MODEL_OVERRIDE" ]; then
  set -- "$@" --model "$MODEL_OVERRIDE"
fi

# Use GNU timeout if available, else fall back without one (oc-watch.sh handles hangs).
TIMEOUT_BIN=""
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_BIN="timeout"
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_BIN="gtimeout"
fi

EXIT=0
if [ -n "$TIMEOUT_BIN" ]; then
  "$TIMEOUT_BIN" --kill-after=30s "${WALL}s" "$@" \
    < "$PROMPT_FILE" \
    > "$SESSION_DIR/oc.ndjson" \
    2> "$SESSION_DIR/oc.stderr" || EXIT=$?
else
  "$@" \
    < "$PROMPT_FILE" \
    > "$SESSION_DIR/oc.ndjson" \
    2> "$SESSION_DIR/oc.stderr" || EXIT=$?
fi

echo "$EXIT" > "$SESSION_DIR/exit_code"
echo "session=$SESSION_ID task=$TASK_TYPE exit=$EXIT dir=$SESSION_DIR"
exit "$EXIT"
