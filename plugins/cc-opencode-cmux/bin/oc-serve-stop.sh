#!/usr/bin/env bash
# oc-serve-stop.sh — stop opencode serve daemon
set -euo pipefail

META_FILE="/tmp/cc-oc-serve.env"

if [ ! -f "$META_FILE" ]; then
  echo "no opencode serve daemon metadata at $META_FILE"
  exit 0
fi

# shellcheck disable=SC1090
. "$META_FILE"

if [ -n "${CC_OC_PID:-}" ] && kill -0 "$CC_OC_PID" 2>/dev/null; then
  kill -TERM "$CC_OC_PID" 2>/dev/null || true
  for i in 1 2 3 4 5; do
    if ! kill -0 "$CC_OC_PID" 2>/dev/null; then
      break
    fi
    sleep 0.5
  done
  if kill -0 "$CC_OC_PID" 2>/dev/null; then
    kill -KILL "$CC_OC_PID" 2>/dev/null || true
  fi
  echo "stopped opencode serve pid=$CC_OC_PID"
else
  echo "opencode serve pid=$CC_OC_PID not running"
fi

rm -f "$META_FILE"
