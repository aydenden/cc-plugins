#!/usr/bin/env bash
# oc-delegate.sh — single-command controller for OpenCode delegation (v0.6.1+).
#
# Orchestrates the full pipeline inside one bash invocation so the calling
# Opus session only consumes tokens for ONE Bash call + exit-code branching,
# instead of N round-trips for each pipeline step.
#
# Pipeline (all internal — no intermediate stdout):
#   1. ensure session dir (project's .claude/oc-sessions/<uuid>/, /tmp fallback)
#   2. oc-daemon.sh ensure
#   3. oc-session.sh create
#   4. oc-sse-watch.sh (background) — permission auto-deny + completion signal
#   5. oc-prompt.sh   — POST /api/session/:id/prompt (HTTP API v2)
#   6. wait $WATCH_PID with timeout
#   7. git diff snapshot + grep -c counts
#   8. status classification (grep-only, never Reads session output files)
#   9. emit 7-line report
#
# Usage:
#   oc-delegate.sh --dir D [options] < prompt.md            # stdin
#   oc-delegate.sh --dir D [options] <<EOF ... EOF          # heredoc
#   oc-delegate.sh --dir D --prompt-file FILE [options]     # file
#
# Options:
#   --dir D              REQUIRED. OpenCode working directory (sent as
#                        x-opencode-directory header). Almost always $PWD.
#   --prompt-file FILE   Read spec from FILE. If omitted, reads stdin.
#   --session-dir DIR    Override SESSION_DIR (default auto).
#   --title TITLE        OC session title (default cc-delegate-<unix-ts>).
#   --timeout SEC        Wait timeout (default $CC_OC_WAIT_TIMEOUT or 900).
#
# Stdout (always 7 lines, even on failure):
#   status:   <done|error|aborted-perm|timeout>
#   session:  <SESSION_DIR>
#   oc_sid:   <OC_SID or "(none)">
#   files:    +<add> -<del> (<n> files)
#   diff:     <SESSION_DIR>/diff.patch
#   done:     <code> <reason>
#   notes:    <one-line>
#
# Exit codes (contract — keep in sync with skills/delegate-oc/SKILL.md):
#   0   done             — session completed normally
#   10  err-daemon       — oc-daemon.sh ensure failed
#   11  err-session      — oc-session.sh create failed
#   12  err-prompt       — oc-prompt.sh POST failed
#   13  err-session-evt  — daemon emitted session.error / status: error
#   20  aborted-perm     — watcher auto-denied a permission.asked
#   30  timeout          — exceeded total wait timeout (session aborted)
set -uo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Exit-code constants (also documented in the contract above).
readonly EC_DONE=0
readonly EC_ERR_DAEMON=10
readonly EC_ERR_SESSION=11
readonly EC_ERR_PROMPT=12
readonly EC_ERR_SESSION_EVT=13
readonly EC_ABORTED_PERM=20
readonly EC_TIMEOUT=30

# ── parse args ──────────────────────────────────────────────────────────────
OC_DIR=""
PROMPT_FILE=""
SESSION_DIR=""
TITLE="cc-delegate-$(date +%s)"
TIMEOUT="${CC_OC_WAIT_TIMEOUT:-900}"

while [ $# -gt 0 ]; do
  case "$1" in
    --dir)          OC_DIR="$2";        shift 2 ;;
    --prompt-file)  PROMPT_FILE="$2";   shift 2 ;;
    --session-dir)  SESSION_DIR="$2";   shift 2 ;;
    --title)        TITLE="$2";         shift 2 ;;
    --timeout)      TIMEOUT="$2";       shift 2 ;;
    -h|--help)
      sed -n '2,/^set -uo/p' "$0" | sed -n 's/^# \?//;s/^set -uo.*//p; T; p'
      exit 0
      ;;
    *) echo "ERROR: unknown flag $1" >&2; exit 1 ;;
  esac
done

[ -n "$OC_DIR" ] || { echo "ERROR: --dir required (x-opencode-directory header)" >&2; exit 1; }

# ── session dir bootstrap ───────────────────────────────────────────────────
if [ -z "$SESSION_DIR" ]; then
  PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
  SESSION_DIR="$PROJECT_ROOT/.claude/oc-sessions/$(uuidgen)"
  if ! mkdir -p "$SESSION_DIR" 2>/dev/null; then
    SESSION_DIR="/tmp/cc-oc-$(uuidgen)"
    mkdir -p "$SESSION_DIR"
  fi
else
  mkdir -p "$SESSION_DIR"
fi

LOG="$SESSION_DIR/controller.log"
: > "$LOG"
log() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*" >> "$LOG"; }

log "SESSION_DIR=$SESSION_DIR"
log "OC_DIR=$OC_DIR"
log "TIMEOUT=$TIMEOUT"

# ── consolidate prompt to file ──────────────────────────────────────────────
PROMPT="$SESSION_DIR/prompt.md"
if [ -n "$PROMPT_FILE" ]; then
  [ -f "$PROMPT_FILE" ] || { echo "ERROR: prompt file not found: $PROMPT_FILE" >&2; exit 1; }
  cp "$PROMPT_FILE" "$PROMPT"
else
  cat > "$PROMPT"   # stdin
fi
[ -s "$PROMPT" ] || { echo "ERROR: empty prompt (no stdin and no --prompt-file content)" >&2; exit 1; }

# ── report emitter (always 7 lines) ─────────────────────────────────────────
emit_report() {
  # $1=status $2=oc_sid $3=files_changed $4=add $5=del $6=done_code $7=done_reason $8=notes
  local status="$1" oc_sid="${2:-(none)}" \
        files_changed="${3:-0}" add="${4:-0}" del="${5:-0}" \
        done_code="${6:-}" done_reason="${7:-}" notes="${8:-}"
  cat <<RPT
status:   $status
session:  $SESSION_DIR
oc_sid:   $oc_sid
files:    +$add -$del ($files_changed files)
diff:     $SESSION_DIR/diff.patch
done:     $done_code $done_reason
notes:    $notes
RPT
}

# ── Step 2: daemon ensure ───────────────────────────────────────────────────
log "step 2: oc-daemon.sh ensure"
if ! "$PLUGIN_DIR/bin/oc-daemon.sh" ensure >>"$LOG" 2>&1; then
  emit_report "error" "" 0 0 0 "" "" "daemon ensure failed — see $LOG"
  exit $EC_ERR_DAEMON
fi

# ── Step 3: session create ──────────────────────────────────────────────────
log "step 3: oc-session.sh create"
OC_SID="$("$PLUGIN_DIR/bin/oc-session.sh" create --title "$TITLE" 2>>"$LOG")"
if [ -z "$OC_SID" ]; then
  emit_report "error" "" 0 0 0 "" "" "oc-session.sh create returned empty — see $LOG"
  exit $EC_ERR_SESSION
fi
echo "$OC_SID" > "$SESSION_DIR/oc_sid"
log "OC_SID=$OC_SID"

# ── Step 4: SSE watcher (background) — permission auto-deny + event log ─────
# Since /session/:id/message is synchronous (blocks until idle), the SSE
# watcher's primary role is permission auto-deny + recording session events.
# The POST itself signals completion via its HTTP response.
log "step 4: start oc-sse-watch.sh (permission interceptor)"
"$PLUGIN_DIR/bin/oc-sse-watch.sh" "$OC_SID" \
  --out "$SESSION_DIR/sse.ndjson" \
  --done-file "$SESSION_DIR/done" \
  > "$SESSION_DIR/watch.stdout" 2>> "$SESSION_DIR/watch.stderr" &
WATCH_PID=$!
sleep 0.3   # SSE handshake grace

# ── Step 5: synchronous prompt POST (blocks until OC completes the loop) ────
# spec 의 TASK_TYPE 을 opencode-go 모델로 직접 매핑한다 (agent 제거).
# model 을 직접 지정하므로 top-level 기본 model 폴백(무효 시 hang, 구 결함 B) 을 회피.
# 우선순위: spec 의 'MODEL:' > TASK_TYPE 매핑 > 기본. 'VARIANT:' 로 추론 강도 선택.
OC_MODEL=opencode-go/deepseek-v4-pro
case "$(grep -m1 '^TASK_TYPE:' "$PROMPT" | sed 's/^TASK_TYPE:[[:space:]]*//' | tr -d '[:space:]')" in
  implement) OC_MODEL=opencode-go/deepseek-v4-pro ;;
  refactor)  OC_MODEL=opencode-go/qwen3.6-plus ;;
  summarize) OC_MODEL=opencode-go/deepseek-v4-flash ;;
  doc)       OC_MODEL=opencode-go/qwen3.6-plus ;;
  research)  OC_MODEL=opencode-go/deepseek-v4-pro ;;
  compose)   OC_MODEL=opencode-go/qwen3.6-plus ;;
  analyze)   OC_MODEL=opencode-go/kimi-k2.6 ;;
esac
# 명시적 override (있으면 우선). 업그레이드 후보: opencode-go/glm-5.2 (품질),
# opencode-go/kimi-k2.7-code (코딩 특화).
SPEC_MODEL="$(grep -m1 '^MODEL:' "$PROMPT" | sed 's/^MODEL:[[:space:]]*//' | tr -d '[:space:]')"
[ -n "$SPEC_MODEL" ] && OC_MODEL="$SPEC_MODEL"
SPEC_VARIANT="$(grep -m1 '^VARIANT:' "$PROMPT" | sed 's/^VARIANT:[[:space:]]*//' | tr -d '[:space:]')"
log "step 5: oc-prompt.sh (sync POST, model=$OC_MODEL, timeout=${TIMEOUT}s)"
if [ -n "$SPEC_VARIANT" ]; then
  "$PLUGIN_DIR/bin/oc-prompt.sh" "$OC_SID" "$PROMPT" \
    --dir "$OC_DIR" --model "$OC_MODEL" --variant "$SPEC_VARIANT" \
    --out "$SESSION_DIR/response.json" --timeout "$TIMEOUT" >>"$LOG" 2>&1
else
  "$PLUGIN_DIR/bin/oc-prompt.sh" "$OC_SID" "$PROMPT" \
    --dir "$OC_DIR" --model "$OC_MODEL" \
    --out "$SESSION_DIR/response.json" --timeout "$TIMEOUT" >>"$LOG" 2>&1
fi
PROMPT_EXIT=$?
log "prompt exit=$PROMPT_EXIT"

# ── Step 6: stop watcher (session has settled — POST returned or errored) ───
kill -TERM "$WATCH_PID" 2>/dev/null || true
wait "$WATCH_PID" 2>/dev/null || true

# ── Step 7: read done signal (if watcher captured one before being killed) ──
DONE_CODE=""
DONE_REASON=""
if [ -f "$SESSION_DIR/done" ]; then
  DONE_CODE="$(sed -n '1p' "$SESSION_DIR/done")"
  DONE_REASON="$(sed -n '2p' "$SESSION_DIR/done")"
fi
log "done_code=$DONE_CODE done_reason=$DONE_REASON"

# ── Step 8: diff capture (counts only — never Read) ─────────────────────────
log "step 8: git diff capture"
( cd "$OC_DIR" && git diff > "$SESSION_DIR/diff.patch" ) 2>/dev/null || true
FILES_CHANGED=0; ADD=0; DEL=0
if [ -f "$SESSION_DIR/diff.patch" ]; then
  FILES_CHANGED=$(grep -c '^diff --git' "$SESSION_DIR/diff.patch") || FILES_CHANGED=0
  ADD=$(grep -c '^+[^+]'                "$SESSION_DIR/diff.patch") || ADD=0
  DEL=$(grep -c '^-[^-]'                "$SESSION_DIR/diff.patch") || DEL=0
fi

# ── Step 9: classify + emit ─────────────────────────────────────────────────
HAS_PERM=0; HAS_ERR=0
if [ -f "$SESSION_DIR/sse.ndjson" ]; then
  HAS_PERM=$(grep -c '"permission.asked"' "$SESSION_DIR/sse.ndjson") || HAS_PERM=0
  HAS_ERR=$(grep -c  '"session.error"'    "$SESSION_DIR/sse.ndjson") || HAS_ERR=0
fi

# curl exit code 28 = --max-time exceeded. Abort runaway session.
if [ "$PROMPT_EXIT" -eq 28 ]; then
  log "TIMEOUT (curl --max-time) — aborting OC session"
  "$PLUGIN_DIR/bin/oc-session.sh" abort "$OC_SID" >/dev/null 2>&1 || true
  emit_report "timeout" "$OC_SID" "$FILES_CHANGED" "$ADD" "$DEL" \
    "$DONE_CODE" "$DONE_REASON" "exceeded ${TIMEOUT}s (curl rc=28) — session aborted, partial diff retained"
  exit $EC_TIMEOUT
fi

# Any other non-zero curl exit = transport / HTTP error.
if [ "$PROMPT_EXIT" -ne 0 ]; then
  emit_report "error" "$OC_SID" "$FILES_CHANGED" "$ADD" "$DEL" \
    "$DONE_CODE" "$DONE_REASON" "oc-prompt.sh exit=$PROMPT_EXIT — see $LOG"
  exit $EC_ERR_PROMPT
fi

if [ "$HAS_ERR" -gt 0 ] || [ "$DONE_CODE" = "2" ]; then
  emit_report "error" "$OC_SID" "$FILES_CHANGED" "$ADD" "$DEL" \
    "$DONE_CODE" "$DONE_REASON" "session.error emitted — inspect sse.ndjson / response.json via oc-result-review"
  exit $EC_ERR_SESSION_EVT
fi

if [ "$HAS_PERM" -gt 0 ]; then
  emit_report "aborted-perm" "$OC_SID" "$FILES_CHANGED" "$ADD" "$DEL" \
    "$DONE_CODE" "$DONE_REASON" "watcher auto-denied a permission — spec may need policy adjustment"
  exit $EC_ABORTED_PERM
fi

emit_report "done" "$OC_SID" "$FILES_CHANGED" "$ADD" "$DEL" \
  "$DONE_CODE" "$DONE_REASON" ""
exit $EC_DONE
