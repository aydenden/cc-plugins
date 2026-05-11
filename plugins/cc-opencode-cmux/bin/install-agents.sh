#!/usr/bin/env bash
# install-agents.sh — merge plugin's agent definitions into the user's OpenCode config.
# - Uses jq for deep merge (agent key only, preserves user's provider / mcp / tools / other settings).
# - Marker file pattern: only re-runs when plugin version changes.
# - Idempotent; safe to call from session-start hook.
#
# Usage:
#   install-agents.sh           # respects marker, no-op if already installed for this version
#   install-agents.sh --force   # ignore marker, re-merge
set -uo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
TEMPLATE="$PLUGIN_ROOT/config/opencode.json.template"
MANIFEST="$PLUGIN_ROOT/.claude-plugin/plugin.json"

if [ ! -f "$TEMPLATE" ]; then
  echo "[install-agents] template not found at $TEMPLATE" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "[install-agents] jq required but not found. Install: brew install jq" >&2
  exit 1
fi

PLUGIN_VERSION="$(jq -r '.version' "$MANIFEST" 2>/dev/null || echo unknown)"

OC_CONFIG_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
OC_CONFIG_FILE="$OC_CONFIG_DIR/opencode.json"
MARKER="$OC_CONFIG_DIR/.cc-opencode-cmux-installed-$PLUGIN_VERSION"

# Honor --force
if [ "${1:-}" != "--force" ] && [ -f "$MARKER" ]; then
  exit 0
fi

mkdir -p "$OC_CONFIG_DIR"

# Initialize empty config if missing
if [ ! -f "$OC_CONFIG_FILE" ]; then
  echo '{}' > "$OC_CONFIG_FILE"
fi

# Validate user config is valid JSON; abort if not (don't damage user data)
if ! jq -e . "$OC_CONFIG_FILE" >/dev/null 2>&1; then
  echo "[install-agents] $OC_CONFIG_FILE is not valid JSON. Skipping merge." >&2
  exit 1
fi

# Backup before write (keep last 3)
BACKUP="$OC_CONFIG_FILE.bak.$(date +%Y%m%d-%H%M%S)"
cp "$OC_CONFIG_FILE" "$BACKUP"
ls -t "$OC_CONFIG_FILE".bak.* 2>/dev/null | tail -n +4 | xargs rm -f 2>/dev/null || true

# Deep merge: preserve user's agent definitions, overlay plugin's oc-* agents
TMP="$OC_CONFIG_FILE.tmp.$$"
jq -s '
  .[0] as $user
  | .[1] as $plugin
  | $user * { agent: ((($user.agent // {}) + ($plugin.agent // {}))) }
' "$OC_CONFIG_FILE" "$TEMPLATE" > "$TMP"

if [ ! -s "$TMP" ]; then
  echo "[install-agents] merge produced empty output. Aborting (backup at $BACKUP)." >&2
  rm -f "$TMP"
  exit 1
fi

mv "$TMP" "$OC_CONFIG_FILE"
touch "$MARKER"

AGENT_COUNT="$(jq -r '.agent | length' "$OC_CONFIG_FILE")"
PLUGIN_AGENTS="$(jq -r '.agent | keys | map(select(startswith("oc-"))) | join(", ")' "$OC_CONFIG_FILE")"
echo "[install-agents] merged ${PLUGIN_VERSION} into $OC_CONFIG_FILE (total agents: $AGENT_COUNT)" >&2
echo "[install-agents] plugin agents now available: $PLUGIN_AGENTS" >&2
echo "[install-agents] backup: $BACKUP" >&2
exit 0
