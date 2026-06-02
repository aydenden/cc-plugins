#!/usr/bin/env bash
# update-index.sh — 마크다운 노트 frontmatter를 파싱해 _wiki/INDEX.md를 갱신하고,
# _wiki/tags.md 레지스트리에 없는 태그를 경고한다. (memsearch auto-index 대체)
#
# 두 가지 호출 방식:
#   1) 직접 인자 모드 (테스트/수동): update-index.sh <note-path> <materials-root>
#   2) hook stdin JSON 모드 (PostToolUse): stdin으로 Claude Code hook 페이로드 수신
#      { "tool_name": "Write"|"Edit", "tool_input": { "file_path": "..." } }
#      materials-root는 resolve-config.sh로 해석.
#
# hook 모드는 백그라운드 호출을 가정 — 실패해도 사용자 작업을 막지 않도록 조용히 종료.

set -uo pipefail

# --- frontmatter 헬퍼 ---
extract_fm() { sed -n '/^---[[:space:]]*$/,/^---[[:space:]]*$/p' "$1"; }
fm_field() {
  # $1=note  $2=key
  extract_fm "$1" | grep -m1 "^$2:" | sed "s/^$2:[[:space:]]*//"
}

update_index() {
  # $1=note  $2=materials-root
  local note="$1" root="$2"
  local wiki="$root/_wiki" index="$root/_wiki/INDEX.md" tagreg="$root/_wiki/tags.md"
  [ -f "$note" ] || { echo "⚠ 노트 없음: $note" >&2; return 0; }
  mkdir -p "$wiki"

  local id type tags summary
  id="$(fm_field "$note" id)"
  type="$(fm_field "$note" type)"
  tags="$(fm_field "$note" tags)"
  summary="$(fm_field "$note" summary)"
  [ -n "$id" ] || { echo "⚠ id 없음(인덱싱 skip): $note" >&2; return 0; }

  # INDEX.md 갱신 — 같은 id 줄은 교체, 없으면 추가
  [ -f "$index" ] || printf '# KB Index (auto-generated — 직접 편집 금지)\n' > "$index"
  if grep -q "^- $id |" "$index"; then
    local tmp; tmp="$(mktemp)"
    grep -v "^- $id |" "$index" > "$tmp" && mv "$tmp" "$index"
  fi
  printf -- '- %s | %s | %s | %s\n' "$id" "$type" "$tags" "$summary" >> "$index"

  # 태그 레지스트리 검증
  if [ -f "$tagreg" ]; then
    printf '%s\n' "$tags" | tr -d '[]' | tr ',' '\n' | while IFS= read -r raw || [ -n "$raw" ]; do
      local t; t="$(printf '%s' "$raw" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
      [ -z "$t" ] && continue
      grep -q "^- $t " "$tagreg" || echo "⚠ 미등록 태그: $t — tags.md에 추가 필요" >&2
    done
  fi
}

# --- 모드 분기 ---
if [ "$#" -ge 2 ]; then
  # 직접 인자 모드
  update_index "$1" "$2"
  exit 0
fi

# hook stdin JSON 모드
command -v jq >/dev/null 2>&1 || exit 0
PAYLOAD="$(cat)"
FILE_PATH="$(printf '%s' "$PAYLOAD" | jq -r '.tool_input.file_path // empty')"
[ -n "$FILE_PATH" ] || exit 0
[[ "$FILE_PATH" == *.md ]] || exit 0

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
export CC_DEEP_TUTOR_PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
eval "$("$PLUGIN_ROOT/scripts/resolve-config.sh")"

[ "$CC_DEEP_TUTOR_AUTO_INDEX_ON_WRITE" = "true" ] || exit 0

abs_file="$(cd "$(dirname "$FILE_PATH")" 2>/dev/null && pwd)/$(basename "$FILE_PATH")"
abs_materials="$(cd "$CC_DEEP_TUTOR_MATERIALS_DIR" 2>/dev/null && pwd)"
[ -n "$abs_materials" ] || exit 0
[[ "$abs_file" == "$abs_materials"/* ]] || exit 0
# _wiki/ 자체 변경은 무시 (INDEX/tags 갱신 루프 방지)
[[ "$abs_file" == "$abs_materials"/_wiki/* ]] && exit 0

update_index "$abs_file" "$abs_materials" 2>>/tmp/cc-deep-tutor/update-index.log || true
exit 0
