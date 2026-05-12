#!/usr/bin/env bash
# PDF → MinerU → memsearch capture 파이프라인.
#
# usage:
#   extract.sh <pdf>                       # 기본 backend(pipeline) + ko OCR
#   extract.sh <pdf> --backend hybrid      # 수식·표 많은 자료
#   extract.sh <pdf> --no-capture          # 추출만, 인덱싱 skip
#   extract.sh <dir> --batch               # 디렉토리 일괄
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
    --no-capture) DO_CAPTURE=0; shift ;;
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
    if command -v memsearch >/dev/null 2>&1; then
      echo "▸ index → memsearch"
      memsearch index "$md" || echo "  (index 실패 — 수동으로 재시도)"
    else
      echo "  (memsearch 미설치 — index skip)"
    fi
  fi
}

if [[ "$BATCH" -eq 1 ]]; then
  find "$INPUT" -type f -name '*.pdf' | while read -r f; do run_one "$f"; done
else
  run_one "$INPUT"
fi

echo "done."
