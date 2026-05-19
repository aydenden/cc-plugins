#!/usr/bin/env bash
# oc-message.sh — invoke OC via `opencode run --attach` so --dir actually applies.
#   send-new  <prompt-file>      --dir D [--agent A] [--model M] [--title T] [--out NDJSON]
#       starts a fresh session, prints session id to stdout, response NDJSON to --out.
#   send-cont <sid> <prompt-file> --dir D [--agent A] [--model M] [--out NDJSON]
#       continues an existing session.
#
# Why CLI instead of POST /session/:id/message?
#   The HTTP API silently ignores the `directory` parameter on session create
#   (still open as of v1.15.5). `opencode run --dir` honors the path.
set -euo pipefail

META=${CC_OC_META:-/tmp/cc-oc-serve.env}
[ -f "$META" ] || { echo "ERROR: no daemon metadata. run oc-daemon.sh ensure" >&2; exit 1; }
set -a; . "$META"; set +a

run_oc() {
  local sid="$1" pfile="$2"; shift 2
  local dir="" agent="" model="" title="" out=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --dir)   dir="$2"; shift 2 ;;
      --agent) agent="$2"; shift 2 ;;
      --model) model="$2"; shift 2 ;;
      --title) title="$2"; shift 2 ;;
      --out)   out="$2"; shift 2 ;;
      *) echo "ERROR: unknown flag $1" >&2; exit 1 ;;
    esac
  done
  [ -n "$dir" ]   || { echo "ERROR: --dir required (HTTP API ignores session directory)" >&2; exit 1; }
  [ -f "$pfile" ] || { echo "ERROR: prompt file not found: $pfile" >&2; exit 1; }

  local prompt; prompt=$(cat "$pfile")

  local args=(run --attach "$CC_OC_ATTACH_URL" --dir "$dir" --format json)
  [ -n "$sid" ]   && args+=(-s "$sid")
  [ -n "$agent" ] && args+=(--agent "$agent")
  [ -n "$model" ] && args+=(--model "$model")
  [ -n "$title" ] && args+=(--title "$title")

  local extract_sid_py='
import sys, json
seen = None
for ln in sys.stdin:
    try:
        d = json.loads(ln); s = d.get("sessionID")
        if s and seen is None:
            seen = s; print(s)
    except Exception:
        pass
'

  if [ -n "$out" ]; then
    opencode "${args[@]}" "$prompt" 2>"$out.err" | tee "$out" | python3 -c "$extract_sid_py"
  else
    opencode "${args[@]}" "$prompt" 2>/dev/null | python3 -c "$extract_sid_py"
  fi
}

case "${1:-}" in
  send-new)
    shift
    pfile="${1:?prompt file required}"; shift
    run_oc "" "$pfile" "$@"
    ;;
  send-cont)
    shift
    sid="${1:?sid required}"; shift
    pfile="${1:?prompt file required}"; shift
    run_oc "$sid" "$pfile" "$@"
    ;;
  *) cat >&2 <<EOF
oc-message.sh — invoke OC via 'opencode run --attach' (CLI --dir works, HTTP --directory does not)

usage:
  oc-message.sh send-new  <prompt-file>      --dir D [--agent A] [--model M] [--title T] [--out NDJSON]
  oc-message.sh send-cont <sid> <prompt-file> --dir D [--agent A] [--model M] [--out NDJSON]

stdout: OC session id (first sessionID seen in stream). Single line.
EOF
    exit 1 ;;
esac
