#!/usr/bin/env bash
# safe-oc.sh — standard opencode delegation wrapper
# Usage: safe-oc.sh <task_type> <project_dir> <prompt_file> [model_override]
# - Reads serve daemon metadata from /tmp/cc-oc-serve.env.
# - Auto-starts daemon if missing (opt out: CC_OC_NO_AUTOSTART=1).
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

# Daemon health check + auto-start (default on, opt out via CC_OC_NO_AUTOSTART=1)
# 0.2.4: source META_FILE so OPENCODE_SERVER_PASSWORD is available, then pass
# Basic Auth. Without auth, password-protected servers return 401 and -sf
# misreports the daemon as dead, triggering cold-start bypasses.
daemon_alive() {
  [ -f "$META_FILE" ] || return 1
  # shellcheck disable=SC1090
  . "$META_FILE"
  curl -sf -o /dev/null -m 2 \
    -u "opencode:${OPENCODE_SERVER_PASSWORD:-}" \
    "http://127.0.0.1:${CC_OC_PORT:-4096}/global/health" 2>/dev/null
}

if ! daemon_alive; then
  if [ "${CC_OC_NO_AUTOSTART:-0}" = "1" ]; then
    echo "ERROR: opencode serve not running and autostart disabled (CC_OC_NO_AUTOSTART=1). Run /cc-opencode-cmux:serve-start manually." >&2
    exit 1
  fi
  echo "[safe-oc] daemon not running, auto-starting..." >&2
  if ! "$PLUGIN_ROOT/bin/oc-serve-start.sh" >&2; then
    echo "ERROR: failed to start opencode serve daemon. See log for details." >&2
    exit 1
  fi
  if ! daemon_alive; then
    echo "ERROR: daemon started but health check failed." >&2
    exit 1
  fi
fi

# shellcheck disable=SC1090
. "$META_FILE"

PERM_FILE="$PLUGIN_ROOT/config/perm-${TASK_TYPE}.json"
if [ ! -f "$PERM_FILE" ]; then
  echo "ERROR: permission file not found: $PERM_FILE" >&2
  exit 1
fi

AGENT="oc-${TASK_TYPE}"

# Ensure the agent is registered in the user's OC config. Without this OC silently
# falls back to default `build` agent and breaks ndjson streaming.
OC_CONFIG_FILE="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}/opencode.json"
if [ -f "$OC_CONFIG_FILE" ] && command -v jq >/dev/null 2>&1; then
  if ! jq -e --arg a "$AGENT" '.agent[$a] // empty' "$OC_CONFIG_FILE" >/dev/null 2>&1; then
    echo "[safe-oc] agent '$AGENT' not registered in $OC_CONFIG_FILE — running install-agents.sh" >&2
    "$PLUGIN_ROOT/bin/install-agents.sh" --force >&2 || \
      echo "[safe-oc] WARNING: agent registration failed. OC may fall back to default agent." >&2
  fi
fi

# Wall-clock safety net per task type (seconds)
case "$TASK_TYPE" in
  summarize)   WALL=300  ;;
  single-file) WALL=480  ;;
  refactor)    WALL=600  ;;
  implement)   WALL=1800 ;;
  cjk-doc)     WALL=600  ;;
  research)    WALL=1200 ;;
  compose)     WALL=900  ;;
  analyze)     WALL=900  ;;
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
