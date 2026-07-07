#!/usr/bin/env bash
# redirect-subagent.sh — PreToolUse hook: redirect heavy native subagents to OpenCode.
#
# Rationale: a native subagent (Agent/Task tool) runs its own reasoning loop on the
# Max plan and burns quota. For mechanical/high-volume work that OpenCode can do just
# as well, we deny the native spawn and feed Claude an instruction to use the
# cc-opencode-cmux:delegate-oc skill instead — moving that token cost off the Max plan.
#
# Mechanism: a PreToolUse hook cannot transparently substitute a tool's output, so we
# deny the call (exit 0 + JSON, the documented/preferred form over exit 2) and put a
# ready-to-run delegation instruction in permissionDecisionReason. Claude reads the
# reason and re-routes itself.
#
# Opt-in. Disabled unless CC_OC_REDIRECT_SUBAGENTS=1, so other users are unaffected.
#
# Env:
#   CC_OC_REDIRECT_SUBAGENTS  "1" enables; anything else = disabled (default).
#   CC_OC_REDIRECT_TYPES      comma/space list of subagent_type to redirect. Default:
#                             general-purpose,Plan  (CC-native heavy agents only — these exist
#                             for every user). Read-only Explore is intentionally excluded. Add
#                             project/plugin-specific agents (code-reviewer, review-agent, ...)
#                             per-environment via this var.
#   CC_OC_REDIRECT_MAX_DENY   consecutive denials for the same (session,type,description)
#                             before giving up and allowing the native agent. Default 2.
#                             Prevents an infinite deny↔retry loop if Claude won't re-route.
#
# stdin:  PreToolUse event JSON.
# stdout: deny JSON (exit 0) when redirecting; nothing (exit 0) when allowing.
# Fails open: any missing dependency or unparseable input allows the call through.
set -uo pipefail

# --- opt-in gate ---
[ "${CC_OC_REDIRECT_SUBAGENTS:-}" = "1" ] || exit 0

# No jq → never block the user; let the native flow proceed.
command -v jq >/dev/null 2>&1 || exit 0

input="$(cat)"

# --- only native subagent spawns (tool renamed Task→Agent across CC versions) ---
tool="$(jq -r '.tool_name // empty' <<<"$input" 2>/dev/null)"
case "$tool" in
  Task | Agent) ;;
  *) exit 0 ;;
esac

stype="$(jq -r '.tool_input.subagent_type // empty' <<<"$input" 2>/dev/null)"
[ -n "$stype" ] || exit 0

# --- is this subagent_type a redirect target? ---
types="${CC_OC_REDIRECT_TYPES:-general-purpose,Plan}"
match=0
IFS=', ' read -ra _arr <<<"$types"
for t in "${_arr[@]}"; do
  [ "$t" = "$stype" ] && { match=1; break; }
done
[ "$match" = "1" ] || exit 0

# --- infinite-loop escape: relent after MAX_DENY nudges for the same request ---
session="$(jq -r '.session_id // "nosess"' <<<"$input" 2>/dev/null)"
desc="$(jq -r '.tool_input.description // .tool_input.prompt // empty' <<<"$input" 2>/dev/null)"
max_deny="${CC_OC_REDIRECT_MAX_DENY:-2}"
key="$(printf '%s|%s' "$stype" "$desc" | cksum | cut -d' ' -f1)"
statedir="${TMPDIR:-/tmp}/cc-oc-redirect-${session}"
mkdir -p "$statedir" 2>/dev/null || true
cnt_file="$statedir/$key"
cnt=0
[ -f "$cnt_file" ] && cnt="$(cat "$cnt_file" 2>/dev/null || echo 0)"
if [ "${cnt:-0}" -ge "$max_deny" ] 2>/dev/null; then
  exit 0   # Claude insisted after $max_deny nudges — stop blocking.
fi
echo $((cnt + 1)) > "$cnt_file" 2>/dev/null || true

# --- deny + redirect instruction ---
prompt="$(jq -r '.tool_input.prompt // .tool_input.description // empty' <<<"$input" 2>/dev/null)"
reason="$(cat <<EOF
[cc-opencode-cmux] 네이티브 서브에이전트 '${stype}'는 위임 정책상 OpenCode(저비용)로 라우팅됩니다.

Agent/Task 툴로 '${stype}'를 재시도하지 마세요. 대신 Skill 툴로 cc-opencode-cmux:delegate-oc 를 호출해 아래 작업을 위임하세요. delegate-oc가 TASK_TYPE→모델 매핑과 위임 적합성(decide) 게이트를 처리합니다. 위임 부적합(아키텍처 판단·모호한 요구)으로 판단되면 그때 직접 수행하세요.

--- 위임할 작업 명세 ---
${prompt}
EOF
)"

jq -n --arg r "$reason" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $r
  }
}'
exit 0
