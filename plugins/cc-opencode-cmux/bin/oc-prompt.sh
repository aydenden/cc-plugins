#!/usr/bin/env bash
# oc-prompt.sh — POST a prompt to an existing session (SYNCHRONOUS).
#
#   oc-prompt.sh <sid> <prompt-file> --dir D [--out PATH] [--timeout SEC]
#
# Endpoint: POST /session/:sessionID/message            (v1 — works in v1.15.5)
# Payload : {"parts":[{"type":"text","text":"<verbatim prompt body>"}]}
# Headers : x-opencode-directory: <urlencoded path>     (replaces CLI --dir)
# Response: 200 with full assistant message JSON when the agent loop completes.
#
# This is synchronous: the POST blocks until OC finishes the agent loop. Set
# --timeout to a value comfortably larger than the longest expected task (oc-
# delegate.sh defaults to 900s / 15min).
#
# Response body is the assistant Session.Message — can be 10s of KB. To avoid
# polluting the caller's context, always pass --out FILE; curl writes the body
# to the file and emits nothing on stdout.
#
# Why not the other endpoints? In opencode v1.15.5:
#   * `POST /api/session/:id/prompt`        (v2)  is a no-op stub returning {},
#     causing "BadRequest: Expected Session.Message, got {}" (response schema
#     fails on empty handler return).
#   * `POST /session/:id/prompt_async`      (v1)  returns 204 but does not
#     actually trigger the agent loop — session stays cold, SSE never fires
#     session.status events. (Likely an internal queue issue in 1.15.x.)
#   * `POST /session/:id/message`           (v1)  works correctly — synchronous
#     and reliable. Used by `opencode run --attach` internally.
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
AGENT=""
TIMEOUT="${CC_OC_PROMPT_TIMEOUT:-30}"
while [ $# -gt 0 ]; do
  case "$1" in
    --dir)     DIR="$2"; shift 2 ;;
    --out)     OUT="$2"; shift 2 ;;
    --agent)   AGENT="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    *) echo "ERROR: unknown flag $1" >&2; exit 1 ;;
  esac
done
[ -n "$DIR" ]   || { echo "ERROR: --dir required (sent as x-opencode-directory header)" >&2; exit 1; }
[ -f "$PFILE" ] || { echo "ERROR: prompt file not found: $PFILE" >&2; exit 1; }

# Compose JSON body in a temp file (safe for large prompts beyond argv limits).
BODY_FILE="$(mktemp -t oc-prompt-body.XXXXXX)"
trap 'rm -f "$BODY_FILE"' EXIT

python3 - "$PFILE" "$BODY_FILE" "$AGENT" <<'PY'
import json, sys
src, dst, agent = sys.argv[1], sys.argv[2], sys.argv[3]
with open(src, "r", encoding="utf-8") as f:
    text = f.read()
body = {"parts": [{"type": "text", "text": text}]}
# agent 를 지정하면 그 agent 의 model/tools/permission 으로 실행된다. 미지정 시
# opencode 의 top-level 기본 model 로 떨어지는데, 그 기본이 무효 model 이면
# message 엔드포인트가 ProviderModelNotFoundError 를 동기 응답하지 못하고 hang 한다.
if agent:
    body["agent"] = agent
with open(dst, "w", encoding="utf-8") as f:
    json.dump(body, f, ensure_ascii=False)
PY

# URL-encode the working directory for the routing header.
DIR_ENC="$(python3 -c 'import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "$DIR")"

URL="${CC_OC_ATTACH_URL}/session/${SID}/message"

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
