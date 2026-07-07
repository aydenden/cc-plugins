#!/usr/bin/env bash
# oc-session.sh — opencode session lifecycle wrapper.
#   create [--title T] [--dir D] [--raw]   → prints sid (or raw json with --raw)
#   list [--limit N]                                    → raw json
#   get <sid>                                           → raw json
#   abort <sid>                                         → raw json (or empty)
#   fork <sid> <messageID>                              → prints new sid
set -euo pipefail

META_FILE="${CC_OC_META:-/tmp/cc-oc-serve.env}"
[ -f "$META_FILE" ] || { echo "ERROR: no daemon metadata at $META_FILE. run: oc-daemon.sh ensure" >&2; exit 1; }
# shellcheck disable=SC1090
. "$META_FILE"

req() {
  # req <METHOD> <PATH> [json-body]
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -fsS -m 30 -u "opencode:$OPENCODE_SERVER_PASSWORD" \
      -X "$method" "${CC_OC_ATTACH_URL}${path}" \
      -H 'Content-Type: application/json' \
      -d "$body"
  else
    curl -fsS -m 30 -u "opencode:$OPENCODE_SERVER_PASSWORD" \
      -X "$method" "${CC_OC_ATTACH_URL}${path}"
  fi
}

extract_id() {
  # parse "id":"ses_..." or "id":"<uuid>" from json. tries common shapes.
  # 1) top-level id   2) info.id    3) data.id
  python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception as e:
    print(f"ERR parse: {e}", file=sys.stderr); sys.exit(2)
def find_id(d):
    if isinstance(d, dict):
        if "id" in d and isinstance(d["id"], str): return d["id"]
        for k in ("info", "data", "session"):
            if k in d:
                r = find_id(d[k]);
                if r: return r
    return None
i = find_id(d)
if not i:
    print("ERR no id field", file=sys.stderr); sys.exit(3)
print(i)
'
}

cmd_create() {
  local title="cc-delegate" dir="" raw=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --title) title="$2"; shift 2 ;;
      --dir)   dir="$2"; shift 2 ;;
      --raw)   raw=1; shift ;;
      *) echo "ERROR: unknown flag $1" >&2; exit 1 ;;
    esac
  done

  # build json body without jq. No agent binding — model is selected per-message
  # (oc-prompt.sh --model), so sessions are created model-agnostic.
  local body
  body=$(python3 -c '
import json, sys
d = {"title": sys.argv[1]}
if sys.argv[2]: d["directory"] = sys.argv[2]
print(json.dumps(d))
' "$title" "$dir")

  local resp
  resp=$(req POST "/session" "$body")
  if [ "$raw" -eq 1 ]; then
    echo "$resp"
  else
    echo "$resp" | extract_id
  fi
}

cmd_list() {
  local limit=10
  while [ $# -gt 0 ]; do
    case "$1" in
      --limit) limit="$2"; shift 2 ;;
      *) echo "ERROR: unknown flag $1" >&2; exit 1 ;;
    esac
  done
  req GET "/session?limit=$limit"
}

cmd_get()   { req GET    "/session/$1" ; }
cmd_abort() { req POST   "/session/$1/abort" '{}' ; }

# Resolve current server-side status of a session to a single lowercase token
# (e.g. "idle", "pending", "running", "error", "completed", "") on stdout.
# Returns "" when the response cannot be parsed — caller should treat that as
# "fall back to MSG_EXIT" rather than as a failure.
cmd_status_of() {
  local sid="$1"
  req GET "/session/$sid" 2>/dev/null | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
def find_status(d):
    if not isinstance(d, dict):
        return None
    s = d.get("status")
    if isinstance(s, dict):
        return s.get("type")
    if isinstance(s, str):
        return s
    info = d.get("info") or {}
    if isinstance(info, dict):
        s = info.get("status")
        if isinstance(s, dict):
            return s.get("type")
        if isinstance(s, str):
            return s
    return None
v = find_status(d) or ""
print(str(v).lower())
'
}

cmd_fork() {
  local sid="$1" mid="$2"
  local body
  body=$(python3 -c 'import json,sys; print(json.dumps({"messageID": sys.argv[1]}))' "$mid")
  req POST "/session/$sid/fork" "$body" | extract_id
}

case "${1:-}" in
  create)  shift; cmd_create "$@" ;;
  list)    shift; cmd_list "$@" ;;
  get)     shift; cmd_get "$@" ;;
  status)  shift; cmd_status_of "$@" ;;
  abort)   shift; cmd_abort "$@" ;;
  fork)    shift; cmd_fork "$@" ;;
  *) cat >&2 <<EOF
oc-session.sh — opencode session lifecycle

usage:
  oc-session.sh create [--title T] [--dir D] [--raw]
  oc-session.sh list [--limit N]
  oc-session.sh get <sid>
  oc-session.sh status <sid>   # prints lowercase status token ("idle", "running", ...) or "" if unparseable
  oc-session.sh abort <sid>
  oc-session.sh fork <sid> <messageID>
EOF
    exit 1 ;;
esac
