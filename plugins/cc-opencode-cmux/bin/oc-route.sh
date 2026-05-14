#!/usr/bin/env bash
# oc-route.sh — choose between cmux-dispatch (visualizable IPC) and safe-oc (SSE)
# Usage: oc-route.sh <task_type> <project_dir> <prompt_file> [model_override]
# Env:
#   CC_OC_FORCE_MODE=cmux|sse|auto   (default: auto)
#
# Auto mode behavior:
#   - If cmux is available: try cmux-dispatch.sh first.
#     If it exits 127 (cmux CLI not usable / fallback signal), fall back to safe-oc.sh.
#   - If cmux is missing: use safe-oc.sh directly.
set -uo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
MODE="${CC_OC_FORCE_MODE:-auto}"

run_cmux() { "$PLUGIN_ROOT/bin/cmux-dispatch.sh" "$@"; }
run_sse()  { "$PLUGIN_ROOT/bin/safe-oc.sh"       "$@"; }

case "$MODE" in
  cmux) exec "$PLUGIN_ROOT/bin/cmux-dispatch.sh" "$@" ;;
  sse)  exec "$PLUGIN_ROOT/bin/safe-oc.sh"       "$@" ;;
  auto)
    if command -v cmux >/dev/null 2>&1; then
      run_cmux "$@"
      RC=$?
      if [ "$RC" -eq 127 ]; then
        echo "[oc-route] cmux dispatch unavailable, falling back to SSE" >&2
        exec "$PLUGIN_ROOT/bin/safe-oc.sh" "$@"
      fi
      exit "$RC"
    else
      exec "$PLUGIN_ROOT/bin/safe-oc.sh" "$@"
    fi
    ;;
  *)
    echo "ERROR: invalid CC_OC_FORCE_MODE='$MODE' (use cmux|sse|auto)" >&2
    exit 1
    ;;
esac
