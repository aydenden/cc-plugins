#!/usr/bin/env bash
# Decide whether a wf check may be bypassed, and record the bypass when it is.
# A bypass has to say why, and this script records it itself: the one place a check goes dark is
# the one place that must leave a trace. A marker with no reason in it grants nothing.
#
# Callers run this as a command and never source it, so that a missing or broken bypass.sh can
# only fail to grant a bypass: the check then runs.
#
# Usage: bypass.sh <check-name>
# Env:   WF_BYPASS_LOG  log path (default: <git common dir>/wf-bypass.log, shared by every
#                       worktree and never committed; .claude/wf-bypass.log outside a repository)
# Exit:  0 bypass granted and recorded · 1 no bypass, run the check · 2 bad usage
set -uo pipefail

[ $# -eq 1 ] || { echo "usage: bypass.sh <check-name>" >&2; exit 2; }
CHECK="$1"
MARKER=.claude/wf-skip-checks

[ -f "$MARKER" ] || exit 1
if ! grep -q '[^[:space:]]' "$MARKER"; then
  echo "$CHECK: $MARKER has no reason in it, so the check runs. Write one line: <target>: <why>, <ticket>" >&2
  exit 1
fi

LOG="${WF_BYPASS_LOG:-$(git rev-parse --git-common-dir 2>/dev/null || echo .claude)/wf-bypass.log}"
while IFS= read -r why || [ -n "$why" ]; do
  case "$why" in *[![:space:]]*) ;; *) continue ;; esac
  entry="$(date +%F) $CHECK: $why"
  # One line per day per reason: a hook fires on every edit, a bypass is one decision.
  grep -qxF -- "$entry" "$LOG" 2>/dev/null && continue
  echo "$entry" >> "$LOG" || { echo "$CHECK: could not record the bypass in $LOG, so the check runs." >&2; exit 1; }
done < "$MARKER"

echo "$CHECK: skipped ($MARKER)"
sed 's/^/  bypass: /' "$MARKER"
exit 0
