#!/usr/bin/env bash
# session-start.sh — verify the vault is reachable and initialized as an LLM Wiki,
# then bring it up to date with the remote before anything reads or writes it.
# Never blocks session start; emits one-line stderr notices only.
#
# The plugin has no runtime dependencies: search is CC's built-in Grep and the
# maintenance scripts are dependency-free Node .mjs. Nothing to provision here.
set -uo pipefail

# Resolve siblings from this script, not $CLAUDE_PLUGIN_ROOT: `set -u` would abort
# the hook if the variable were ever unset.
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

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

# The vault is shared across machines through git, so reading or writing before
# pulling means working from a stale copy and merging by hand later (ccp-o7m).
# vault-git decides what is safe: it fast-forwards a clean branch and only warns
# when the tree is dirty or the branches diverged.
if command -v node >/dev/null 2>&1; then
  SYNC="$(node "$PLUGIN_ROOT/scripts/vault-git.mjs" sync --vault "$WIKI" 2>&1)"
  case "$SYNC" in
    "GIT up-to-date"*|"GIT not-a-repo"*|"GIT no-upstream"*) : ;;
    *) echo "[llm-wiki] $SYNC" >&2 ;;
  esac
else
  echo "[llm-wiki] node not found — vault git sync skipped; pull the vault manually before writing." >&2
fi

exit 0
