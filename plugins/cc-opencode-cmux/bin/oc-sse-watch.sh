#!/usr/bin/env bash
# oc-sse-watch.sh — subscribe to opencode /event, filter by sessionID, drive cmux feed.
#
#   oc-sse-watch.sh <sid> [--out NDJSON] [--surface SURFACE] [--done-signal NAME]
#                        [--done-file PATH] [--auto-deny-permission]
#
# - exits 0 when session.status type=idle is observed for <sid>.
# - exits 2 on session.error or permission auto-deny.
# - emits short status lines to stderr; ndjson to --out.
set -euo pipefail

SID="${1:?session id required}"
shift

OUT=""
SURFACE=""
DONE_SIGNAL=""
DONE_FILE=""
AUTO_DENY=1   # default: deny everything for safety; --no-auto-deny to disable

while [ $# -gt 0 ]; do
  case "$1" in
    --out)                  OUT="$2"; shift 2 ;;
    --surface)              SURFACE="$2"; shift 2 ;;
    --done-signal)          DONE_SIGNAL="$2"; shift 2 ;;
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
export PLUGIN_DIR SID OUT SURFACE DONE_SIGNAL DONE_FILE AUTO_DENY

exec python3 - <<'PY'
import os, sys, base64, json, signal, time, socket, subprocess
import urllib.request

SID      = os.environ["SID"]
OUT      = os.environ.get("OUT") or ""
SURFACE  = os.environ.get("SURFACE") or ""
DONE_SIG = os.environ.get("DONE_SIGNAL") or ""
DONE_F   = os.environ.get("DONE_FILE") or ""
AUTO_DENY= os.environ.get("AUTO_DENY") == "1"
PLUGIN   = os.environ["PLUGIN_DIR"]
URL      = os.environ["CC_OC_ATTACH_URL"] + "/event"
PW       = os.environ["OPENCODE_SERVER_PASSWORD"]

out_fp = open(OUT, "a") if OUT else None
tool_count = 0
agent_name = ""
model_name = ""

def log(msg):
    sys.stderr.write(f"[oc-sse-watch:{SID[-8:]}] {msg}\n")
    sys.stderr.flush()

def feed(sub, *args):
    if not SURFACE: return
    try:
        subprocess.run([os.path.join(PLUGIN, "cmux-feed.sh"), sub, "--surface", SURFACE, *args],
                       check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=3)
    except Exception:
        pass

def permission_respond(pid, response):
    try:
        subprocess.run([os.path.join(PLUGIN, "oc-permission.sh"), "respond", SID, pid, response],
                       check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
    except Exception:
        pass

def find_sid(props):
    if not isinstance(props, dict): return None
    if isinstance(props.get("sessionID"), str): return props["sessionID"]
    info = props.get("info")
    if isinstance(info, dict):
        if isinstance(info.get("sessionID"), str): return info["sessionID"]
        if isinstance(info.get("id"), str) and info["id"].startswith("ses_"):
            return info["id"]
    return None

def finish(code, reason):
    log(f"exit code={code} reason={reason}")
    if DONE_F:
        try:
            with open(DONE_F, "w") as f: f.write(f"{code}\n{reason}\n")
        except Exception: pass
    if DONE_SIG:
        try:
            subprocess.run(["cmux", "wait-for", "--signal", DONE_SIG], timeout=3,
                           check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception: pass
    if out_fp:
        try: out_fp.close()
        except Exception: pass
    sys.exit(code)

signal.signal(signal.SIGTERM, lambda *_: finish(130, "SIGTERM"))
signal.signal(signal.SIGINT,  lambda *_: finish(130, "SIGINT"))

def handle(evt):
    global tool_count, agent_name, model_name
    t = evt.get("type") or ""
    props = evt.get("properties") or {}
    sid_match = find_sid(props)

    # write all events to ndjson (no filter) so we can debug later
    if out_fp:
        out_fp.write(json.dumps(evt, ensure_ascii=False) + "\n")
        out_fp.flush()

    # only act on events tied to our session
    if sid_match and sid_match != SID:
        return

    if t == "server.connected":
        log("SSE connected")
        feed("status", "running")
        return
    if t == "session.created":
        feed("log", "session created")
        return
    if t == "session.next.agent.switched":
        agent_name = (props.get("agent") or {}).get("name") or props.get("agent") or ""
        feed("log", f"agent: {agent_name}")
        return
    if t == "session.next.model.switched":
        model_name = (props.get("model") or {}).get("modelID") or props.get("model") or ""
        feed("log", f"model: {model_name}")
        return
    if t == "session.next.tool.called":
        tool = (props.get("tool") or {}).get("name") or props.get("name") or "?"
        tool_count += 1
        feed("log", f"tool[{tool_count}]: {tool}")
        # rough progress: cap at 90% pre-completion
        pct = min(5 + tool_count * 5, 90)
        feed("progress", str(pct))
        return
    if t == "message.part.updated":
        part = props.get("part") or {}
        if part.get("type") == "tool":
            state = (part.get("state") or {}).get("status")
            tname = (part.get("tool") or {}).get("name") or part.get("name") or "?"
            if state == "completed":
                feed("log", f"  ✓ {tname}")
        return
    if t == "session.status":
        st = (props.get("status") or {}).get("type") or props.get("status") or ""
        if st == "idle":
            feed("progress", "100")
            feed("status", "done")
            finish(0, "session idle")
        elif st == "error":
            feed("status", "error")
            finish(2, "session status error")
        else:
            feed("log", f"status: {st}")
        return
    if t == "session.error":
        err = (props.get("error") or {}).get("name") or "unknown"
        feed("status", f"error:{err}")
        finish(2, f"session.error {err}")
        return
    if t == "permission.asked":
        pid = props.get("id") or (props.get("info") or {}).get("id") or ""
        tool = (props.get("tool") or {}).get("name") or (props.get("info") or {}).get("type") or "?"
        feed("log", f"permission ask: {tool} (id={pid[:12]})")
        if AUTO_DENY and pid:
            permission_respond(pid, "deny")
            feed("log", f"  → auto-denied")
        return

# main loop with reconnect
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
        for raw in r:  # iterator over chunked lines, blocking
            s = raw.decode("utf-8", "replace").rstrip()
            if not s.startswith("data:"): continue
            payload = s[5:].strip()
            if not payload: continue
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
