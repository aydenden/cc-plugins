#!/usr/bin/env bash
# redirect-subagent.sh — PreToolUse hook: redirect heavy native subagents to OpenCode.
#
# Rationale: a native subagent (Agent/Task tool) runs its own reasoning loop on the
# Max plan and burns quota. For mechanical/high-volume work that OpenCode can do just
# as well, we deny the native spawn and feed Claude an instruction to use the
# cc-opencode:delegate-oc skill instead — moving that token cost off the Max plan.
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
#   CC_OC_REDIRECT_TYPES      comma/space list of subagent_type to redirect.
#                             UNSET (default) = redirect ALL subagent types (minus EXCLUDE).
#                             SET = strict allowlist: redirect only these types.
#   CC_OC_REDIRECT_EXCLUDE    comma/space list of subagent_type to NEVER redirect (runs native).
#                             Default: statusline-setup (edits CC's own config — cannot run in
#                             OpenCode). Set to "" to redirect literally everything. Add other
#                             CC-only agents here (e.g. beads:task-agent) if delegation breaks them.
#   CC_OC_REDIRECT_MAX_DENY   consecutive denials for the same (session,type,description)
#                             before giving up and allowing the native agent. Default 2.
#                             Prevents an infinite deny↔retry loop if Claude won't re-route.
#   CC_OC_REDIRECT_SKIP_MARKER  literal marker that, if present in the call's prompt or
#                             description, skips redirection (runs native). Default "[cc-only]".
#                             CC adds it when a subagent genuinely needs Opus-grade
#                             reasoning (precise analysis, architecture judgement) that
#                             OpenCode should not handle. Set to "" to disable the escape.
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

# --- opt-out marker: CC flags a call as "keep on Opus" (precise analysis/judgement) ---
# If the prompt or description carries the skip marker, run the native agent — this is
# the deliberate escape for the "some work needs CC, not OC" case.
skip_marker="${CC_OC_REDIRECT_SKIP_MARKER-[cc-only]}"
if [ -n "$skip_marker" ]; then
  haystack="$(jq -r '((.tool_input.prompt // "") + " " + (.tool_input.description // ""))' <<<"$input" 2>/dev/null)"
  case "$haystack" in
    *"$skip_marker"*) exit 0 ;;
  esac
fi

# --- exclude list: types that must run natively (delegation impossible/pointless) ---
# `-` (not `:-`) so EXCLUDE="" means "exclude nothing"; unset means the default.
exclude="${CC_OC_REDIRECT_EXCLUDE-statusline-setup}"
if [ -n "$exclude" ]; then
  IFS=', ' read -ra _ex <<<"$exclude"
  for t in "${_ex[@]}"; do
    [ "$t" = "$stype" ] && exit 0
  done
fi

# --- target selection ---
# TYPES unset → redirect ALL subagent types (minus the exclude list above).
# TYPES set   → strict allowlist: redirect only those types.
types="${CC_OC_REDIRECT_TYPES:-}"
if [ -n "$types" ]; then
  match=0
  IFS=', ' read -ra _arr <<<"$types"
  for t in "${_arr[@]}"; do
    [ "$t" = "$stype" ] && { match=1; break; }
  done
  [ "$match" = "1" ] || exit 0
fi

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
# 작업 원문(prompt/description)은 reason에 싣지 않는다: 방금 CC가 작성해 컨텍스트에
# 이미 있으므로 되돌려주면 그대로 delegate spec에 옮겨 적어 토큰만 이중 소모된다.
# CC 가 스스로 재라우팅할 수 있을 만큼의 행동 지침만 간결히 남긴다.
escape=""
[ -n "$skip_marker" ] && escape=" OpenCode로 낮출 수 없는 정밀 추론·아키텍처 판단이면 prompt에 '${skip_marker}'를 넣어 재시도하면 위임을 건너뛰고 네이티브로 실행됩니다."
reason="[cc-opencode] 서브에이전트 '${stype}'는 delegate-oc 위임으로 재라우팅됩니다. Agent/Task로 재시도하지 말고 Skill(cc-opencode:delegate-oc)로 방금 그 작업을 위임하세요(TASK_TYPE→모델 매핑·위임 적합성 게이트 처리).${escape}"

jq -n --arg r "$reason" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $r
  }
}'
exit 0
