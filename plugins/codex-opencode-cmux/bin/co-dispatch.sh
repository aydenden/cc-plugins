#!/usr/bin/env bash
# co-dispatch.sh — main orchestrator for codex-opencode-cmux plugin.
#
# Pattern B' (cmux): codex plan → cmux split → opencode run → wait-for signal → review
# Pattern A (bash):  codex plan → opencode run subprocess → review
#
# Usage:
#   co-dispatch.sh --task "<text>" [--model opencode-go/<id>]
#                  [--mode cmux|bash|auto] [--timeout 600]
#                  [--max-iterations 3] [--escalated]

set -uo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

TASK=""
MODEL=""
MODE="auto"
TIMEOUT=600
MAX_ITER=3
ESCALATED=0

while [ $# -gt 0 ]; do
  case "$1" in
    --task)            TASK="$2"; shift 2;;
    --model)           MODEL="$2"; shift 2;;
    --mode)            MODE="$2"; shift 2;;
    --timeout)         TIMEOUT="$2"; shift 2;;
    --max-iterations)  MAX_ITER="$2"; shift 2;;
    --escalated)       ESCALATED=1; shift;;
    -h|--help)
      sed -n '2,12p' "$0"; exit 0;;
    *) echo "Unknown arg: $1" >&2; exit 2;;
  esac
done

if [ -z "$TASK" ]; then
  echo "Error: --task required" >&2
  exit 2
fi

# --- Step 1: Environment validation ---
command -v codex   >/dev/null 2>&1 || { echo "codex CLI not found" >&2; exit 3; }
command -v opencode >/dev/null 2>&1 || { echo "opencode CLI not found" >&2; exit 3; }
command -v jq      >/dev/null 2>&1 || { echo "jq required" >&2; exit 3; }

if [ ! -f "${HOME}/.local/share/opencode/auth.json" ]; then
  echo "opencode not authenticated. Run: opencode auth login" >&2
  exit 3
fi

# --- Step 2: Mode resolution ---
if [ "$MODE" = "auto" ]; then
  if bash "${PLUGIN_ROOT}/bin/cmux-detect.sh" >/dev/null 2>&1; then
    MODE="cmux"
  else
    MODE="bash"
  fi
fi
echo "[dispatch] mode=$MODE" >&2

# --- Step 3: Model routing ---
if [ -z "$MODEL" ]; then
  MODEL=$(bash "${PLUGIN_ROOT}/bin/route-task.sh" "$TASK")
fi
echo "[dispatch] model=$MODEL" >&2

# --- Step 4: Budget preflight (warn-only) ---
PCT=$(bash "${PLUGIN_ROOT}/bin/budget-check.sh" 2>/dev/null)
if [ -z "$PCT" ]; then
  echo "[dispatch] budget=unknown (usage.json unreadable; check ~/.local/share/opencode/usage.json)" >&2
  PCT=0
else
  echo "[dispatch] budget=${PCT}%" >&2
fi

# --- Step 5: Working files ---
ID="$$-$(date +%s)"
PLAN_FILE="/tmp/codex-plan-${ID}.md"
IMPL_FILE="/tmp/oc-impl-${ID}.json"
SUMMARY_FILE="/tmp/oc-summary-${ID}.txt"
SIGNAL="oc-done-${ID}"

trap 'rm -f "$PLAN_FILE" "$IMPL_FILE.tmp" 2>/dev/null' EXIT

# --- Step 6: codex plan ---
echo "[dispatch] codex planning..." >&2
codex exec --sandbox workspace-write \
  "Analyze the following task and write a concise implementation plan to ${PLAN_FILE}. Include: goal, file targets, step list, acceptance criteria. Task: ${TASK}" \
  >/dev/null 2>&1 || {
    echo "[dispatch] codex plan failed" >&2
    exit 4
  }

if [ ! -s "$PLAN_FILE" ]; then
  echo "[dispatch] plan file empty, falling back to inline prompt" >&2
  echo "$TASK" > "$PLAN_FILE"
fi

# --- Step 7: opencode crew execution ---
run_opencode_bash() {
  echo "[dispatch] opencode (bash mode) running..." >&2
  opencode run --model "$MODEL" --format json "$(cat "$PLAN_FILE")" > "$IMPL_FILE" 2>/dev/null
  return $?
}

run_opencode_cmux() {
  echo "[dispatch] opencode (cmux mode) running..." >&2
  local SPLIT_OUT SURFACE
  SPLIT_OUT=$(cmux new-split right 2>&1)
  SURFACE=$(echo "$SPLIT_OUT" | grep -oE 'surface:[0-9]+' | head -1)
  if [ -z "$SURFACE" ]; then
    echo "[dispatch] cmux new-split failed, falling back to bash mode" >&2
    run_opencode_bash
    return $?
  fi

  cmux set-status orchestrator "spawning opencode" --color "#4a1a6b" 2>/dev/null || true
  cmux set-progress 0.3 --label "opencode crew starting..." 2>/dev/null || true

  # Inject command (escape inner quotes)
  local CMD="opencode run --model ${MODEL} --format json \"\$(cat ${PLAN_FILE})\" > ${IMPL_FILE} && cmux wait-for --signal ${SIGNAL}"
  cmux send --surface "$SURFACE" "${CMD}\n" 2>/dev/null

  cmux set-status orchestrator "waiting opencode" --color "#ff9500" 2>/dev/null || true
  cmux set-progress 0.5 --label "opencode running..." 2>/dev/null || true

  if cmux wait-for "$SIGNAL" --timeout "$TIMEOUT" 2>/dev/null; then
    cmux set-progress 0.9 --label "summarizing..." 2>/dev/null || true
    return 0
  else
    echo "[dispatch] cmux wait-for timeout (${TIMEOUT}s)" >&2
    return 5
  fi
}

if [ "$MODE" = "cmux" ]; then
  run_opencode_cmux || OC_RC=$?
else
  run_opencode_bash || OC_RC=$?
fi

OC_RC="${OC_RC:-0}"

# --- Step 8: Escalation if needed ---
if [ "$OC_RC" != "0" ] && [ "$ESCALATED" = "0" ]; then
  if [ "$MODEL" = "opencode-go/deepseek-v4-flash" ]; then
    echo "[dispatch] V4 Flash failed, escalating to K2.6" >&2
    cmux set-status escalation "K2.6 fallback" --color "#ff9500" 2>/dev/null || true
    cmux log --level warn -- "escalating to kimi-k2.6" 2>/dev/null || true
    bash "$0" --task "$TASK" --model opencode-go/kimi-k2.6 --mode "$MODE" \
      --timeout "$TIMEOUT" --max-iterations "$MAX_ITER" --escalated
    exit $?
  fi
fi

if [ "$OC_RC" != "0" ]; then
  echo "[dispatch] opencode failed (rc=$OC_RC)" >&2
  cmux clear-progress 2>/dev/null || true
  cmux clear-status orchestrator 2>/dev/null || true
  exit 5
fi

# --- Step 9: Summary extraction ---
bash "${PLUGIN_ROOT}/bin/oc-summary.sh" "$IMPL_FILE" > "$SUMMARY_FILE"

# --- Step 10: Final cleanup + report ---
cmux set-progress 1.0 --label "done" 2>/dev/null || true
cmux log --level success -- "crew complete: $IMPL_FILE" 2>/dev/null || true
cmux clear-progress 2>/dev/null || true
cmux clear-status orchestrator 2>/dev/null || true
cmux notify --title "codex-opencode-cmux" --body "Crew dispatch complete" 2>/dev/null || true

cat <<EOF
✅ Dispatch complete
- Task: ${TASK}
- Model: ${MODEL}
- Pattern: ${MODE}
- Iterations: 1/${MAX_ITER}
- Plan: ${PLAN_FILE}
- Result: ${IMPL_FILE}
- Summary: ${SUMMARY_FILE}

--- Summary ---
$(cat "$SUMMARY_FILE")
EOF

exit 0
