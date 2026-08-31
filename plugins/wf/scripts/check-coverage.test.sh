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

# Bypass and usage.
printf 'style\n' > axes.txt
printf '| style | 정의 |  |\n' > artifact.md
mkdir -p .claude && touch .claude/wf-skip-checks
out="$("$SCRIPT" axes.txt artifact.md 2>&1)"; code=$?
if [ "$code" = 0 ] && printf '%s' "$out" | grep -q "skipped"; then pass=$((pass+1)); else
  echo "FAIL bypass flag — exit $code"; echo "$out" | sed 's/^/      /'; fail=$((fail+1)); fi
rm -rf .claude

"$SCRIPT" axes.txt >/dev/null 2>&1; [ $? = 2 ] && pass=$((pass+1)) || { echo "FAIL bad usage exit 2"; fail=$((fail+1)); }
"$SCRIPT" nope.txt artifact.md >/dev/null 2>&1; [ $? = 2 ] && pass=$((pass+1)) || { echo "FAIL missing axes file exit 2"; fail=$((fail+1)); }
"$SCRIPT" axes.txt nope.md >/dev/null 2>&1; [ $? = 1 ] && pass=$((pass+1)) || { echo "FAIL missing artifact exit 1"; fail=$((fail+1)); }

echo "check-coverage.test: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
