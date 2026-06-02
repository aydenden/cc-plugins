#!/usr/bin/env bash
# oc-cmux-panel.sh — workflow TUI 용 cmux 우측 패널 생명주기.
# cmux 미존재 시 즉시 실패(fallback 없음).
set -euo pipefail
CMUX="${CMUX_BIN:-$(command -v cmux 2>/dev/null || echo /Applications/cmux.app/Contents/Resources/bin/cmux)}"
[ -x "$CMUX" ] || { echo "cmux not found: $CMUX (set CMUX_BIN)" >&2; exit 3; }
UUID_RE='[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}'

cmd="${1:-}"; shift || true
case "$cmd" in
  open)
    cwd="${1:?usage: open <cwd>}"
    out=$("$CMUX" new-split right --focus false --id-format both 2>&1)
    surf=$(printf '%s' "$out" | grep -oE "$UUID_RE" | head -1)
    [ -n "$surf" ] || { echo "surface uuid 추출 실패: $out" >&2; exit 1; }
    "$CMUX" send --surface "$surf" "cd '$cwd'" >/dev/null
    "$CMUX" send-key --surface "$surf" Enter >/dev/null
    echo "$surf"
    ;;
  run)
    surf="${1:?usage: run <surf> <cmd...>}"; shift
    "$CMUX" send --surface "$surf" "$*" >/dev/null
    "$CMUX" send-key --surface "$surf" Enter >/dev/null
    echo "running on $surf"
    ;;
  wait)
    sig="${1:?usage: wait <signal> [timeout]}"; to="${2:-1800}"
    "$CMUX" wait-for "$sig" --timeout "$to"
    ;;
  close)
    surf="${1:?usage: close <surf>}"
    "$CMUX" close-surface --surface "$surf" 2>&1 | head -1
    ;;
  *) echo "usage: oc-cmux-panel.sh <open|run|wait|close> ..." >&2; exit 2 ;;
esac
