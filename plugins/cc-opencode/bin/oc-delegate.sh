#!/usr/bin/env bash
# oc-delegate.sh — single-command controller for OpenCode delegation (v0.11.0+).
#
# Orchestrates delegation inside one bash invocation so the calling Opus session
# only consumes tokens for ONE Bash call + exit-code branching.
#
# As of v0.11.0 the transport is ACP (Agent Client Protocol) over stdio, not REST.
# The heavy lifting — spawn `opencode acp`, initialize, set model, prompt, stream
# progress, stall/timeout watchdog, permission policy — lives in the bundled
# Node client dist/acp-client.mjs. This script keeps only the shell-shaped work:
#
#   1. ensure session dir (project's .claude/oc-sessions/<uuid>/, /tmp fallback)
#   2. consolidate prompt to file
#   3. map TASK_TYPE (+ MODEL:/VARIANT: overrides) → opencode model id
#   4. run: node dist/acp-client.mjs …   (does the whole ACP turn; owns exit code)
#   5. git diff snapshot + grep -c counts  (never Reads session output files)
#   6. emit 7-line report, propagate the client's exit code
#
# Usage:
#   oc-delegate.sh --dir D [options] < prompt.md            # stdin
#   oc-delegate.sh --dir D [options] <<EOF ... EOF          # heredoc
#   oc-delegate.sh --dir D --prompt-file FILE [options]     # file
#
# Options:
#   --dir D              REQUIRED. OpenCode working directory (session cwd).
#   --prompt-file FILE   Read spec from FILE. If omitted, reads stdin.
#   --session-dir DIR    Override SESSION_DIR (default auto).
#   --title TITLE        Session title (default cc-delegate-<unix-ts>).
#   --timeout SEC        Overall wall-clock ceiling (default $CC_OC_WAIT_TIMEOUT or 300).
#   --stall SEC          Hang detection: no progress update for SEC → cancel
#                        (default $CC_OC_STALL_SECONDS or 60).
#
# Stdout (always 7 lines, even on failure):
#   status:   <done|error|aborted-perm|timeout|stalled>
#   session:  <SESSION_DIR>
#   oc_sid:   <OC_SID or "(none)">
#   files:    +<add> -<del> (<n> files)
#   diff:     <SESSION_DIR>/diff.patch
#   done:     <code> <reason>
#   notes:    <one-line>
#
# Exit codes (contract — keep in sync with skills/delegate-oc/SKILL.md and acp-client.ts):
#   0   done             — turn completed normally
#   11  err-session      — spawn / initialize / session/new failed
#   12  err-prompt       — prompt request rejected (transport / protocol error)
#   13  err-session-evt  — agent stopped with an error reason (refusal)
#   20  aborted-perm     — a permission was denied by policy (acp-client scoped/deny) → turn cancelled
#   30  timeout          — exceeded --timeout (turn aborted)
#   31  stalled          — stall watchdog fired: no update for --stall seconds (turn aborted)
set -uo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACP_CLIENT="$PLUGIN_DIR/dist/acp-client.mjs"

# Exit-code constants (also documented in the contract above).
readonly EC_DONE=0
readonly EC_ERR_SESSION=11
readonly EC_ERR_PROMPT=12
readonly EC_ERR_SESSION_EVT=13
readonly EC_ABORTED_PERM=20
readonly EC_TIMEOUT=30
readonly EC_STALLED=31

# ── parse args ──────────────────────────────────────────────────────────────
OC_DIR=""
PROMPT_FILE=""
SESSION_DIR=""
TITLE="cc-delegate-$(date +%s)"
TIMEOUT="${CC_OC_WAIT_TIMEOUT:-300}"
STALL="${CC_OC_STALL_SECONDS:-60}"

while [ $# -gt 0 ]; do
  case "$1" in
    --dir)          OC_DIR="$2";        shift 2 ;;
    --prompt-file)  PROMPT_FILE="$2";   shift 2 ;;
    --session-dir)  SESSION_DIR="$2";   shift 2 ;;
    --title)        TITLE="$2";         shift 2 ;;
    --timeout)      TIMEOUT="$2";       shift 2 ;;
    --stall)        STALL="$2";         shift 2 ;;
    -h|--help)
      sed -n '2,/^set -uo/p' "$0" | sed -n 's/^# \?//;s/^set -uo.*//p; T; p'
      exit 0
      ;;
    *) echo "ERROR: unknown flag $1" >&2; exit 1 ;;
  esac
done

[ -n "$OC_DIR" ] || { echo "ERROR: --dir required (session cwd)" >&2; exit 1; }

# ── report emitter (always 7 lines) ─────────────────────────────────────────
emit_report() {
  # $1=status $2=oc_sid $3=files_changed $4=add $5=del $6=done_code $7=done_reason $8=notes
  local status="$1" oc_sid="${2:-(none)}" \
        files_changed="${3:-0}" add="${4:-0}" del="${5:-0}" \
        done_code="${6:-}" done_reason="${7:-}" notes="${8:-}"
  cat <<RPT
status:   $status
session:  ${SESSION_DIR:-(unset)}
oc_sid:   $oc_sid
files:    +$add -$del ($files_changed files)
diff:     ${SESSION_DIR:-(unset)}/diff.patch
done:     $done_code $done_reason
notes:    $notes
RPT
}

# ── preflight: node + bundled client ────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  emit_report "error" "" 0 0 0 "" "" "node not found on PATH — required to run dist/acp-client.mjs"
  exit $EC_ERR_SESSION
fi
if [ ! -f "$ACP_CLIENT" ]; then
  emit_report "error" "" 0 0 0 "" "" "missing $ACP_CLIENT — run 'bun run build' in the plugin dir"
  exit $EC_ERR_SESSION
fi

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

LOG="$SESSION_DIR/controller.log"   # acp-client.mjs owns this file; we append after it runs.
log() { printf '%s [delegate] %s\n' "$(date +%H:%M:%S)" "$*" >> "$LOG"; }

# ── consolidate prompt to file ──────────────────────────────────────────────
PROMPT="$SESSION_DIR/prompt.md"
if [ -n "$PROMPT_FILE" ]; then
  [ -f "$PROMPT_FILE" ] || { echo "ERROR: prompt file not found: $PROMPT_FILE" >&2; exit 1; }
  cp "$PROMPT_FILE" "$PROMPT"
else
  cat > "$PROMPT"   # stdin
fi
[ -s "$PROMPT" ] || { echo "ERROR: empty prompt (no stdin and no --prompt-file content)" >&2; exit 1; }

# ── model selection ─────────────────────────────────────────────────────────
# Map the spec's TASK_TYPE to an opencode-go model. Direct model selection (no
# agent indirection) — priority: spec 'MODEL:' > TASK_TYPE mapping > default.
# 'VARIANT:' selects provider reasoning effort (low|medium|high|max).
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
# Explicit override (wins). Upgrade candidates: opencode-go/glm-5.2 (quality),
# opencode-go/kimi-k2.7-code (coding).
SPEC_MODEL="$(grep -m1 '^MODEL:' "$PROMPT" | sed 's/^MODEL:[[:space:]]*//' | tr -d '[:space:]')"
[ -n "$SPEC_MODEL" ] && OC_MODEL="$SPEC_MODEL"
SPEC_VARIANT="$(grep -m1 '^VARIANT:' "$PROMPT" | sed 's/^VARIANT:[[:space:]]*//' | tr -d '[:space:]')"

# ── per-delegation permission controls (spec fields override ambient env) ─────
# The calling session can set a standing default via ~/.claude/settings.json env
# (CC_OC_PERMISSION / CC_OC_ALLOW_WRITE), but that needs a CC restart. These spec
# fields let CC tune permission PER delegation, no restart — same pattern as MODEL:.
#   PERMISSION:  scoped(default) | allow-all | deny-all   (wins over ambient env)
#   ALLOW_WRITE: extra writable roots, colon-separated    (appended to allowlist)
# Plus OUTPUT_FILE's dir is auto-allowed: scoped policy denies writes outside
# --dir/SESSION_DIR, and research/compose specs write OUTPUT_FILE (e.g. /tmp/x.md)
# outside --dir → without this it would hit exit 20.
add_allow_write() {  # append $1 to CC_OC_ALLOW_WRITE (colon-separated)
  [ -n "$1" ] || return 0
  if [ -n "${CC_OC_ALLOW_WRITE:-}" ]; then
    export CC_OC_ALLOW_WRITE="${CC_OC_ALLOW_WRITE}:$1"
  else
    export CC_OC_ALLOW_WRITE="$1"
  fi
}

SPEC_PERM="$(grep -m1 '^PERMISSION:' "$PROMPT" | sed 's/^PERMISSION:[[:space:]]*//' | tr -d '[:space:]')"
[ -n "$SPEC_PERM" ] && export CC_OC_PERMISSION="$SPEC_PERM"

SPEC_ALLOW="$(grep -m1 '^ALLOW_WRITE:' "$PROMPT" | sed 's/^ALLOW_WRITE:[[:space:]]*//;s/[[:space:]]*$//')"
add_allow_write "$SPEC_ALLOW"

SPEC_OUTPUT="$(grep -m1 '^OUTPUT_FILE:' "$PROMPT" | sed 's/^OUTPUT_FILE:[[:space:]]*//' | tr -d '[:space:]')"
[ -n "$SPEC_OUTPUT" ] && add_allow_write "$(dirname "$SPEC_OUTPUT")"

log "SESSION_DIR=$SESSION_DIR OC_DIR=$OC_DIR model=$OC_MODEL variant=${SPEC_VARIANT:-} timeout=${TIMEOUT}s stall=${STALL}s perm=${CC_OC_PERMISSION:-scoped} allow_write=${CC_OC_ALLOW_WRITE:-}"

# ── run the ACP client (owns the whole turn + the exit code) ────────────────
VARIANT_ARGS=()
[ -n "$SPEC_VARIANT" ] && VARIANT_ARGS=(--variant "$SPEC_VARIANT")
node "$ACP_CLIENT" \
  --dir "$OC_DIR" \
  --model "$OC_MODEL" \
  ${VARIANT_ARGS[@]+"${VARIANT_ARGS[@]}"} \
  --prompt-file "$PROMPT" \
  --session-dir "$SESSION_DIR" \
  --timeout "$TIMEOUT" \
  --stall "$STALL" \
  > "$SESSION_DIR/acp-status.json" 2>>"$LOG"
CLIENT_EXIT=$?
log "acp-client exit=$CLIENT_EXIT"

# ── read oc_sid (written by the client) ─────────────────────────────────────
OC_SID="(none)"
[ -f "$SESSION_DIR/oc_sid" ] && OC_SID="$(cat "$SESSION_DIR/oc_sid")"

# ── git diff capture (counts only — never Read) ─────────────────────────────
( cd "$OC_DIR" && git diff > "$SESSION_DIR/diff.patch" ) 2>/dev/null || true
FILES_CHANGED=0; ADD=0; DEL=0
if [ -f "$SESSION_DIR/diff.patch" ]; then
  FILES_CHANGED=$(grep -c '^diff --git' "$SESSION_DIR/diff.patch") || FILES_CHANGED=0
  ADD=$(grep -c '^+[^+]'                "$SESSION_DIR/diff.patch") || ADD=0
  DEL=$(grep -c '^-[^-]'                "$SESSION_DIR/diff.patch") || DEL=0
fi

# ── classify + emit (client exit code IS the contract) ──────────────────────
case "$CLIENT_EXIT" in
  "$EC_DONE")
    emit_report "done" "$OC_SID" "$FILES_CHANGED" "$ADD" "$DEL" "0" "end_turn" ""
    ;;
  "$EC_ERR_SESSION")
    emit_report "error" "$OC_SID" "$FILES_CHANGED" "$ADD" "$DEL" "" "" \
      "spawn/initialize/session failed — see $LOG"
    ;;
  "$EC_ERR_PROMPT")
    emit_report "error" "$OC_SID" "$FILES_CHANGED" "$ADD" "$DEL" "" "" \
      "prompt rejected (transport/protocol) — see $LOG"
    ;;
  "$EC_ERR_SESSION_EVT")
    emit_report "error" "$OC_SID" "$FILES_CHANGED" "$ADD" "$DEL" "" "refusal" \
      "agent stopped with an error reason — inspect via oc-result-review"
    ;;
  "$EC_ABORTED_PERM")
    emit_report "aborted-perm" "$OC_SID" "$FILES_CHANGED" "$ADD" "$DEL" "" "" \
      "a permission was auto-denied — adjust spec or opencode permission config"
    ;;
  "$EC_TIMEOUT")
    emit_report "timeout" "$OC_SID" "$FILES_CHANGED" "$ADD" "$DEL" "" "" \
      "exceeded ${TIMEOUT}s — turn aborted, partial diff retained"
    ;;
  "$EC_STALLED")
    emit_report "stalled" "$OC_SID" "$FILES_CHANGED" "$ADD" "$DEL" "" "" \
      "no progress for ${STALL}s — hang detected, turn cancelled, partial diff retained"
    ;;
  *)
    emit_report "error" "$OC_SID" "$FILES_CHANGED" "$ADD" "$DEL" "" "" \
      "acp-client unexpected exit=$CLIENT_EXIT — see $LOG"
    CLIENT_EXIT=$EC_ERR_PROMPT
    ;;
esac

exit "$CLIENT_EXIT"
