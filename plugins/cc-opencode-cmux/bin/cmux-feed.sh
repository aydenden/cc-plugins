#!/usr/bin/env bash
# cmux-feed.sh — sidebar status/progress/log helper. silent no-op when cmux missing.
#   status   --surface S <text>
#   progress --surface S <0..100>
#   log      --surface S <text>
#   clear-status   --surface S
#   clear-progress --surface S
set -euo pipefail

if ! command -v cmux >/dev/null 2>&1; then
  exit 0
fi

cmd="${1:-}"; shift || true
surface=""
while [ $# -gt 0 ]; do
  case "$1" in
    --surface) surface="$2"; shift 2 ;;
    *) break ;;
  esac
done
[ -n "$surface" ] || { echo "ERROR: --surface required" >&2; exit 1; }

case "$cmd" in
  status)
    text="${1:-}"
    [ -n "$text" ] && cmux set-status --surface "$surface" "$text" >/dev/null 2>&1 || true ;;
  progress)
    val="${1:-0}"
    cmux set-progress --surface "$surface" --value "$val" >/dev/null 2>&1 || true ;;
  log)
    text="${1:-}"
    [ -n "$text" ] && cmux log --surface "$surface" "$text" >/dev/null 2>&1 || true ;;
  clear-status)
    cmux clear-status --surface "$surface" >/dev/null 2>&1 || true ;;
  clear-progress)
    cmux clear-progress --surface "$surface" >/dev/null 2>&1 || true ;;
  *) echo "ERROR: unknown subcommand: $cmd" >&2; exit 1 ;;
esac
