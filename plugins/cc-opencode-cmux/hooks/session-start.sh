#!/usr/bin/env bash
# session-start.sh — verify prerequisites and optionally pre-warm opencode serve.
# Emits user-visible warnings via stderr; never blocks session start.
set -uo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

emit_warn() {
  echo "[cc-opencode-cmux] $1" >&2
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

if ! command -v curl >/dev/null 2>&1; then
  emit_warn "curl not found. SSE hang detection requires curl."
fi

if ! command -v cmux >/dev/null 2>&1 && ! command -v tmux >/dev/null 2>&1; then
  emit_warn "Neither cmux nor tmux found. Sessions will run without visual splits."
fi

# Register plugin's OC agent definitions into the user's OC config (idempotent, marker-gated).
# Without this, `opencode run --agent oc-research` falls back to default `build` agent and
# breaks ndjson streaming → REST polling overhead.
if [ "$AUTH_OK" = "1" ] && command -v jq >/dev/null 2>&1; then
  if [ -x "$PLUGIN_ROOT/bin/install-agents.sh" ]; then
    "$PLUGIN_ROOT/bin/install-agents.sh" >&2 || emit_warn "agent registration failed (non-fatal)"
  fi
elif [ "$AUTH_OK" = "1" ] && ! command -v jq >/dev/null 2>&1; then
  emit_warn "jq not installed — OC agent registration skipped. Install: brew install jq"
fi

# Auto-start serve daemon if CC_OC_AUTOSTART=1 (otherwise oc-implementer ensures on demand)
if [ "${CC_OC_AUTOSTART:-0}" = "1" ]; then
  if [ -x "$PLUGIN_ROOT/bin/oc-daemon.sh" ]; then
    "$PLUGIN_ROOT/bin/oc-daemon.sh" ensure >&2 || emit_warn "auto-start of opencode daemon failed"
  fi
fi

exit 0
