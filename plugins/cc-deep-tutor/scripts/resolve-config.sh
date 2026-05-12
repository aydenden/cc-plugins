#!/usr/bin/env bash
# Resolve cc-deep-tutor 설정값.
#
# 우선순위:
#   1. 환경변수 (CC_DEEP_TUTOR_<KEY>)
#   2. <project>/.claude/cc-deep-tutor.local.md (YAML frontmatter)
#   3. 기본값
#
# usage:
#   eval "$(scripts/resolve-config.sh)"
#   echo "$CC_DEEP_TUTOR_MATERIALS_DIR"
#
# 또는 단일 키:
#   scripts/resolve-config.sh get materials_dir

set -euo pipefail

PROJECT_ROOT="${CC_DEEP_TUTOR_PROJECT_ROOT:-$PWD}"
CONFIG_FILE="$PROJECT_ROOT/.claude/cc-deep-tutor.local.md"

# 기본값
DEFAULT_MATERIALS_DIR="$PROJECT_ROOT/materials"
DEFAULT_EXTRACT_DIR="$PROJECT_ROOT/materials/extracted"
DEFAULT_MAX_PARALLEL=3
DEFAULT_OC_DELEGATE="auto"
DEFAULT_OC_ONLY_COMPOSE="false"
DEFAULT_AUTO_INDEX="true"

# Frontmatter parsing (간단한 grep 기반, 큰따옴표 unquote)
read_yaml_value() {
  local key="$1"
  if [ ! -f "$CONFIG_FILE" ]; then
    return 1
  fi
  awk -v key="$key" '
    BEGIN { in_fm=0 }
    /^---[[:space:]]*$/ { in_fm = !in_fm; if (in_fm == 0) exit; next }
    in_fm && $0 ~ "^"key":" {
      sub("^"key":[[:space:]]*", "")
      gsub(/^["'"'"']|["'"'"']$/, "")
      print
      exit
    }
  ' "$CONFIG_FILE"
}

resolve() {
  local key="$1"
  local default="$2"
  local env_var="CC_DEEP_TUTOR_$(echo "$key" | tr '[:lower:]' '[:upper:]')"
  local env_val="${!env_var:-}"
  if [ -n "$env_val" ]; then
    echo "$env_val"
    return
  fi
  local fm_val
  fm_val="$(read_yaml_value "$key" || true)"
  if [ -n "$fm_val" ]; then
    echo "$fm_val"
    return
  fi
  echo "$default"
}

# 단일 키 모드
if [ "${1:-}" = "get" ] && [ -n "${2:-}" ]; then
  case "$2" in
    materials_dir) resolve materials_dir "$DEFAULT_MATERIALS_DIR" ;;
    extract_dir) resolve extract_dir "$DEFAULT_EXTRACT_DIR" ;;
    max_parallel_topics) resolve max_parallel_topics "$DEFAULT_MAX_PARALLEL" ;;
    oc_delegate) resolve oc_delegate "$DEFAULT_OC_DELEGATE" ;;
    oc_only_compose) resolve oc_only_compose "$DEFAULT_OC_ONLY_COMPOSE" ;;
    auto_index_on_write) resolve auto_index_on_write "$DEFAULT_AUTO_INDEX" ;;
    *) echo "unknown key: $2" >&2; exit 1 ;;
  esac
  exit 0
fi

# Export 모드 (eval용)
cat <<EOF
export CC_DEEP_TUTOR_MATERIALS_DIR="$(resolve materials_dir "$DEFAULT_MATERIALS_DIR")"
export CC_DEEP_TUTOR_EXTRACT_DIR="$(resolve extract_dir "$DEFAULT_EXTRACT_DIR")"
export CC_DEEP_TUTOR_MAX_PARALLEL_TOPICS="$(resolve max_parallel_topics "$DEFAULT_MAX_PARALLEL")"
export CC_DEEP_TUTOR_OC_DELEGATE="$(resolve oc_delegate "$DEFAULT_OC_DELEGATE")"
export CC_DEEP_TUTOR_OC_ONLY_COMPOSE="$(resolve oc_only_compose "$DEFAULT_OC_ONLY_COMPOSE")"
export CC_DEEP_TUTOR_AUTO_INDEX_ON_WRITE="$(resolve auto_index_on_write "$DEFAULT_AUTO_INDEX")"
export CC_DEEP_TUTOR_PROJECT_ROOT="$PROJECT_ROOT"
EOF
