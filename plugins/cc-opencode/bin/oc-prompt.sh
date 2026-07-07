#!/usr/bin/env bash
# oc-prompt.sh — POST a prompt to an existing session (SYNCHRONOUS).
#
#   oc-prompt.sh <sid> <prompt-file> --dir D [--model P/M] [--variant V] \
#                [--agent A] [--out PATH] [--timeout SEC] [--print-body]
#
# Endpoint: POST /session/:sessionID/message            (v1 — works in v1.15.5)
# Payload : {"parts":[{"type":"text","text":"<prompt>"}], "model":{...}|"agent":A}
# Headers : x-opencode-directory: <urlencoded path>     (replaces CLI --dir)
# Response: 200 with full assistant message JSON when the model loop completes.
#
# Model selection (precedence): --model P/M  >  --agent A  >  default model
#   * --model opencode-go/deepseek-v4-pro → body.model={providerID,modelID}.
#     Optional --variant sets provider reasoning effort (high|max|minimal|…).
#   * --agent is retained for backward compat during the agent→model migration.
#   * If neither is given, falls back to CC_OC_DEFAULT_MODEL
#     (default opencode-go/deepseek-v4-pro). Sending an explicit model avoids the
#     old hang where an unset/invalid top-level default never responds.
#
# This is synchronous: the POST blocks until OC finishes the loop. Set --timeout
# comfortably larger than the longest expected task (oc-delegate defaults 900s).
#
# Response body is the assistant Session.Message (10s of KB). Always pass --out
# FILE so curl writes to the file and emits nothing on stdout.
#
# --print-body composes the request body, prints it, and exits (no daemon/curl) —
# used for testing and debugging body composition.
#
# Why this endpoint? In opencode v1.15.5, POST /session/:id/message (v1) is the
# only reliable synchronous path; /api/session/:id/prompt (v2) returns {} and
# /session/:id/prompt_async never triggers the loop.
set -euo pipefail

SID="${1:-}"; [ -n "$SID" ] || { echo "ERROR: session id required" >&2; exit 1; }
shift
PFILE="${1:-}"; [ -n "$PFILE" ] || { echo "ERROR: prompt file required" >&2; exit 1; }
shift

DIR=""
OUT=""
AGENT=""
MODEL=""
VARIANT=""
PRINT_BODY=0
TIMEOUT="${CC_OC_PROMPT_TIMEOUT:-30}"
while [ $# -gt 0 ]; do
  case "$1" in
    --dir)        DIR="$2"; shift 2 ;;
    --out)        OUT="$2"; shift 2 ;;
    --agent)      AGENT="$2"; shift 2 ;;
    --model)      MODEL="$2"; shift 2 ;;
    --variant)    VARIANT="$2"; shift 2 ;;
    --timeout)    TIMEOUT="$2"; shift 2 ;;
    --print-body) PRINT_BODY=1; shift ;;
    *) echo "ERROR: unknown flag $1" >&2; exit 1 ;;
  esac
done

[ -f "$PFILE" ] || { echo "ERROR: prompt file not found: $PFILE" >&2; exit 1; }

# Resolve model selection. Explicit model or agent wins; otherwise default model.
if [ -z "$MODEL" ] && [ -z "$AGENT" ]; then
  MODEL="${CC_OC_DEFAULT_MODEL:-opencode-go/deepseek-v4-pro}"
fi

# Tools disabled in every delegation (headless safety). Overridable via env;
# empty string disables the restriction entirely.
#   task/task_status/cancel_task — OC spawning subagents hangs the REST message
#     endpoint indefinitely (sst/opencode#6573). We never want OC subagents.
#   question — an interactive prompt that can never be answered headless → hang.
DISABLE_TOOLS="${CC_OC_DISABLE_TOOLS-task task_status cancel_task question}"

# Compose JSON body in a temp file (safe for large prompts beyond argv limits).
BODY_FILE="$(mktemp -t oc-prompt-body.XXXXXX)"
trap 'rm -f "$BODY_FILE"' EXIT

python3 - "$PFILE" "$BODY_FILE" "$MODEL" "$VARIANT" "$AGENT" "$DISABLE_TOOLS" <<'PY'
import json, sys
src, dst, model, variant, agent, disable_tools = sys.argv[1:7]
with open(src, "r", encoding="utf-8") as f:
    text = f.read()
body = {"parts": [{"type": "text", "text": text}]}
# model 을 지정하면 그 모델로 직접 실행된다 (providerID/modelID 분리). 미지정 시
# agent 로 폴백. 둘 다 없으면 호출부가 default model 을 채웠어야 한다 — 안 그러면
# opencode top-level 기본 model 로 떨어져 무효 시 message 엔드포인트가 hang 한다.
if model:
    provider, _, model_id = model.partition("/")
    body["model"] = {"providerID": provider, "modelID": model_id}
    if variant:
        body["variant"] = variant
elif agent:
    body["agent"] = agent
names = disable_tools.split()
if names:
    body["tools"] = {n: False for n in names}
with open(dst, "w", encoding="utf-8") as f:
    json.dump(body, f, ensure_ascii=False)
PY

if [ "$PRINT_BODY" = "1" ]; then
  cat "$BODY_FILE"
  exit 0
fi

# ── real POST: needs daemon metadata + working directory ────────────────────
META="${CC_OC_META:-/tmp/cc-oc-serve.env}"
[ -f "$META" ] || { echo "ERROR: no daemon metadata at $META. run: oc-daemon.sh ensure" >&2; exit 1; }
set -a; . "$META"; set +a

[ -n "$DIR" ] || { echo "ERROR: --dir required (sent as x-opencode-directory header)" >&2; exit 1; }

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
