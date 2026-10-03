#!/usr/bin/env bash
# Tests for check-coverage.sh. Run: scripts/check-coverage.test.sh
# Each case builds a throwaway artifact and asserts the exit code and the reported reason.
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/check-coverage.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP" || exit 1   # away from any .claude/wf-skip-checks in the repo

pass=0 fail=0

# run <name> <expected-exit> <expected-substring|-> <axes-content> <artifact-content>
run() {
  local name="$1" want_code="$2" want_out="$3" axes="$4" art="$5"
  printf '%s\n' "$axes" > axes.txt
  printf '%s\n' "$art"  > artifact.md
  local out code
  out="$("$SCRIPT" axes.txt artifact.md 2>&1)"; code=$?
  if [ "$code" != "$want_code" ]; then
    echo "FAIL $name — exit $code, want $want_code"; echo "$out" | sed 's/^/      /'; fail=$((fail+1)); return
  fi
  if [ "$want_out" != "-" ] && ! printf '%s' "$out" | grep -qF -- "$want_out"; then
    echo "FAIL $name — output lacks '$want_out'"; echo "$out" | sed 's/^/      /'; fail=$((fail+1)); return
  fi
  pass=$((pass+1))
}

FULL='| 축 | 정의 | 출처 |
|---|---|---|
| behavior | 목록을 조회해 표로 보인다 | 기획서 3.2절 |
| style | 기존 토큰 준용 | 목업 `mockup/detail.html` |'

run "full rows pass"            0 "2/2 axes addressed" 'behavior
style' "$FULL"

run "missing axis blocks"       1 "UNADDRESSED style" 'behavior
style' '| behavior | 목록 조회 | 기획서 3.2절 |'

run "empty source cell blocks"  1 "INCOMPLETE style"  'style' '| style | 기존 토큰 준용 |  |'

run "empty definition blocks"   1 "INCOMPLETE style"  'style' '| style |  | 목업 있음 |'

run "not-applicable with reason passes" 0 "1/1 axes addressed" 'i18n' \
  '| i18n | **해당 없음** — 단일 언어 프로젝트 |'

run "bare not-applicable blocks" 1 "INCOMPLETE i18n"  'i18n' '| i18n | 해당 없음 |'

run "not-applicable reason in next cell passes" 0 "1/1 axes addressed" 'i18n' \
  '| i18n | 해당 없음 | 단일 언어 프로젝트 |'

# `state` must not be satisfied by the `state-lifetime` row — the two are separate axes and a
# substring match would silently mark one addressed by the other.
run "prefix id does not borrow a longer row" 1 "UNADDRESSED state" 'state
state-lifetime' '| state-lifetime | 보드 전환에서 유지 | 목업 전환 시나리오 |'

run "both rows present pass" 0 "2/2 axes addressed" 'state
state-lifetime' '| state | 로딩 스켈레톤 | 기존 컴포넌트 |
| state-lifetime | 보드 전환에서 유지 | 목업 전환 시나리오 |'

run "heading form notes, does not block" 0 "NOTE style" 'style' \
  '## style

목업 토큰을 그대로 쓴다.'

# Bypass. The artifact below fails the check, so exit 0 can only mean the bypass took effect.
printf 'style\n' > axes.txt
printf '| style | 정의 |  |\n' > artifact.md
export WF_BYPASS_LOG="$TMP/bypass.log"

# bypass <name> <marker-content|-> <expected-exit> <expected-substring>
bypass() {
  local name="$1" marker="$2" want_code="$3" want_out="$4" out code
  mkdir -p .claude
  if [ "$marker" = "-" ]; then : > .claude/wf-skip-checks; else printf '%s\n' "$marker" > .claude/wf-skip-checks; fi
  out="$("$SCRIPT" axes.txt artifact.md 2>&1)"; code=$?
  rm -rf .claude
  if [ "$code" = "$want_code" ] && printf '%s' "$out" | grep -qF -- "$want_out"; then pass=$((pass+1)); else
    echo "FAIL $name — exit $code, want $want_code with '$want_out'"; echo "$out" | sed 's/^/      /'; fail=$((fail+1)); fi
}

# A refused bypass is asserted by the check's own verdict, not by the wording of the hint.
bypass "empty marker does not bypass"           "-"   1 "INCOMPLETE style"
bypass "whitespace-only marker does not bypass" "   " 1 "INCOMPLETE style"
if [ ! -e "$WF_BYPASS_LOG" ]; then pass=$((pass+1)); else
  echo "FAIL a refused bypass was recorded in the log"; fail=$((fail+1)); fi

bypass "marker with a reason bypasses and prints it" "style: 목업 미수령, ccp-test" 0 "bypass: style: 목업 미수령, ccp-test"

if grep -qF "check-coverage: style: 목업 미수령, ccp-test" "$WF_BYPASS_LOG" 2>/dev/null; then pass=$((pass+1)); else
  echo "FAIL bypass reason was not recorded in the log"; fail=$((fail+1)); fi

bypass "same reason on the same day" "style: 목업 미수령, ccp-test" 0 "skipped"
if [ "$(grep -cF "ccp-test" "$WF_BYPASS_LOG")" = 1 ]; then pass=$((pass+1)); else
  echo "FAIL repeated bypass was logged more than once"; fail=$((fail+1)); fi

WF_BYPASS_LOG="$TMP/no-such-dir/bypass.log" bypass "unrecordable bypass does not bypass" "style: x, ccp-test" 1 "INCOMPLETE style"

# The other two checks reach the same bypass.sh.
dir="$(dirname "$SCRIPT")"
for other in check-citations.sh check-negation.sh; do
  mkdir -p .claude && printf 'style: 목업 미수령, ccp-test\n' > .claude/wf-skip-checks
  out="$("$dir/$other" artifact.md 2>&1)"; code=$?
  rm -rf .claude
  if [ "$code" = 0 ] && printf '%s' "$out" | grep -qF "bypass: style"; then pass=$((pass+1)); else
    echo "FAIL $other does not honour the bypass — exit $code"; echo "$out" | sed 's/^/      /'; fail=$((fail+1)); fi
done

# bypass.sh is run, not sourced, so that losing it fails closed: with the file gone a marker
# grants nothing and the check still runs.
mkdir -p lone .claude && cp "$SCRIPT" lone/ && printf 'style: 목업 미수령, ccp-test\n' > .claude/wf-skip-checks
out="$(lone/check-coverage.sh axes.txt artifact.md 2>&1)"; code=$?
rm -rf .claude lone
if [ "$code" = 1 ] && printf '%s' "$out" | grep -qF "INCOMPLETE style"; then pass=$((pass+1)); else
  echo "FAIL check passed without bypass.sh — exit $code"; echo "$out" | sed 's/^/      /'; fail=$((fail+1)); fi

"$SCRIPT" axes.txt >/dev/null 2>&1; [ $? = 2 ] && pass=$((pass+1)) || { echo "FAIL bad usage exit 2"; fail=$((fail+1)); }
"$SCRIPT" nope.txt artifact.md >/dev/null 2>&1; [ $? = 2 ] && pass=$((pass+1)) || { echo "FAIL missing axes file exit 2"; fail=$((fail+1)); }
"$SCRIPT" axes.txt nope.md >/dev/null 2>&1; [ $? = 1 ] && pass=$((pass+1)) || { echo "FAIL missing artifact exit 1"; fail=$((fail+1)); }

echo "check-coverage.test: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
