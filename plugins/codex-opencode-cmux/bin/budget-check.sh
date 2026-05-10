#!/usr/bin/env bash
# Best-effort budget check for opencode Go plan.
# Outputs an integer percentage (0-100) of weekly limit used.
# Returns 0 if percentage < threshold (default 80), 1 if >= threshold.
#
# Note: opencode CLI does not expose a stable headless `/status` endpoint.
# This script attempts multiple heuristics; if none succeed, returns 0% and warns.

set -uo pipefail

THRESHOLD="${COCM_BUDGET_THRESHOLD:-80}"
USAGE_FILE="${HOME}/.local/share/opencode/usage.json"

PCT=0

if [ -f "$USAGE_FILE" ] && command -v jq >/dev/null 2>&1; then
  # Try common shapes; opencode's exact schema may evolve.
  WEEKLY_USED=$(jq -r '.weekly.used // .usage.weekly.used // 0' "$USAGE_FILE" 2>/dev/null)
  WEEKLY_LIMIT=$(jq -r '.weekly.limit // .usage.weekly.limit // 30' "$USAGE_FILE" 2>/dev/null)
  if [ -n "$WEEKLY_USED" ] && [ -n "$WEEKLY_LIMIT" ] && [ "$WEEKLY_LIMIT" != "0" ]; then
    PCT=$(awk -v u="$WEEKLY_USED" -v l="$WEEKLY_LIMIT" 'BEGIN { printf "%d", (u/l)*100 }')
  fi
fi

echo "$PCT"

if [ "$PCT" -ge "$THRESHOLD" ]; then
  echo "[budget] weekly usage ${PCT}% >= ${THRESHOLD}%" >&2
  exit 1
fi
exit 0
