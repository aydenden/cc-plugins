#!/usr/bin/env bash
# PDF → MinerU → 마크다운 위키 노트(frontmatter 골격) 파이프라인.
#
# usage:
#   extract.sh <pdf>                       # 기본 backend(pipeline) + ko OCR
#   extract.sh <pdf> --backend hybrid      # 수식·표 많은 자료
#   extract.sh <pdf> --no-frontmatter      # 추출만, frontmatter 골격 삽입 skip
#   extract.sh <dir> --batch               # 디렉토리 일괄
#
# 추출 후 .md에 frontmatter가 없으면 검색에 필요한 결정적 필드(id/type/source_pdf/
# pages/date)를 가진 골격을 삽입한다. summary/tags는 비워 두고, kb-search `add` 흐름에서
# OC(oc-summarize) 위임으로 채운 뒤 PostToolUse hook이 INDEX를 갱신한다.
# (--no-capture는 --no-frontmatter의 하위호환 별칭)
#
# EXTRACT_DIR은 cc-deep-tutor.local.md의 extract_dir에서 가져옴.

set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
eval "$("$PLUGIN_ROOT/scripts/resolve-config.sh")"

EXTRACT_DIR="$CC_DEEP_TUTOR_EXTRACT_DIR"
BACKEND="pipeline"
LANG="korean"
DO_CAPTURE=1
BATCH=0
INPUT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend) BACKEND="$2"; shift 2 ;;
    --lang) LANG="$2"; shift 2 ;;
    --no-frontmatter|--no-capture) DO_CAPTURE=0; shift ;;
    --batch) BATCH=1; shift ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) INPUT="$1"; shift ;;
  esac
done

if [[ -z "$INPUT" ]]; then
  echo "ERROR: 입력 파일/디렉토리 필요" >&2
  exit 1
fi

if ! command -v mineru >/dev/null 2>&1; then
  echo "ERROR: mineru 미설치. 'pip install -U \"mineru[core]\"'" >&2
  exit 2
fi

mkdir -p "$EXTRACT_DIR"

run_one() {
  local pdf="$1"
  local name
  name="$(basename "$pdf" .pdf)"
  echo "▸ extract: $pdf  (backend=$BACKEND lang=$LANG)"
  mineru -p "$pdf" -o "$EXTRACT_DIR" -b "$BACKEND" -l "$LANG"

  local md="$EXTRACT_DIR/$name/auto/${name}.md"
  if [[ ! -f "$md" ]]; then
    md="$(find "$EXTRACT_DIR/$name" -name '*.md' | head -1)"
  fi
  echo "  md: $md"

  if [[ "$DO_CAPTURE" -eq 1 && -f "$md" ]]; then
    insert_frontmatter "$md" "$name" "$pdf"
  fi
}

# 추출 .md에 frontmatter가 없으면 검색용 골격을 prepend한다.
# summary/tags는 빈 placeholder — kb-search add 흐름에서 OC가 채운다.
insert_frontmatter() {
  local md="$1" name="$2" pdf="$3"
  if head -1 "$md" | grep -q '^---[[:space:]]*$'; then
    echo "  (frontmatter 이미 있음 — skip)"
    return 0
  fi
  local pages=""
  if [[ -f "$pdf" ]] && command -v mdls >/dev/null 2>&1; then
    pages="$(mdls -name kMDItemNumberOfPages -raw "$pdf" 2>/dev/null || true)"
    [[ "$pages" =~ ^[0-9]+$ ]] || pages=""   # 숫자가 아니면 비움
  fi
  local tmp; tmp="$(mktemp)"
  {
    printf -- '---\n'
    printf 'id: %s\n' "$name"
    printf 'type: extract\n'
    printf 'title: %s\n' "$name"
    printf 'summary: \n'        # kb-search add 흐름에서 OC가 채움
    printf 'tags: []\n'         # _wiki/tags.md 레지스트리에서 채움
    printf 'source: %s\n' "$pdf"
    printf 'date: %s\n' "$(date +%F)"
    printf 'source_pdf: %s\n' "$pdf"
    printf 'pages: %s\n' "$pages"
    printf -- '---\n\n'
    cat "$md"
  } > "$tmp" && mv "$tmp" "$md"
  echo "  frontmatter 골격 삽입됨 (summary/tags 미작성 — kb-search add 흐름의 OC 위임으로 채우세요)"
}

if [[ "$BATCH" -eq 1 ]]; then
  find "$INPUT" -type f -name '*.pdf' | while read -r f; do run_one "$f"; done
else
  run_one "$INPUT"
fi

echo "done."
