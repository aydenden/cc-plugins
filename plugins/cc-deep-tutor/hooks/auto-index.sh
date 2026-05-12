#!/usr/bin/env bash
# PostToolUse(Write/Edit) hook — materials 경로의 markdown 변경 시 memsearch 자동 인덱싱.
#
# 입력: stdin JSON (Claude Code hook payload)
#   {
#     "tool_name": "Write" | "Edit",
#     "tool_input": { "file_path": "...", ... },
#     "tool_response": { ... }
#   }
#
# 동작 조건:
#   1. auto_index_on_write != false
#   2. file_path가 materials_dir 안에 있음
#   3. 확장자 .md
#   4. memsearch 설치되어 있음
#
# 백그라운드 실행 — 사용자 작업을 막지 않음. 실패해도 silent.

set -uo pipefail

# stdin JSON 파싱
if ! command -v jq >/dev/null 2>&1; then
  exit 0  # jq 없으면 skip
fi

PAYLOAD="$(cat)"
TOOL_NAME="$(echo "$PAYLOAD" | jq -r '.tool_name // empty')"
FILE_PATH="$(echo "$PAYLOAD" | jq -r '.tool_input.file_path // empty')"

if [ -z "$FILE_PATH" ]; then exit 0; fi
if [[ ! "$FILE_PATH" == *.md ]]; then exit 0; fi

# 설정 로드
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

# CC_DEEP_TUTOR_PROJECT_ROOT는 사용자 cwd 기준 (CC가 어디서 호출됐든)
export CC_DEEP_TUTOR_PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"

eval "$("$PLUGIN_ROOT/scripts/resolve-config.sh")"

# 활성 여부
if [ "$CC_DEEP_TUTOR_AUTO_INDEX_ON_WRITE" != "true" ]; then exit 0; fi

# materials_dir 안에 있는지 확인 (절대 경로 비교)
abs_file="$(cd "$(dirname "$FILE_PATH")" 2>/dev/null && pwd)/$(basename "$FILE_PATH")"
abs_materials="$(cd "$CC_DEEP_TUTOR_MATERIALS_DIR" 2>/dev/null && pwd)"

if [ -z "$abs_materials" ] || [[ "$abs_file" != "$abs_materials"/* ]]; then
  exit 0
fi

# memsearch 가용성
if ! command -v memsearch >/dev/null 2>&1; then exit 0; fi

# 백그라운드 인덱싱 (로그는 /tmp에)
LOG_DIR="/tmp/cc-deep-tutor"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/auto-index.log"
{
  echo "[$(date '+%F %T')] index: $abs_file"
  memsearch index "$abs_file" 2>&1 || echo "  (index 실패)"
} >> "$LOG_FILE" 2>&1 &
disown 2>/dev/null || true

exit 0
