#!/usr/bin/env bash
# oc-prompt.sh — POST a prompt to an existing v2 session.
#
#   oc-prompt.sh <sid> <prompt-file> --dir D [--out PATH] [--timeout SEC]
#
# v0.6.0+: replaces `opencode run --attach` CLI dispatch with direct HTTP API v2 call.
# Endpoint: POST /api/session/:sessionID/prompt
# Payload : {"prompt": {"text": "<verbatim prompt body>"}}
# Headers : x-opencode-directory: <urlencoded path>   (replaces CLI --dir)
#
# POST returns as soon as the message is queued — the agent loop runs server-side.
# Caller is responsible for awaiting completion (typically by waiting on the
# background oc-sse-watch.sh process to exit on `session.status: idle`).
set -euo pipefail

META="${CC_OC_META:-/tmp/cc-oc-serve.env}"
[ -f "$META" ] || { echo "ERROR: no daemon metadata at $META. run: oc-daemon.sh ensure" >&2; exit 1; }
set -a; . "$META"; set +a

SID="${1:-}"; [ -n "$SID" ] || { echo "ERROR: session id required" >&2; exit 1; }
shift
PFILE="${1:-}"; [ -n "$PFILE" ] || { echo "ERROR: prompt file required" >&2; exit 1; }
shift

DIR=""
OUT=""
TIMEOUT="${CC_OC_PROMPT_TIMEOUT:-30}"
while [ $# -gt 0 ]; do
  case "$1" in
    --dir)     DIR="$2"; shift 2 ;;
    --out)     OUT="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    *) echo "ERROR: unknown flag $1" >&2; exit 1 ;;
  esac
done
[ -n "$DIR" ]   || { echo "ERROR: --dir required (sent as x-opencode-directory header)" >&2; exit 1; }
[ -f "$PFILE" ] || { echo "ERROR: prompt file not found: $PFILE" >&2; exit 1; }

# Compose JSON body in a temp file (safe for large prompts beyond argv limits).
BODY_FILE="$(mktemp -t oc-prompt-body.XXXXXX)"
trap 'rm -f "$BODY_FILE"' EXIT

python3 - "$PFILE" "$BODY_FILE" <<'PY'
import json, sys
src, dst = sys.argv[1], sys.argv[2]
with open(src, "r", encoding="utf-8") as f:
    text = f.read()
with open(dst, "w", encoding="utf-8") as f:
    json.dump({"prompt": {"text": text}}, f, ensure_ascii=False)
PY

# URL-encode the working directory for the routing header.
DIR_ENC="$(python3 -c 'import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "$DIR")"

URL="${CC_OC_ATTACH_URL}/api/session/${SID}/prompt"

CURL_ARGS=(
  -fsS -m "$TIMEOUT"
  -u "opencode:$OPENCODE_SERVER_PASSWORD"
  -X POST "$URL"
  -H "Content-Type: application/json"
  -H "x-opencode-directory: $DIR_ENC"
  --data-binary "@$BODY_FILE"
)

if [ -n "$OUT" ]; then
  curl "${CURL_ARGS[@]}" -o "$OUT"
else
  curl "${CURL_ARGS[@]}"
fi
