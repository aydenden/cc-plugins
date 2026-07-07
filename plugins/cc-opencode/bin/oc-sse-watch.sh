#!/usr/bin/env bash
# oc-sse-watch.sh — SSE side-channel for cc-opencode v0.6.0+.
#
#   oc-sse-watch.sh <sid> [--out NDJSON] [--done-file PATH] [--no-auto-deny]
#
# Role:
#   * Subscribe to opencode `/event` SSE and filter by sessionID == <sid>.
#   * Auto-deny any `permission.asked` for our session (safety; the main Opus
#     session decides whether to re-spec).
#   * **Primary completion signal** for delegate-oc skill: exits 0 on
#     `session.status: idle`, exit 2 on `session.error` / `session.status: error`.
#     Since v0.6.0 dropped `opencode run --attach`, oc-prompt.sh POSTs to v2
#     HTTP API and returns immediately — the main session then waits for *this*
#     watcher to exit (via `wait $WATCH_PID` or polling `--done-file`).
#
# Removed vs. earlier versions: cmux surface feeding, tool counters, agent /
# model tracking, progress percentages. Those existed only for the cmux right
# split (now gone).
set -euo pipefail

SID="${1:?session id required}"
shift

OUT=""
DONE_FILE=""
AUTO_DENY=1

while [ $# -gt 0 ]; do
  case "$1" in
    --out)                  OUT="$2"; shift 2 ;;
    --done-file)            DONE_FILE="$2"; shift 2 ;;
    --auto-deny-permission) AUTO_DENY=1; shift ;;
    --no-auto-deny)         AUTO_DENY=0; shift ;;
    *) echo "ERROR: unknown flag $1" >&2; exit 1 ;;
  esac
done

META_FILE="${CC_OC_META:-/tmp/cc-oc-serve.env}"
[ -f "$META_FILE" ] || { echo "ERROR: daemon metadata missing" >&2; exit 1; }
set -a; . "$META_FILE"; set +a

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
export PLUGIN_DIR SID OUT DONE_FILE AUTO_DENY

exec python3 - <<'PY'
import os, sys, base64, json, signal, time, subprocess
import urllib.request

SID       = os.environ["SID"]
OUT       = os.environ.get("OUT") or ""
DONE_F    = os.environ.get("DONE_FILE") or ""
AUTO_DENY = os.environ.get("AUTO_DENY") == "1"
PLUGIN    = os.environ["PLUGIN_DIR"]
URL       = os.environ["CC_OC_ATTACH_URL"] + "/event"
PW        = os.environ["OPENCODE_SERVER_PASSWORD"]

# Events without a sessionID that we still want to observe (server-level only).
GLOBAL_EVENTS = {"server.connected"}

out_fp = open(OUT, "a") if OUT else None

def log(msg):
    sys.stderr.write(f"[oc-sse-watch:{SID[-8:]}] {msg}\n")
    sys.stderr.flush()

def permission_respond(pid, response):
    try:
        subprocess.run(
            [os.path.join(PLUGIN, "oc-permission.sh"), "respond", SID, pid, response],
            check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10,
        )
    except Exception:
        pass

def find_sid(props):
    if not isinstance(props, dict):
        return None
    if isinstance(props.get("sessionID"), str):
        return props["sessionID"]
    info = props.get("info")
    if isinstance(info, dict):
        if isinstance(info.get("sessionID"), str):
            return info["sessionID"]
        if isinstance(info.get("id"), str) and info["id"].startswith("ses_"):
            return info["id"]
    return None

def finish(code, reason):
    log(f"exit code={code} reason={reason}")
    if DONE_F:
        try:
            with open(DONE_F, "w") as f:
                f.write(f"{code}\n{reason}\n")
        except Exception:
            pass
    if out_fp:
        try:
            out_fp.close()
        except Exception:
            pass
    sys.exit(code)

signal.signal(signal.SIGTERM, lambda *_: finish(130, "SIGTERM"))
signal.signal(signal.SIGINT,  lambda *_: finish(130, "SIGINT"))

def handle(evt):
    t = evt.get("type") or ""
    props = evt.get("properties") or {}

    # Strict SID filter. Non-global events must carry our sessionID; ambiguous
    # events (sessionID missing) are dropped too — they used to slip through
    # and trigger false idle exits caused by sibling sessions on the same daemon.
    if t not in GLOBAL_EVENTS:
        sid_match = find_sid(props)
        if sid_match != SID:
            return

    if out_fp:
        out_fp.write(json.dumps(evt, ensure_ascii=False) + "\n")
        out_fp.flush()

    if t == "server.connected":
        log("SSE connected")
        return
    if t == "session.status":
        st = (props.get("status") or {}).get("type") or props.get("status") or ""
        if st == "idle":
            finish(0, "session idle")
        elif st == "error":
            finish(2, "session status error")
        return
    if t == "session.error":
        err = (props.get("error") or {}).get("name") or "unknown"
        finish(2, f"session.error {err}")
        return
    if t == "permission.asked":
        pid = props.get("id") or (props.get("info") or {}).get("id") or ""
        tool = (props.get("tool") or {}).get("name") or (props.get("info") or {}).get("type") or "?"
        log(f"permission asked: {tool} (id={pid[:12]})")
        if AUTO_DENY and pid:
            permission_respond(pid, "deny")
            log("  auto-denied")
        return

backoff = 0.5
while True:
    try:
        req = urllib.request.Request(URL, headers={
            "Authorization": "Basic " + base64.b64encode(f"opencode:{PW}".encode()).decode(),
            "Accept": "text/event-stream",
        })
        r = urllib.request.urlopen(req, timeout=30)
        log("stream open")
        backoff = 0.5
        for raw in r:
            s = raw.decode("utf-8", "replace").rstrip()
            if not s.startswith("data:"):
                continue
            payload = s[5:].strip()
            if not payload:
                continue
            try:
                evt = json.loads(payload)
            except Exception:
                continue
            try:
                handle(evt)
            except Exception as e:
                log(f"handle error on {evt.get('type','?')}: {type(e).__name__}: {e}")
    except SystemExit:
        raise
    except Exception as e:
        log(f"stream error: {type(e).__name__}: {e}. reconnecting in {backoff:.1f}s")
        time.sleep(backoff)
        backoff = min(backoff * 2, 8.0)
PY
