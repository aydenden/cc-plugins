#!/usr/bin/env bash
# Verify that a definition artifact addresses every axis that is switched on.
# The other checks validate what was produced; this one catches what was never considered.
# Usage: check-coverage.sh <axes-file> <artifact-file>
#   axes-file:     one axis id per line (comment lines with # ignored)
#   artifact-file: the definition document; each axis must appear as a table row or heading
# Exit: 0 every axis addressed · 1 at least one missing · 2 bad usage
set -uo pipefail

[ -f .claude/wf-skip-checks ] && { echo "check-coverage: skipped (.claude/wf-skip-checks)"; exit 0; }
[ $# -eq 2 ] || { echo "usage: check-coverage.sh <axes-file> <artifact-file>" >&2; exit 2; }

axes_file="$1"; artifact="$2"
[ -f "$axes_file" ] || { echo "check-coverage: axes file not found: $axes_file" >&2; exit 2; }
[ -f "$artifact" ]  || { echo "check-coverage: artifact not found: $artifact" >&2; exit 1; }

missing=0 total=0
while IFS= read -r axis; do
  axis="${axis%%#*}"
  axis="$(echo "$axis" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')"
  [ -n "$axis" ] || continue
  total=$((total + 1))
  if grep -qiF -- "$axis" "$artifact"; then :; else
    echo "UNADDRESSED $axis"
    missing=$((missing + 1))
  fi
done < "$axes_file"

echo "check-coverage: $((total - missing))/$total axes addressed in $artifact"
if [ "$missing" -gt 0 ]; then
  echo "An axis with no row is an axis nobody looked at. Add the row, or mark it 해당 없음 with a reason."
  exit 1
fi
