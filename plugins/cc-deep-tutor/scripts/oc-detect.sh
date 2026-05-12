#!/usr/bin/env bash
# cc-opencode-cmux 가용성 감지.
#
# usage:
#   eval "$(scripts/oc-detect.sh)"
#   # 이후 OC_MODE, OC_BIN_DIR, OC_STARTED_DAEMON 사용 가능
#
# OC_MODE: oc | cc-only | error
# OC_BIN_DIR: cc-opencode-cmux/bin 절대 경로 (비어있으면 미설치)
# OC_STARTED_DAEMON: 이 스크립트가 daemon을 시작했으면 1
#
# 환경변수:
#   CC_DEEP_TUTOR_OC_DELEGATE: auto | always | never  (default auto)
#   CC_OC_BIN_DIR: bin 경로 override (디버깅용)

set -uo pipefail

POLICY="${CC_DEEP_TUTOR_OC_DELEGATE:-auto}"

# 1) bin 디렉토리 탐색 — 마켓플레이스 경로 우선 (버전 디렉토리 없음, 항상 최신)
OC_BIN_DIR="${CC_OC_BIN_DIR:-}"
if [ -z "$OC_BIN_DIR" ]; then
  OC_BIN_DIR="$(ls -1d "$HOME"/.claude/plugins/marketplaces/*/plugins/cc-opencode-cmux/bin 2>/dev/null | head -1)"
fi
if [ -n "$OC_BIN_DIR" ] && [ ! -x "$OC_BIN_DIR/safe-oc.sh" ]; then
  OC_BIN_DIR=""
fi

OC_MODE="cc-only"
OC_STARTED_DAEMON=0

case "$POLICY" in
  never)
    OC_MODE="cc-only"
    ;;
  always|auto)
    if [ -z "$OC_BIN_DIR" ]; then
      if [ "$POLICY" = "always" ]; then
        echo "OC_MODE=error" >&2
        echo "OC_ERROR='cc-opencode-cmux not installed but oc_delegate=always'" >&2
        OC_MODE="error"
      fi
    elif [ -f /tmp/cc-oc-serve.env ] && \
         curl -sf -o /dev/null -m 2 "http://127.0.0.1:4096/global/health" 2>/dev/null; then
      OC_MODE="oc"
    elif command -v opencode >/dev/null 2>&1 && \
         opencode auth list 2>/dev/null | grep -qE '(opencode|opencode-go|openrouter|deepseek|anthropic|google|openai)'; then
      if bash "$OC_BIN_DIR/oc-serve-start.sh" >&2; then
        OC_MODE="oc"
        OC_STARTED_DAEMON=1
      elif [ "$POLICY" = "always" ]; then
        OC_MODE="error"
      fi
    elif [ "$POLICY" = "always" ]; then
      OC_MODE="error"
    fi
    ;;
esac

# 출력 (eval용)
cat <<EOF
export OC_MODE="$OC_MODE"
export OC_BIN_DIR="$OC_BIN_DIR"
export OC_STARTED_DAEMON=$OC_STARTED_DAEMON
EOF
