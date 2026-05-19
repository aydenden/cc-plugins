#!/usr/bin/env bash
# oc-stream-format.sh — thin wrapper around oc-stream-format.py.
# Existed historically as a bash script; kept for API compatibility with
# cmux-spawn-oc.sh which invokes this path.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 -u "$SCRIPT_DIR/oc-stream-format.py" "$@"
