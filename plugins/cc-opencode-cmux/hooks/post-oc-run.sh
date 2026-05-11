#!/usr/bin/env bash
# post-oc-run.sh — after any Bash tool execution, if the command was safe-oc.sh
# or worktree-dispatch.sh and the output reported a session id, capture git diff
# from the actual workdir (which may be a worktree) and emit a context notice.
# Hook receives PostToolUse event JSON on stdin.
set -uo pipefail

INPUT="$(cat)"

# Use jq if available (more robust); fall back to sed.
if command -v jq >/dev/null 2>&1; then
  COMMAND="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)"
  OUTPUT="$(printf '%s' "$INPUT" | jq -r '.tool_response.output // .tool_response.stdout // empty' 2>/dev/null)"
else
  COMMAND="$(printf '%s' "$INPUT" | sed -n 's/.*"command":"\([^"]*\)".*/\1/p' | head -1)"
  OUTPUT="$INPUT"
fi

case "$COMMAND" in
  *safe-oc.sh*|*worktree-dispatch.sh*)
    ;;
  *)
    exit 0
    ;;
esac

# Extract session id from the safe-oc.sh stdout line: "session=<id> task=... exit=... dir=..."
SESSION_ID="$(printf '%s' "$OUTPUT" | grep -oE 'session=[a-zA-Z0-9-]+' | head -1 | sed 's/^session=//')"
if [ -z "$SESSION_ID" ]; then
  exit 0
fi

SESSION_DIR="/tmp/cc-oc-$SESSION_ID"
[ -d "$SESSION_DIR" ] || exit 0

# Use the workdir recorded by safe-oc.sh if present (worktree-aware), else PWD.
WORKDIR="$(cat "$SESSION_DIR/workdir" 2>/dev/null || echo "$PWD")"

if command -v git >/dev/null 2>&1 && [ -d "$WORKDIR/.git" -o -f "$WORKDIR/.git" ]; then
  git -C "$WORKDIR" diff --stat > "$SESSION_DIR/diff.stat" 2>/dev/null || true
  git -C "$WORKDIR" diff > "$SESSION_DIR/diff.patch" 2>/dev/null || true
fi

cat >&2 <<EOF
[cc-opencode-cmux] OpenCode delegation finished.
  session: $SESSION_ID
  workdir: $WORKDIR
  dir:     $SESSION_DIR
  diff:    $SESSION_DIR/diff.patch
  status:  $(cat "$SESSION_DIR/status" 2>/dev/null || echo "unknown")
Review the diff before continuing.
EOF

exit 0
