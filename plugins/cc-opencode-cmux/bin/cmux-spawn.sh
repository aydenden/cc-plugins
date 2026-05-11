#!/usr/bin/env bash
# cmux-spawn.sh — spawn a parallel session pane for visualizing delegation
# Fallback chain: cmux → tmux → direct (no-op)
# Usage: cmux-spawn.sh <name> <command...>
set -euo pipefail

NAME="${1:?name required}"
shift
CMD=("$@")

if command -v cmux >/dev/null 2>&1; then
  cmux spawn --name "$NAME" -- "${CMD[@]}" &
  echo "spawned cmux pane: $NAME (pid=$!)"
  exit 0
fi

if command -v tmux >/dev/null 2>&1 && [ -n "${TMUX:-}" ]; then
  tmux new-window -n "$NAME" "${CMD[*]}"
  echo "spawned tmux window: $NAME"
  exit 0
fi

# No multiplexer available — run command directly in background
"${CMD[@]}" &
echo "no multiplexer found, ran in background: $NAME (pid=$!)"
