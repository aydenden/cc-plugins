#!/usr/bin/env bash
# Verify that every path cited in a document actually exists.
# Catches the most expensive hallucination: grounding a claim in a file that is not there.
# Usage: check-citations.sh <file> [file...]
# Env:   WF_EVIDENCE_ROOT  optional prefix for relative evidence paths
# Exit:  0 all cited paths exist · 1 at least one missing · 2 bad usage
set -uo pipefail

[ -f .claude/wf-skip-checks ] && { echo "check-citations: skipped (.claude/wf-skip-checks)"; exit 0; }
[ $# -ge 1 ] || { echo "usage: check-citations.sh <file> [file...]" >&2; exit 2; }

root="${WF_EVIDENCE_ROOT:-.}"
missing=0

for doc in "$@"; do
  [ -f "$doc" ] || { echo "MISSING DOC $doc"; missing=$((missing+1)); continue; }
  # Backtick-quoted tokens that look like paths, with an optional :line suffix.
  grep -oE '`[^`]+`' "$doc" \
    | tr -d '`' \
    | sed -E 's/:[0-9]+(-[0-9]+)?$//' \
    | grep -E '(/|\.[A-Za-z0-9]{1,6}$)' \
    | grep -vE '^(https?|file)://' \
    | sort -u \
  | while IFS= read -r p; do
      [ -n "$p" ] || continue
      if [ -e "$p" ] || [ -e "$root/$p" ]; then :; else echo "MISSING $p  (cited in $doc)"; fi
    done
done > /tmp/wf-citations.$$ 2>/dev/null

cat /tmp/wf-citations.$$
n=$(grep -c '^MISSING' /tmp/wf-citations.$$ 2>/dev/null || echo 0)
rm -f /tmp/wf-citations.$$

if [ "$n" -gt 0 ] || [ "$missing" -gt 0 ]; then
  echo "check-citations: $((n + missing)) unverifiable citation(s). A path that does not exist is not evidence."
  exit 1
fi
echo "check-citations: all cited paths exist"
