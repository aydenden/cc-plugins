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
emit_note() {
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

POLICY="${CC_OC_PERMISSION:-scoped}"
MARKER="${CC_OC_REDIRECT_SKIP_MARKER-[cc-only]}"
REDIR="${CC_OC_REDIRECT_SUBAGENTS:-0}"
FANOUT="${CC_OC_FANOUT_CONCURRENCY:-4}"

# 1) status line — stderr, for the USER (env is injected via ~/.claude/settings.json
#    "env" or shell profile; this just echoes the active values for visibility).
emit_note "delegation policy: permission=${POLICY}${CC_OC_ALLOW_WRITE:+ allow_write=${CC_OC_ALLOW_WRITE}} subagent_redirect=${REDIR}${MARKER:+ skip_marker=${MARKER}} fanout_concurrency=${FANOUT}"

# 2) usage guidance — STDOUT, for CC. A SessionStart hook's stdout is injected into
#    the model's context (additionalContext). Only emit when the redirect hook is
#    ACTIVE, so CC proactively knows how to opt a specific spawn out of redirection
#    (otherwise it only learns the escape reactively, from the deny reason).
if [ "$REDIR" = "1" ]; then
  cat <<EOF
[cc-opencode] 이 세션은 서브에이전트 재라우팅이 켜져 있습니다(delegate-oc 위임 활성).
- 네이티브 서브에이전트(Agent/Task) 스폰은 PreToolUse hook이 가로채 OpenCode 위임으로 되돌립니다.
- 특정 호출을 CC 네이티브로 실행해야 하면(정밀 추론·아키텍처 판단 등 OpenCode로 낮출 수 없는 작업), 그 Agent/Task 호출의 prompt에 마커 '${MARKER}' 를 포함시키세요 → 재라우팅을 건너뛰고 네이티브로 실행됩니다. (네이티브 서브에이전트는 env를 못 붙이므로 prompt 마커가 유일한 우회 채널입니다.)
- OpenCode 위임 시 --dir 밖 경로 쓰기가 필요하면 spec에 'OUTPUT_FILE: <path>'(디렉토리 자동 허용) 또는 'ALLOW_WRITE: <dir>' / 'PERMISSION: allow-all' 을 넣으세요(기본 권한 정책=${POLICY}).
- 독립 작업 ≥2개 병렬 위임은 oc-fanout(동시 최대 ${FANOUT}개, CC_OC_FANOUT_CONCURRENCY).
EOF
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
