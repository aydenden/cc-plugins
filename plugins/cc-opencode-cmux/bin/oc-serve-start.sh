#!/usr/bin/env bash
# oc-serve-start.sh — start opencode serve daemon (idempotent)
# Reuses existing daemon if already running on the configured port.
# Writes session metadata to /tmp/cc-oc-serve.env for subsequent calls.
set -euo pipefail

PORT="${CC_OC_PORT:-4096}"
HOST="${CC_OC_HOST:-127.0.0.1}"
META_FILE="/tmp/cc-oc-serve.env"

if [ ! -x "$(command -v opencode)" ]; then
  echo "ERROR: opencode CLI not found in PATH" >&2
  exit 1
fi

if curl -sf -o /dev/null -m 2 "http://$HOST:$PORT/global/health" 2>/dev/null; then
  echo "opencode serve already running at http://$HOST:$PORT"
  if [ -f "$META_FILE" ]; then
    cat "$META_FILE"
  fi
  exit 0
fi

PASSWORD="$(openssl rand -hex 16)"
export OPENCODE_SERVER_PASSWORD="$PASSWORD"
export OPENCODE_DISABLE_AUTOUPDATE=1

LOG_DIR="${TMPDIR:-/tmp}/cc-oc-serve"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/serve.log"

nohup opencode serve --port "$PORT" --hostname "$HOST" \
  >"$LOG_FILE" 2>&1 &
SERVE_PID=$!

for i in $(seq 1 30); do
  if curl -sf -o /dev/null -m 1 \
    -u "opencode:$PASSWORD" "http://$HOST:$PORT/global/health" 2>/dev/null; then
    {
      echo "CC_OC_PORT=$PORT"
      echo "CC_OC_HOST=$HOST"
      echo "CC_OC_PID=$SERVE_PID"
      echo "CC_OC_LOG=$LOG_FILE"
      echo "OPENCODE_SERVER_PASSWORD=$PASSWORD"
      echo "CC_OC_ATTACH_URL=http://$HOST:$PORT"
    } > "$META_FILE"
    chmod 600 "$META_FILE"
    echo "opencode serve started: pid=$SERVE_PID port=$PORT"
    cat "$META_FILE"
    exit 0
  fi
  sleep 0.5
done

echo "ERROR: opencode serve failed to start within 15s" >&2
echo "log: $LOG_FILE" >&2
exit 1
