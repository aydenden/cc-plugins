#!/usr/bin/env bash
# Warn when a document claims something was not found without showing the search that was run.
# "I did not look" and "I looked and it is not there" are different facts; only one is evidence.
# Usage: check-negation.sh <file> [file...]
# Exit:  0 always (advisory) unless WF_NEGATION_STRICT=1
set -uo pipefail

[ -f .claude/wf-skip-checks ] && { echo "check-negation: skipped (.claude/wf-skip-checks)"; exit 0; }
[ $# -ge 1 ] || { echo "usage: check-negation.sh <file> [file...]" >&2; exit 2; }

# Claims of absence, Korean and English.
CLAIM='없음|없다|없습니다|찾지 못|미발견|not found|no such|none found|nothing found'
# Evidence that a search actually ran.
PROOF='rg |grep |bd search|bd list|git log|glob|find |npx skills find'

warn=0
for doc in "$@"; do
  [ -f "$doc" ] || continue
  while IFS=: read -r line _; do
    [ -n "$line" ] || continue
    start=$(( line > 6 ? line - 6 : 1 ))
    if ! sed -n "${start},$((line + 6))p" "$doc" | grep -qE "$PROOF"; then
      echo "UNPROVEN $doc:$line  claims absence with no search command nearby"
      warn=$((warn+1))
    fi
  done < <(grep -nE "$CLAIM" "$doc" | cut -d: -f1 | sed 's/$/:/')
done

if [ "$warn" -gt 0 ]; then
  echo "check-negation: $warn unproven absence claim(s). Record the command that was run."
  [ "${WF_NEGATION_STRICT:-0}" = "1" ] && exit 1
fi
echo "check-negation: done ($warn warning(s))"
exit 0
