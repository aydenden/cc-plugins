#!/usr/bin/env bash
# Verify that a definition artifact addresses every axis that is switched on.
# The other checks validate what was produced; this one catches what was never considered.
#
# Two things are enforced, and they fail differently:
#   UNADDRESSED  the axis has no row at all — nobody looked at it
#   INCOMPLETE   the row exists but carries no source, or claims "해당 없음" with no reason
# The second one is why a row is not enough on its own: a verdict with nothing behind it reads as
# considered and is not, and that is the shape the omission takes once the list is being run
# through as a formality.
#
# Usage: check-coverage.sh <axes-file> <artifact-file>
#   axes-file:     one axis id per line (comment lines with # ignored)
#   artifact-file: the definition document; each axis must appear as a table row or heading
# Exit: 0 every axis addressed · 1 at least one missing or incomplete · 2 bad usage
set -uo pipefail

[ -f .claude/wf-skip-checks ] && { echo "check-coverage: skipped (.claude/wf-skip-checks)"; exit 0; }
[ $# -eq 2 ] || { echo "usage: check-coverage.sh <axes-file> <artifact-file>" >&2; exit 2; }

axes_file="$1"; artifact="$2"
[ -f "$axes_file" ] || { echo "check-coverage: axes file not found: $axes_file" >&2; exit 2; }
[ -f "$artifact" ]  || { echo "check-coverage: artifact not found: $artifact" >&2; exit 1; }

# Whole-token match, so `state` does not pick up the `state-lifetime` row. An exact cell match
# wins over a substring one for the same reason.
read -r -d '' AWK <<'AWK_PROG'
function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
function strip(s) { gsub(/[*`_]/, "", s); return trim(s) }
BEGIN {
  low_axis = tolower(axis)
  tok = "(^|[^a-z0-9-])" low_axis "([^a-z0-9-]|$)"
  exact_row = ""; loose_row = ""; prose = 0
}
{
  line = $0; low = tolower(line)
  if (line ~ /^[ \t]*\|/) {
    n = split(line, c, "|")
    for (i = 1; i <= n; i++) {
      cell = strip(c[i]); lc = tolower(cell)
      if (cell == "") continue
      if (lc == low_axis) { if (exact_row == "") { exact_row = line; exact_idx = i } }
      else if (lc ~ tok) { if (loose_row == "") { loose_row = line; loose_idx = i } }
    }
  } else if (low ~ tok) prose = 1
}
END {
  row = exact_row; idx = exact_idx
  if (row == "") { row = loose_row; idx = loose_idx }
  if (row == "") { print (prose ? "NOTE" : "MISSING"); exit }

  n = split(row, c, "|")
  last = (row ~ /\|[ 	]*$/) ? n - 1 : n   # drop only the field after the closing pipe, so an
                                          # empty source cell stays visible instead of trimmed
  if (last <= idx) { print "INCOMPLETE 판정 칸이 없다 — 정의와 출처를 적는다"; exit }

  rest = ""
  for (i = idx + 1; i <= last; i++) {
    cell = strip(c[i])
    if (cell == "") { print "INCOMPLETE 빈 칸이 있다 — 출처 없는 판정은 미결이다"; exit }
    rest = rest " " cell
  }
  if (rest ~ /해당 ?없음/) {
    reason = rest
    gsub(/해당 ?없음/, "", reason)
    gsub(/[-—–:.,()\/ \t]/, "", reason)
    if (reason == "") { print "INCOMPLETE \"해당 없음\"에 사유가 없다 — 찾아본 결과를 적는다"; exit }
  }
  print "OK"
}
AWK_PROG

bad=0 total=0
while IFS= read -r axis; do
  axis="${axis%%#*}"
  axis="$(echo "$axis" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')"
  [ -n "$axis" ] || continue
  total=$((total + 1))
  verdict="$(awk -v axis="$axis" "$AWK" "$artifact")"
  case "$verdict" in
    OK) ;;
    NOTE) echo "NOTE $axis — 표 밖에 있어 셀 검사를 못 했다" ;;
    MISSING) echo "UNADDRESSED $axis"; bad=$((bad + 1)) ;;
    *) echo "INCOMPLETE $axis — ${verdict#INCOMPLETE }"; bad=$((bad + 1)) ;;
  esac
done < "$axes_file"

echo "check-coverage: $((total - bad))/$total axes addressed in $artifact"
if [ "$bad" -gt 0 ]; then
  echo "An axis with no row is an axis nobody looked at; a row with no source is a verdict nobody can check."
  echo "Add the row, or mark it 해당 없음 with what was searched and not found."
  exit 1
fi
