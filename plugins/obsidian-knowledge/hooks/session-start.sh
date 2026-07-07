#!/usr/bin/env bash
# session-start.sh — verify LLM Wiki vault path and structure.
# Never blocks session start; emits one-line stderr notices only.
set -uo pipefail

WIKI="${WIKI_PATH:-${OBSIDIAN_VAULT_PATH:-}}"

if [ -z "$WIKI" ]; then
  echo "[obsidian-knowledge] Neither WIKI_PATH nor OBSIDIAN_VAULT_PATH is set — capture/recall/research/lint will fail. Set WIKI_PATH in your shell." >&2
  exit 0
fi

if [ ! -d "$WIKI" ]; then
  echo "[obsidian-knowledge] Wiki path $WIKI does not exist." >&2
  exit 0
fi

if [ ! -f "$WIKI/SCHEMA.md" ]; then
  echo "[obsidian-knowledge] $WIKI has no SCHEMA.md — vault is not initialized as an LLM Wiki. Schema rules (SSoT) cannot be applied." >&2
  exit 0
fi

# cc-opencode delegation is handled by research-agent via
# Skill(cc-opencode:delegate-oc) at call time. No daemon pre-check here.

exit 0
