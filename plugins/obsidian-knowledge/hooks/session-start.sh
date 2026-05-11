#!/usr/bin/env bash
# session-start.sh — verify Obsidian vault path + announce cc-opencode-cmux availability.
# Never blocks session start; emits one-line stderr notice.
set -uo pipefail

if [ -z "${OBSIDIAN_VAULT_PATH:-}" ]; then
  echo "[obsidian-knowledge] OBSIDIAN_VAULT_PATH not set — research/capture/lint will fail. Set it in your shell." >&2
  exit 0
fi

if [ ! -d "$OBSIDIAN_VAULT_PATH" ]; then
  echo "[obsidian-knowledge] OBSIDIAN_VAULT_PATH=$OBSIDIAN_VAULT_PATH does not exist." >&2
  exit 0
fi

# Detect cc-opencode-cmux availability (3-tier)
if [ -f /tmp/cc-oc-serve.env ] && \
   curl -sf -o /dev/null -m 2 "http://127.0.0.1:4096/global/health" 2>/dev/null; then
  echo "[obsidian-knowledge] cc-opencode-cmux daemon detected — research/capture will delegate to OpenCode (low-token mode)." >&2
elif command -v opencode >/dev/null 2>&1 && \
     opencode auth list 2>/dev/null | grep -qE '(opencode|opencode-go|openrouter|deepseek|anthropic|google|openai)'; then
  echo "[obsidian-knowledge] opencode CLI found but daemon not started. Run /cc-opencode-cmux:serve-start to enable OC delegation, or pass --cc-only to bypass." >&2
fi

exit 0
