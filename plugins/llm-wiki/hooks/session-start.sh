#!/usr/bin/env bash
# session-start.sh — provision the llm-wiki search CLI and verify the vault.
# Never blocks session start; emits one-line stderr notices only.
#
# Claude Code has no post-install/post-clone hook, so first-run dependency
# setup ('bun install') is bootstrapped here, marker-guarded and backgrounded.
set -uo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

# --- Dependency auto-provision (marker-guarded, once, background) ---
MARKER="$PLUGIN_ROOT/.cache/deps-installed"
if [ ! -d "$PLUGIN_ROOT/node_modules/@orama" ] && [ ! -f "$MARKER" ]; then
  if command -v bun >/dev/null 2>&1; then
    echo "[llm-wiki] Search CLI deps missing — running 'bun install' in background (first run only). Search is unavailable until it finishes." >&2
    mkdir -p "$PLUGIN_ROOT/.cache"
    (
      cd "$PLUGIN_ROOT" || exit 0
      if bun install >/dev/null 2>&1; then
        touch "$MARKER"
        echo "[llm-wiki] Dependencies installed. First 'llm-wiki index' downloads models (~1GB); until then search runs BM25-only." >&2
      else
        echo "[llm-wiki] 'bun install' failed — run it manually in $PLUGIN_ROOT." >&2
      fi
    ) &
  else
    echo "[llm-wiki] Bun runtime not found — search CLI disabled. Install: curl -fsSL https://bun.sh/install | bash (or: npm i -g bun)." >&2
  fi
fi

# --- Vault verification ---
WIKI="${WIKI_PATH:-${OBSIDIAN_VAULT_PATH:-}}"

if [ -z "$WIKI" ]; then
  echo "[llm-wiki] Neither WIKI_PATH nor OBSIDIAN_VAULT_PATH is set — capture/recall/research/lint will fail. Set WIKI_PATH in your shell." >&2
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

# cc-opencode delegation is handled by research-agent via
# Skill(cc-opencode:delegate-oc) at call time. No daemon pre-check here.

exit 0
