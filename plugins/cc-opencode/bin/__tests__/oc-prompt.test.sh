#!/usr/bin/env bash
# oc-prompt.test.sh — body-composition spec for model-direct delegation (no agent).
# Uses --print-body (dry-run): compose the POST body and print it, no daemon/curl.
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PROMPT="$HERE/oc-prompt.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
PF="$TMP/prompt.md"; printf 'hello world' > "$PF"
FAIL=0
pass() { echo "ok: $1"; }
fail() { echo "FAIL: $1"; FAIL=1; }
body() { bash "$PROMPT" ses_x "$PF" --print-body "$@" 2>&1; }

# 1) --model → split into model.{providerID,modelID}, agent absent
b="$(body --model opencode-go/deepseek-v4-pro)"
echo "$b" | jq -e '.model.providerID=="opencode-go" and .model.modelID=="deepseek-v4-pro"' >/dev/null 2>&1 \
  && echo "$b" | jq -e 'has("agent")|not' >/dev/null 2>&1 \
  && pass "--model → model split, no agent" || fail "--model body wrong: $b"

# 2) modelID with no extra slash but provider having hyphens is fine; variant added
b="$(body --model opencode-go/glm-5.2 --variant high)"
echo "$b" | jq -e '.model.modelID=="glm-5.2" and .variant=="high"' >/dev/null 2>&1 \
  && pass "--variant → variant field" || fail "--variant body wrong: $b"

# 3) --agent (no model) → agent field, no model  (backward compat retained during transition)
b="$(body --agent oc-implement)"
echo "$b" | jq -e '.agent=="oc-implement" and (has("model")|not)' >/dev/null 2>&1 \
  && pass "--agent → agent field, no model" || fail "--agent body wrong: $b"

# 4) neither model nor agent → default MODEL (not agent) — agents are being removed
b="$(body)"
echo "$b" | jq -e '.model.modelID=="deepseek-v4-pro" and (has("agent")|not)' >/dev/null 2>&1 \
  && pass "default → model deepseek-v4-pro, no agent" || fail "default body wrong: $b"

# 5) CC_OC_DEFAULT_MODEL overrides the default
b="$(CC_OC_DEFAULT_MODEL=opencode-go/kimi-k2.6 body)"
echo "$b" | jq -e '.model.modelID=="kimi-k2.6"' >/dev/null 2>&1 \
  && pass "CC_OC_DEFAULT_MODEL override" || fail "default override wrong: $b"

# 6) prompt text preserved verbatim in parts
b="$(body --model opencode-go/deepseek-v4-flash)"
echo "$b" | jq -e '.parts[0].type=="text" and .parts[0].text=="hello world"' >/dev/null 2>&1 \
  && pass "prompt text preserved" || fail "parts wrong: $b"

# 7) default tools restriction: headless-unsafe tools disabled (subagent spawn + interactive question)
b="$(body --model opencode-go/deepseek-v4-flash)"
echo "$b" | jq -e '.tools.task==false and .tools.task_status==false and .tools.cancel_task==false and .tools.question==false' >/dev/null 2>&1 \
  && pass "default disables task/task_status/cancel_task/question" || fail "default tools restriction wrong: $b"

# 8) CC_OC_DISABLE_TOOLS overrides the disabled set
b="$(CC_OC_DISABLE_TOOLS='bash edit' body --model opencode-go/deepseek-v4-flash)"
echo "$b" | jq -e '.tools.bash==false and .tools.edit==false and (.tools|has("task")|not)' >/dev/null 2>&1 \
  && pass "CC_OC_DISABLE_TOOLS override" || fail "disable-tools override wrong: $b"

# 9) empty CC_OC_DISABLE_TOOLS → no tools field (escape hatch)
b="$(CC_OC_DISABLE_TOOLS='' body --model opencode-go/deepseek-v4-flash)"
echo "$b" | jq -e 'has("tools")|not' >/dev/null 2>&1 \
  && pass "empty CC_OC_DISABLE_TOOLS → no tools field" || fail "empty disable should omit tools: $b"

[ "$FAIL" = "0" ] && echo "ALL PASS" || { echo "SOME FAILED"; exit 1; }
