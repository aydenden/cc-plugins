#!/usr/bin/env bash
# session-start.sh — verify ACP delegation prerequisites (v0.11.0+).
# Emits user-visible warnings via stderr; never blocks session start.
# Transport is ACP (opencode acp over stdio) run by the bundled Node client —
# there is no REST daemon to pre-warm; `opencode acp` is spawned per delegation.
set -uo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

emit_warn() {
  echo "[cc-opencode] $1" >&2
}

if ! command -v opencode >/dev/null 2>&1; then
  emit_warn "opencode CLI not found. Install: brew install opencode-ai/opencode/opencode"
fi

# Authentication: prefer `opencode auth login` (OC Zen/Go), fall back to BYOK env keys.
AUTH_OK=0
if command -v opencode >/dev/null 2>&1; then
  if opencode auth list 2>/dev/null | grep -qE '(opencode|opencode-go|anthropic|google|openai|openrouter|deepseek|moonshotai|qwen|zhipuai|minimax)'; then
    AUTH_OK=1
  fi
fi

if [ "$AUTH_OK" = "0" ]; then
  if [ -n "${OPENROUTER_API_KEY:-}${DEEPSEEK_API_KEY:-}${ANTHROPIC_API_KEY:-}${OPENAI_API_KEY:-}${GOOGLE_API_KEY:-}" ]; then
    AUTH_OK=1
  fi
fi

if [ "$AUTH_OK" = "0" ]; then
  emit_warn "No OpenCode authentication detected."
  emit_warn "  Run 'opencode auth login' for OC Zen / OC Go plan (recommended),"
  emit_warn "  or set a BYOK env key: OPENROUTER_API_KEY, DEEPSEEK_API_KEY, ANTHROPIC_API_KEY, ..."
fi

# ACP client runtime: node runs the bundled dist/acp-client.mjs (self-contained,
# no node_modules at runtime). Model selection is direct via session/set_model.
if ! command -v node >/dev/null 2>&1; then
  emit_warn "node not found. ACP delegation runs dist/acp-client.mjs with node."
fi
if [ ! -f "$PLUGIN_ROOT/dist/acp-client.mjs" ]; then
  emit_warn "missing dist/acp-client.mjs — run 'bun run build' in $PLUGIN_ROOT."
fi

# v0.6.0+: ensure project's .claude/.gitignore excludes oc-sessions/ so per-session
# artifacts (prompt.md / events.ndjson / diff.patch / sse.ndjson) don't pollute commits.
# Only touches existing .claude/ — does not create one for projects that don't use it.
PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
CLAUDE_DIR="$PROJECT_ROOT/.claude"
if [ -d "$CLAUDE_DIR" ]; then
  GI="$CLAUDE_DIR/.gitignore"
  if [ -f "$GI" ]; then
    grep -qxF 'oc-sessions/' "$GI" 2>/dev/null || echo 'oc-sessions/' >> "$GI"
  else
    echo 'oc-sessions/' > "$GI"
  fi
fi

exit 0
