#!/usr/bin/env bash
# cmux availability detection.
# exit 0 = cmux ready (pattern B' available)
# exit 1 = cmux not available (use pattern A fallback)

set -uo pipefail

SOCK="${CMUX_SOCKET_PATH:-${HOME}/Library/Application Support/cmux/cmux.sock}"

if [ ! -S "$SOCK" ]; then
  echo "cmux socket not found at $SOCK" >&2
  exit 1
fi

if ! command -v cmux >/dev/null 2>&1; then
  echo "cmux CLI not in PATH" >&2
  exit 1
fi

if ! cmux ping >/dev/null 2>&1; then
  echo "cmux ping failed (try: export CMUX_SOCKET_MODE=allowAll)" >&2
  exit 1
fi

exit 0
