#!/usr/bin/env bash
# SessionStart hook: codex-opencode-cmux plugin environment check
# Outputs JSON-compatible warnings if dependencies are missing.

set -uo pipefail

WARNINGS=()
INFO=()

check_codex() {
  if ! command -v codex >/dev/null 2>&1; then
    WARNINGS+=("codex CLI not found. Install: brew install openai/codex/codex")
  else
    INFO+=("codex: $(codex --version 2>/dev/null | head -1)")
  fi
}

check_opencode() {
  if ! command -v opencode >/dev/null 2>&1; then
    WARNINGS+=("opencode CLI not found. Install: brew install opencode-ai/tap/opencode")
    return
  fi
  INFO+=("opencode: $(opencode --version 2>/dev/null | head -1)")

  local AUTH_FILE="${HOME}/.local/share/opencode/auth.json"
  if [ ! -f "$AUTH_FILE" ]; then
    WARNINGS+=("opencode not authenticated. Run: opencode auth login")
  fi
}

check_cmux() {
  local SOCK="${CMUX_SOCKET_PATH:-${HOME}/Library/Application Support/cmux/cmux.sock}"
  if [ ! -S "$SOCK" ]; then
    INFO+=("cmux: not running (will use pattern A fallback)")
    return
  fi
  if ! command -v cmux >/dev/null 2>&1; then
    WARNINGS+=("cmux socket exists but CLI not in PATH. Symlink: sudo ln -sf /Applications/cmux.app/Contents/Resources/bin/cmux /usr/local/bin/cmux")
    return
  fi
  if ! cmux ping >/dev/null 2>&1; then
    WARNINGS+=("cmux ping failed. Try: export CMUX_SOCKET_MODE=allowAll")
    return
  fi
  INFO+=("cmux: socket ok")
}

check_jq() {
  if ! command -v jq >/dev/null 2>&1; then
    WARNINGS+=("jq not installed. Required for opencode JSON summary. Install: brew install jq")
  fi
}

check_codex
check_opencode
check_cmux
check_jq

# Output (stderr for Claude visibility)
if [ ${#WARNINGS[@]} -gt 0 ]; then
  echo "[codex-opencode-cmux] Setup warnings:" >&2
  for w in "${WARNINGS[@]}"; do
    echo "  - $w" >&2
  done
fi

if [ ${#INFO[@]} -gt 0 ] && [ "${CODEX_OC_CMUX_VERBOSE:-0}" = "1" ]; then
  echo "[codex-opencode-cmux] Status:" >&2
  for i in "${INFO[@]}"; do
    echo "  - $i" >&2
  done
fi

exit 0
