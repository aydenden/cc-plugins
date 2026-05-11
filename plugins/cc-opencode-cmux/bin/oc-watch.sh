#!/usr/bin/env bash
# oc-watch.sh — subscribe to opencode serve /event SSE stream, detect hangs, abort if needed
# Usage: oc-watch.sh <session_id> <task_type>
# Exits: 0=session.idle, 2=session.error, 3=hard hang (aborted), 4=step loop (aborted), 5=stream closed
#
# SSE event types we react to (from OpenCode anomalyco/opencode v1.14.x):
#   session.idle                        — session reached idle, normal completion
#   session.error                       — error reported by server
#   session.next.tool.called            — tool invocation, resets inactivity tick
#   session.next.tool.input.delta       — tool input streaming (PR #26678)
#   message.updated                     — assistant message chunk
#   session.prompt                      — new LLM step (used for step-loop detection per #17516, #26220)
set -uo pipefail

SESSION_ID="${1:?session_id required}"
TASK_TYPE="${2:-implement}"
META_FILE="/tmp/cc-oc-serve.env"

if [ ! -f "$META_FILE" ]; then
  echo "ERROR: opencode serve not running. Run /cc-opencode-cmux:serve-start first." >&2
  exit 1
fi

# shellcheck disable=SC1090
. "$META_FILE"

# Inactivity thresholds (seconds) per task type
case "$TASK_TYPE" in
  summarize)   SOFT=20; HARD=60  ;;
  single-file) SOFT=30; HARD=90  ;;
  refactor)    SOFT=30; HARD=90  ;;
  implement)   SOFT=45; HARD=120 ;;
  cjk-doc)     SOFT=30; HARD=90  ;;
  batch)       SOFT=60; HARD=180 ;;
  *)           SOFT=30; HARD=90  ;;
esac

SESSION_DIR="/tmp/cc-oc-$SESSION_ID"
mkdir -p "$SESSION_DIR"
EVENT_LOG="$SESSION_DIR/events.ndjson"
STATUS_FILE="$SESSION_DIR/status"
echo "running" > "$STATUS_FILE"

abort_session() {
  local reason="$1"
  curl -sf -m 5 -u "opencode:$OPENCODE_SERVER_PASSWORD" \
    -X POST "$CC_OC_ATTACH_URL/session/$SESSION_ID/abort" >/dev/null 2>&1 || true
  echo "aborted ($reason)" > "$STATUS_FILE"
  echo "ABORT $SESSION_ID reason=$reason" >&2
}

# Step-loop detection state
STEP_COUNT=0
STEP_WINDOW_START="$(date +%s)"
LAST_LOG_BYTES=0
LAST_TICK="$(date +%s)"
RESULT_EXIT=5

# Run curl in a coprocess via fd 3 so the read loop stays in the current shell
# (subshells lose `exit` semantics). `read -t 5` lets the inactivity watchdog
# fire even when no SSE event has arrived.
exec 3< <(curl -sN -u "opencode:$OPENCODE_SERVER_PASSWORD" "$CC_OC_ATTACH_URL/event" 2>/dev/null)

while :; do
  # 5-second poll lets us check inactivity even when no events arrive
  if IFS= read -r -t 5 -u 3 line; then
    NOW="$(date +%s)"
    case "$line" in
      "data: "*)
        PAYLOAD="${line#data: }"
        echo "$PAYLOAD" >> "$EVENT_LOG"
        EVENT_TYPE="$(printf '%s' "$PAYLOAD" | sed -n 's/.*"type":"\([^"]*\)".*/\1/p')"

        case "$EVENT_TYPE" in
          session.idle)
            EVENT_SESSION="$(printf '%s' "$PAYLOAD" | sed -n 's/.*"sessionID":"\([^"]*\)".*/\1/p')"
            if [ "$EVENT_SESSION" = "$SESSION_ID" ] || [ -z "$EVENT_SESSION" ]; then
              echo "done" > "$STATUS_FILE"
              RESULT_EXIT=0
              break
            fi
            ;;
          session.error)
            echo "error" > "$STATUS_FILE"
            echo "ERROR session=$SESSION_ID payload=$PAYLOAD" >&2
            RESULT_EXIT=2
            break
            ;;
          session.next.tool.called|message.updated|session.next.tool.input.delta)
            LAST_TICK="$NOW"
            ;;
          session.prompt)
            STEP_COUNT=$((STEP_COUNT + 1))
            WINDOW=$((NOW - STEP_WINDOW_START))
            if [ "$WINDOW" -le 60 ] && [ "$STEP_COUNT" -ge 5 ]; then
              CURRENT_BYTES="$(wc -c < "$EVENT_LOG" 2>/dev/null | tr -d ' ' || echo 0)"
              if [ "$((CURRENT_BYTES - LAST_LOG_BYTES))" -lt 1024 ]; then
                abort_session "step-loop"
                RESULT_EXIT=4
                break
              fi
              LAST_LOG_BYTES="$CURRENT_BYTES"
              STEP_COUNT=0
              STEP_WINDOW_START="$NOW"
            elif [ "$WINDOW" -gt 60 ]; then
              STEP_COUNT=1
              STEP_WINDOW_START="$NOW"
            fi
            LAST_TICK="$NOW"
            ;;
        esac
        ;;
    esac
  fi

  # Inactivity check (runs whether or not a line was read)
  NOW="$(date +%s)"
  IDLE=$((NOW - LAST_TICK))
  if [ "$IDLE" -ge "$HARD" ]; then
    abort_session "inactivity-${IDLE}s"
    RESULT_EXIT=3
    break
  elif [ "$IDLE" -ge "$SOFT" ]; then
    echo "warn-soft-${IDLE}s" > "$STATUS_FILE"
  fi
done

exec 3<&-
exit "$RESULT_EXIT"
