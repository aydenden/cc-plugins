#!/usr/bin/env bash
# update-index.sh 테스트 — 직접 인자 모드(<note> <root>) + hook stdin JSON 모드.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../hooks/update-index.sh"
FIX="$HERE/fixtures"
FAILS=0

assert() {
  if eval "$2"; then echo "PASS: $1"; else echo "FAIL: $1"; FAILS=$((FAILS + 1)); fi
}

# --- 직접 인자 모드 ---
WORK="$(mktemp -d)"
cp -r "$FIX/." "$WORK/"

"$SCRIPT" "$WORK/notes/transformer-attention.md" "$WORK" >/dev/null 2>&1
assert "INDEX.md 생성됨" "test -f '$WORK/_wiki/INDEX.md'"
assert "INDEX에 id 줄 포함" "grep -q 'transformer-attention' '$WORK/_wiki/INDEX.md'"
assert "INDEX에 summary 포함" "grep -q 'self-attention' '$WORK/_wiki/INDEX.md'"
assert "INDEX에 type 포함" "grep -q 'research' '$WORK/_wiki/INDEX.md'"

# 동일 노트 재처리 시 중복 줄이 생기지 않음 (id 줄 교체)
"$SCRIPT" "$WORK/notes/transformer-attention.md" "$WORK" >/dev/null 2>&1
COUNT="$(grep -c '^- transformer-attention |' "$WORK/_wiki/INDEX.md")"
assert "중복 없이 1줄 유지" "[ '$COUNT' -eq 1 ]"

# 미등록 태그 경고
OUT="$("$SCRIPT" "$WORK/notes/bad-tag.md" "$WORK" 2>&1)"
assert "미등록 태그 경고 출력" "echo \"\$OUT\" | grep -q '미등록 태그'"

rm -rf "$WORK"

# --- hook stdin JSON 모드 (jq 있을 때만) ---
if command -v jq >/dev/null 2>&1; then
  WORK2="$(mktemp -d)"
  cp -r "$FIX/." "$WORK2/"
  export CC_DEEP_TUTOR_PROJECT_ROOT="$WORK2"
  export CC_DEEP_TUTOR_MATERIALS_DIR="$WORK2"
  export CC_DEEP_TUTOR_AUTO_INDEX_ON_WRITE="true"
  PAYLOAD="$(jq -nc --arg p "$WORK2/notes/transformer-attention.md" \
    '{tool_name:"Write", tool_input:{file_path:$p}}')"
  echo "$PAYLOAD" | "$SCRIPT" >/dev/null 2>&1
  assert "stdin 모드 INDEX 갱신" "grep -q 'transformer-attention' '$WORK2/_wiki/INDEX.md'"
  rm -rf "$WORK2"
else
  echo "SKIP: jq 없음 — stdin 모드 테스트 생략"
fi

echo "---"
if [ "$FAILS" -eq 0 ]; then echo "ALL PASS"; else echo "$FAILS FAIL"; fi
[ "$FAILS" -eq 0 ]
