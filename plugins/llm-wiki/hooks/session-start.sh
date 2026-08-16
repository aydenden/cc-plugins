#!/usr/bin/env bash
# session-start.sh — verify the vault is reachable and initialized as an LLM Wiki.
# Never blocks session start; emits one-line stderr notices only.
#
# The plugin has no runtime dependencies: search is CC's built-in Grep and the
# maintenance scripts are dependency-free Node .mjs. Nothing to provision here.
set -uo pipefail

WIKI="${WIKI_PATH:-${OBSIDIAN_VAULT_PATH:-}}"

if [ -z "$WIKI" ]; then
  echo "[llm-wiki] Neither WIKI_PATH nor OBSIDIAN_VAULT_PATH is set — capture/recall/lint will fail. Set WIKI_PATH in your shell." >&2
  exit 0
fi

if [ ! -d "$WIKI" ]; then
  echo "[llm-wiki] Wiki path $WIKI does not exist." >&2
  exit 0
fi

if [ ! -f "$WIKI/SCHEMA.md" ]; then
  echo "[llm-wiki] $WIKI has no SCHEMA.md — vault is not initialized as an LLM Wiki. Schema rules (SSoT) cannot be applied." >&2
  exit 0
fi

exit 0
