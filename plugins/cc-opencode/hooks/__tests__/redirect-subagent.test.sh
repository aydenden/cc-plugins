#!/usr/bin/env bash
# redirect-subagent.test.sh — behavior spec for the PreToolUse subagent-redirect hook.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../redirect-subagent.sh"
FAIL=0

# Isolate loop-escape state per run.
export TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

# run <env-assignments...> -- <json> : prints "exit:<code>\n<stdout>"
run() {
  local envs=() json
  while [ "$1" != "--" ]; do envs+=("$1"); shift; done
  shift; json="$1"
  local out; out="$(printf '%s' "$json" | env "${envs[@]}" bash "$HOOK")"
  printf 'exit:%s\n%s' "$?" "$out"
}

pass() { echo "ok: $1"; }
fail() { echo "FAIL: $1"; FAIL=1; }

J_TARGET='{"tool_name":"Agent","session_id":"s1","tool_input":{"subagent_type":"general-purpose","description":"scan repo","prompt":"do the scan"}}'
J_EXPLORE='{"tool_name":"Agent","session_id":"s1","tool_input":{"subagent_type":"Explore","description":"look","prompt":"look"}}'
J_TASKNAME='{"tool_name":"Task","session_id":"s1","tool_input":{"subagent_type":"Plan","description":"plan it","prompt":"plan it"}}'
J_NONAGENT='{"tool_name":"Bash","session_id":"s1","tool_input":{"command":"ls"}}'

# 1) opt-in gate: no CC_OC_REDIRECT_SUBAGENTS → allow (exit 0, no output)
r="$(run CC_OC_REDIRECT_SUBAGENTS= -- "$J_TARGET")"
[ "$r" = "exit:0" ] && pass "gate off → silent allow" || fail "gate off should allow with no output, got: $r"

# 2) gate on, non-target subagent → allow
r="$(run CC_OC_REDIRECT_SUBAGENTS=1 -- "$J_EXPLORE")"
[ "$r" = "exit:0" ] && pass "non-target (Explore) → allow" || fail "Explore should pass, got: $r"

# 3) gate on, non-Agent tool → allow
r="$(run CC_OC_REDIRECT_SUBAGENTS=1 -- "$J_NONAGENT")"
[ "$r" = "exit:0" ] && pass "non-Agent tool → allow" || fail "Bash should pass, got: $r"

# 4) gate on, target subagent → deny JSON on stdout, exit 0
r="$(run CC_OC_REDIRECT_SUBAGENTS=1 -- "$J_TARGET")"
echo "$r" | grep -q '^exit:0' \
  && echo "$r" | grep -q '"permissionDecision": "deny"' \
  && echo "$r" | grep -q 'delegate-oc' \
  && echo "$r" | grep -q 'do the scan' \
  && pass "target → deny + delegate-oc reason + prompt embedded" \
  || fail "target should deny with reason+prompt, got: $r"

# 5) tool_name "Task" also redirected (version robustness)
r="$(run CC_OC_REDIRECT_SUBAGENTS=1 -- "$J_TASKNAME")"
echo "$r" | grep -q '"permissionDecision": "deny"' && pass "Task tool name also redirected" || fail "Task should deny, got: $r"

# 6) CC_OC_REDIRECT_TYPES override: Explore becomes a target, general-purpose no longer
r="$(run CC_OC_REDIRECT_SUBAGENTS=1 CC_OC_REDIRECT_TYPES=Explore -- "$J_EXPLORE")"
echo "$r" | grep -q '"permissionDecision": "deny"' && pass "custom TYPES redirects Explore" || fail "custom TYPES should redirect Explore, got: $r"
r="$(run CC_OC_REDIRECT_SUBAGENTS=1 CC_OC_REDIRECT_TYPES=Explore -- "$J_TARGET")"
[ "$r" = "exit:0" ] && pass "custom TYPES excludes general-purpose" || fail "general-purpose should pass under custom TYPES, got: $r"

# 6b) default target set is CC-native only: general-purpose/Plan redirected, project-local agents pass
r="$(run CC_OC_REDIRECT_SUBAGENTS=1 -- "$J_TASKNAME")"   # Plan (native)
echo "$r" | grep -q 'deny' && pass "default: native Plan redirected" || fail "Plan should be default target, got: $r"
J_PROJ='{"tool_name":"Agent","session_id":"s1","tool_input":{"subagent_type":"review-agent","description":"x","prompt":"x"}}'
r="$(run CC_OC_REDIRECT_SUBAGENTS=1 -- "$J_PROJ")"
[ "$r" = "exit:0" ] && pass "default: project-local review-agent NOT redirected" || fail "review-agent must not be a default target, got: $r"

# 7) infinite-loop escape: same (session,type,description) allowed after MAX_DENY nudges
SID="escape-$$"
J_LOOP='{"tool_name":"Agent","session_id":"'"$SID"'","tool_input":{"subagent_type":"general-purpose","description":"stubborn","prompt":"stubborn"}}'
d1="$(run CC_OC_REDIRECT_SUBAGENTS=1 CC_OC_REDIRECT_MAX_DENY=2 -- "$J_LOOP")"
d2="$(run CC_OC_REDIRECT_SUBAGENTS=1 CC_OC_REDIRECT_MAX_DENY=2 -- "$J_LOOP")"
d3="$(run CC_OC_REDIRECT_SUBAGENTS=1 CC_OC_REDIRECT_MAX_DENY=2 -- "$J_LOOP")"
echo "$d1" | grep -q 'deny' && echo "$d2" | grep -q 'deny' && [ "$d3" = "exit:0" ] \
  && pass "loop escape: deny x2 then allow" \
  || fail "expected deny,deny,allow — got d1=$(echo "$d1"|head -1) d2=$(echo "$d2"|head -1) d3=$(echo "$d3"|head -1)"

[ "$FAIL" = "0" ] && echo "ALL PASS" || { echo "SOME FAILED"; exit 1; }
