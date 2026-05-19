#!/usr/bin/env bash
# subagent-stop.sh — fires after any subagent completes. If the subagent was
# cc-opencode-cmux:oc-implementer, emit a one-line stderr notice with the session
# path so the main session knows where to find diff.patch / events.ndjson /
# prompt.md for `Skill(cc-opencode-cmux:oc-result-review)` follow-up.
#
# SubagentStop payload format is not publicly documented as of 2026-05; we read
# best-effort from common fields and silently noop if we can't identify ours.
set -uo pipefail

INPUT="$(cat 2>/dev/null || true)"
[ -z "$INPUT" ] && exit 0

# best-effort subagent identifier (try multiple field names)
SUBAGENT=""
RESULT=""
if command -v jq >/dev/null 2>&1; then
  SUBAGENT="$(printf '%s' "$INPUT" | jq -r '
    .subagent_type // .agent_type // .agent.name // .tool_input.subagent_type // empty
  ' 2>/dev/null)"
  RESULT="$(printf '%s' "$INPUT" | jq -r '
    .result // .output // .tool_response.output // .tool_response.result // empty
  ' 2>/dev/null)"
fi

# only fire for our agent
case "$SUBAGENT" in
  *cc-opencode-cmux*|*oc-implementer*) ;;
  *) exit 0 ;;
esac

# try to extract session path from result text
SESSION_PATH="$(printf '%s' "$RESULT" | grep -oE '/tmp/cc-oc-[A-Za-z0-9-]+' | head -1)"
STATUS_LINE="$(printf '%s' "$RESULT" | grep -m1 -E '^status:[[:space:]]*' | head -c 80)"

NOTICE="[cc-opencode-cmux] OpenCode delegation finished."
[ -n "$STATUS_LINE" ]   && NOTICE="$NOTICE $STATUS_LINE"
[ -n "$SESSION_PATH" ]  && NOTICE="$NOTICE  session: $SESSION_PATH"
NOTICE="$NOTICE  Review with Skill(cc-opencode-cmux:oc-result-review)."

echo "$NOTICE" >&2
exit 0
