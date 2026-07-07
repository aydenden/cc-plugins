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
LOCK_TIMEOUT_S="${CC_OC_LOCK_TIMEOUT:-30}"
LOCK_DIR="${META_FILE}.ensure.lock"

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

# mkdir-based atomic lock. portable across macOS/Linux without flock(1).
# stale lock (holder pid is dead) is auto-recovered. returns non-zero on timeout.
acquire_ensure_lock() {
  local waited_ms=0
  local step_ms=200
  local timeout_ms=$((LOCK_TIMEOUT_S * 1000))
  while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    if [ -r "$LOCK_DIR/pid" ]; then
      local holder
      holder="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
      if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then
        warn "stale ensure lock from dead pid=$holder. clearing."
        rm -rf "$LOCK_DIR"
        continue
      fi
    fi
    if [ "$waited_ms" -ge "$timeout_ms" ]; then
      return 1
    fi
    sleep 0.2
    waited_ms=$((waited_ms + step_ms))
  done
  echo "$$" >"$LOCK_DIR/pid"
}

release_ensure_lock() {
  rm -rf "$LOCK_DIR"
}

cmd_ensure() {
  require_opencode
  check_version

  # fast path — already healthy, no spawn needed.
  if load_meta && pid_alive && health_ok; then
    note "opencode daemon already running. pid=${CC_OC_PID} url=${CC_OC_ATTACH_URL}"
    return 0
  fi

  # serialize the spawn path. concurrent fanout callers must not race to
  # bind the same PORT — only one spawns; the rest reuse the spawned daemon.
  acquire_ensure_lock \
    || die "could not acquire ensure lock at $LOCK_DIR within ${LOCK_TIMEOUT_S}s"

  # subshell scopes the EXIT trap to this critical section: any exit path
  # (return / die / set -e abort) releases the lock.
  (
    trap 'release_ensure_lock' EXIT

    # double-checked: a sibling may have started the daemon while we waited.
    if load_meta && pid_alive && health_ok; then
      note "opencode daemon already running (started by sibling). pid=${CC_OC_PID} url=${CC_OC_ATTACH_URL}"
      exit 0
    fi

    # stale meta — clean up before spawning fresh
    if [ -f "$META_FILE" ]; then
      warn "stale daemon metadata. cleaning up."
      rm -f "$META_FILE"
    fi

    password="$(openssl rand -hex 16)"
    log_dir="${TMPDIR:-/tmp}/cc-oc-serve"
    mkdir -p "$log_dir"
    log_file="$log_dir/serve.log"

    export OPENCODE_SERVER_PASSWORD="$password"
    export OPENCODE_DISABLE_AUTOUPDATE=1

    nohup opencode serve --port "$PORT" --hostname "$HOST" \
      >"$log_file" 2>&1 &
    serve_pid=$!

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
        exit 0
      fi
      sleep 0.5
    done

    die "opencode daemon failed to start within ${START_TIMEOUT_S}s. log: $log_file"
  )
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
