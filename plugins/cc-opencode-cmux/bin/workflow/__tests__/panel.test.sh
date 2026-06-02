#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
PANEL="$HERE/oc-cmux-panel.sh"

# 1) cmux 부재 → exit 3
if CMUX_BIN=/nonexistent/cmux "$PANEL" open /tmp 2>/dev/null; then
  echo "FAIL: expected non-zero on missing cmux"; exit 1
fi
echo "ok: missing cmux fails"

# 2) 가짜 cmux 로 open 이 surface 출력
FAKE=$(mktemp); cat > "$FAKE" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  new-split) echo "surface:1 11111111-1111-1111-1111-111111111111" ;;
  send|send-key) : ;;
  *) : ;;
esac
EOF
chmod +x "$FAKE"
out=$(CMUX_BIN="$FAKE" "$PANEL" open /tmp)
echo "$out" | grep -qE '[0-9a-f]{8}-' && echo "ok: open prints uuid" || { echo "FAIL"; exit 1; }
echo "ALL PASS"
