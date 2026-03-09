#!/bin/bash
set -e

# --- 1. bun 설치 확인 및 설치 ---
BUN_INSTALLED=false

if command -v bun &>/dev/null; then
  BUN_INSTALLED=true
elif [ -f "$HOME/.bun/bin/bun" ]; then
  export PATH="$HOME/.bun/bin:$PATH"
  BUN_INSTALLED=true
fi

if [ "$BUN_INSTALLED" = false ]; then
  curl -fsSL https://bun.sh/install | bash 2>/dev/null
  export PATH="$HOME/.bun/bin:$PATH"
fi

# CLAUDE_ENV_FILE이 있으면 PATH 등록 (이후 Bash에서 bun 사용 가능)
if [ -n "$CLAUDE_ENV_FILE" ]; then
  echo 'export PATH="$HOME/.bun/bin:$PATH"' >> "$CLAUDE_ENV_FILE"
fi

# --- 2. CLAUDE_ENV_FILE 없으면 로컬 환경 → 종료 ---
if [ -z "$CLAUDE_ENV_FILE" ]; then
  exit 0
fi

# --- 3. Cowork 환경: 사용자 마운트 폴더에서 trading-env.json 탐색 ---
ENV_FILE=""

# /mnt 하위에서 사용자 폴더 탐색
if [ -d "/mnt" ]; then
  for d in /mnt/*/; do
    [ ! -d "$d" ] && continue
    base="$(basename "$d")"
    # 시스템 폴더 제외
    case "$base" in
      .claude|.local-plugins|.skills|outputs|uploads) continue ;;
    esac
    if [ -f "${d}trading-env.json" ]; then
      ENV_FILE="${d}trading-env.json"
      USER_FOLDER="${d%/}"
      break
    fi
  done
fi

# $HOME/mnt도 탐색
if [ -z "$ENV_FILE" ] && [ -d "$HOME/mnt" ]; then
  for d in "$HOME"/mnt/*/; do
    [ ! -d "$d" ] && continue
    base="$(basename "$d")"
    case "$base" in
      .claude|.local-plugins|.skills|outputs|uploads) continue ;;
    esac
    if [ -f "${d}trading-env.json" ]; then
      ENV_FILE="${d}trading-env.json"
      USER_FOLDER="${d%/}"
      break
    fi
  done
fi

# --- 4. trading-env.json 없으면 템플릿 생성 + 안내 ---
if [ -z "$ENV_FILE" ]; then
  # 첫 번째 사용자 폴더 찾기 (템플릿 생성용)
  TEMPLATE_DIR=""
  for search_root in "/mnt" "$HOME/mnt"; do
    [ ! -d "$search_root" ] && continue
    for d in "$search_root"/*/; do
      [ ! -d "$d" ] && continue
      base="$(basename "$d")"
      case "$base" in
        .claude|.local-plugins|.skills|outputs|uploads) continue ;;
      esac
      TEMPLATE_DIR="${d%/}"
      break
    done
    [ -n "$TEMPLATE_DIR" ] && break
  done

  if [ -n "$TEMPLATE_DIR" ]; then
    cat > "$TEMPLATE_DIR/trading-env.json" << 'TEMPLATE'
{
  "KIS_APP_KEY": "",
  "KIS_APP_SECRET": "",
  "FRED_API_KEY": "",
  "ECOS_API_KEY": "",
  "KRX_API_KEY": "",
  "DART_API_KEY": "",
  "NAVER_CLIENT_ID": "",
  "NAVER_CLIENT_SECRET": "",
  "KOREAEXIM_API_KEY": "",
  "DATA_GO_KR_API_KEY": "",
  "ALPHA_VANTAGE_API_KEY": ""
}
TEMPLATE

    cat << EOF
{
  "hookSpecificOutput": {
    "additionalContext": "trading-env.json 파일이 ${TEMPLATE_DIR}/trading-env.json 에 생성되었습니다. API 키를 입력한 뒤 세션을 재시작해 주세요. 모든 키가 필요하지는 않으며, 사용할 API의 키만 입력하면 됩니다."
  }
}
EOF
  fi
  exit 0
fi

# --- 5. trading-env.json에서 환경변수 로드 → CLAUDE_ENV_FILE에 기록 ---
python3 -c "
import json, sys, shlex
with open('$ENV_FILE') as f:
    env = json.load(f)
for k, v in env.items():
    if v:
        print(f'export {k}={shlex.quote(v)}')
" >> "$CLAUDE_ENV_FILE"

# --- 6. 캐시 디렉토리도 사용자 폴더로 지정 ---
CACHE_DIR="${USER_FOLDER}/.korean-trading-cache"
mkdir -p "$CACHE_DIR" 2>/dev/null
echo "export KOREAN_TRADING_CACHE_DIR=\"$CACHE_DIR\"" >> "$CLAUDE_ENV_FILE"

exit 0
