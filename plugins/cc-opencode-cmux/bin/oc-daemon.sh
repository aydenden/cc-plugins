#!/usr/bin/env bash
# oc-daemon.sh — single entry point for opencode serve daemon lifecycle.
# Subcommands: ensure | stop | status | health | env
#
# - ensure: idempotent start. reuses live daemon, version-pins v1.14.48 (warn if drift).
# - stop:   TERM then KILL, clean metadata.
# - status: pid alive + authenticated health report.
# - health: exit 0 iff /global/health responds 200 with stored credentials.
# - env:    print the env file (sourceable) for downstream scripts.
set -euo pipefail

PINNED_VERSION="1.15.5"
PORT="${CC_OC_PORT:-4096}"
HOST="${CC_OC_HOST:-127.0.0.1}"
META_FILE="${CC_OC_META:-/tmp/cc-oc-serve.env}"
START_TIMEOUT_S="${CC_OC_START_TIMEOUT:-15}"

die() { echo "ERROR: $*" >&2; exit 1; }
warn() { echo "WARN: $*" >&2; }
note() { echo "$*"; }

require_opencode() {
  command -v opencode >/dev/null 2>&1 \
    || die "opencode CLI not in PATH. install: brew install opencode-ai/opencode/opencode"
}

current_version() {
  opencode --version 2>/dev/null | head -1 | tr -d '[:space:]'
}

check_version() {
  local cur
  cur="$(current_version)"
  if [ -z "$cur" ]; then
    warn "could not read opencode version"
    return 0
  fi
  if [ "$cur" != "$PINNED_VERSION" ]; then
    warn "opencode version $cur != pinned $PINNED_VERSION. known regressions in v1.15.x (InstanceRef). pin with: opencode upgrade $PINNED_VERSION"
  fi
}

load_meta() {
  [ -f "$META_FILE" ] || return 1
  # shellcheck disable=SC1090
  . "$META_FILE"
  return 0
}

auth_curl() {
  # $1 = path (e.g. /global/health). uses stored password.
  local path="$1"
  curl -fsS -m 3 -u "opencode:${OPENCODE_SERVER_PASSWORD:-}" \
    "http://${CC_OC_HOST}:${CC_OC_PORT}${path}"
}

health_ok() {
  load_meta || return 1
  auth_curl "/global/health" >/dev/null 2>&1
}

pid_alive() {
  [ -n "${CC_OC_PID:-}" ] && kill -0 "$CC_OC_PID" 2>/dev/null
}

cmd_ensure() {
  require_opencode
  check_version

  if load_meta && pid_alive && health_ok; then
    note "opencode daemon already running. pid=${CC_OC_PID} url=${CC_OC_ATTACH_URL}"
    return 0
  fi

  # stale meta — clean up before spawning fresh
  if [ -f "$META_FILE" ]; then
    warn "stale daemon metadata. cleaning up."
    rm -f "$META_FILE"
  fi

  local password log_dir log_file
  password="$(openssl rand -hex 16)"
  log_dir="${TMPDIR:-/tmp}/cc-oc-serve"
  mkdir -p "$log_dir"
  log_file="$log_dir/serve.log"

  export OPENCODE_SERVER_PASSWORD="$password"
  export OPENCODE_DISABLE_AUTOUPDATE=1

  nohup opencode serve --port "$PORT" --hostname "$HOST" \
    >"$log_file" 2>&1 &
  local serve_pid=$!

  local i
  for i in $(seq 1 $((START_TIMEOUT_S * 2))); do
    if curl -fsS -m 1 -u "opencode:$password" \
        "http://$HOST:$PORT/global/health" >/dev/null 2>&1; then
      umask 077
      cat >"$META_FILE" <<EOF
CC_OC_PORT=$PORT
CC_OC_HOST=$HOST
CC_OC_PID=$serve_pid
CC_OC_LOG=$log_file
OPENCODE_SERVER_PASSWORD=$password
CC_OC_ATTACH_URL=http://$HOST:$PORT
EOF
      chmod 600 "$META_FILE"
      note "opencode daemon started. pid=$serve_pid url=http://$HOST:$PORT"
      return 0
    fi
    sleep 0.5
  done

  die "opencode daemon failed to start within ${START_TIMEOUT_S}s. log: $log_file"
}

cmd_stop() {
  if ! load_meta; then
    note "no daemon metadata at $META_FILE"
    return 0
  fi

  if pid_alive; then
    kill -TERM "$CC_OC_PID" 2>/dev/null || true
    local i
    for i in 1 2 3 4 5; do
      pid_alive || break
      sleep 0.5
    done
    pid_alive && kill -KILL "$CC_OC_PID" 2>/dev/null || true
    note "stopped opencode daemon pid=$CC_OC_PID"
  else
    note "opencode daemon pid=$CC_OC_PID not running"
  fi

  rm -f "$META_FILE"
}

cmd_status() {
  if ! load_meta; then
    note "status:  not_running"
    note "reason:  no metadata at $META_FILE"
    return 1
  fi

  local alive=no health=no
  pid_alive && alive=yes
  health_ok && health=yes

  note "status:  $([ "$alive" = yes ] && [ "$health" = yes ] && echo running || echo degraded)"
  note "pid:     $CC_OC_PID (alive=$alive)"
  note "url:     $CC_OC_ATTACH_URL"
  note "health:  $health"
  note "version: $(current_version) (pinned $PINNED_VERSION)"
  note "log:     $CC_OC_LOG"

  [ "$alive" = yes ] && [ "$health" = yes ]
}

cmd_health() {
  health_ok && { note "ok"; return 0; }
  note "fail"
  return 1
}

cmd_env() {
  [ -f "$META_FILE" ] || die "no daemon metadata. run: oc-daemon.sh ensure"
  cat "$META_FILE"
}

case "${1:-}" in
  ensure)  shift; cmd_ensure "$@" ;;
  stop)    shift; cmd_stop "$@" ;;
  status)  shift; cmd_status "$@" ;;
  health)  shift; cmd_health "$@" ;;
  env)     shift; cmd_env "$@" ;;
  ""|help|--help|-h)
    cat <<EOF
oc-daemon.sh — opencode serve daemon lifecycle

usage: oc-daemon.sh <subcommand>

subcommands:
  ensure   idempotent start. reuses live daemon, warns on version drift.
  stop     terminate daemon and clean metadata.
  status   report pid + auth health + version.
  health   exit 0 iff authenticated /global/health responds 200.
  env      print the metadata env file (sourceable).

env:
  CC_OC_PORT     (default 4096)
  CC_OC_HOST     (default 127.0.0.1)
  CC_OC_META     (default /tmp/cc-oc-serve.env)
EOF
    [ -z "${1:-}" ] && exit 1 || exit 0
    ;;
  *) die "unknown subcommand: $1. try: oc-daemon.sh help" ;;
esac
