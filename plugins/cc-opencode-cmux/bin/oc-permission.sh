#!/usr/bin/env bash
# oc-permission.sh — respond to an opencode permission request.
#   respond <sid> <permissionID> <accept|deny> [--remember]
set -euo pipefail

META_FILE="${CC_OC_META:-/tmp/cc-oc-serve.env}"
[ -f "$META_FILE" ] || { echo "ERROR: no daemon metadata" >&2; exit 1; }
set -a; . "$META_FILE"; set +a

case "${1:-}" in
  respond)
    shift
    sid="${1:?sid required}"
    pid="${2:?permissionID required}"
    response="${3:?accept|deny required}"
    remember=false
    [ "${4:-}" = "--remember" ] && remember=true
    python3 - "$sid" "$pid" "$response" "$remember" <<'PY'
import sys, os, json, base64, urllib.request
sid, pid, response, remember = sys.argv[1:5]
url = f"{os.environ['CC_OC_ATTACH_URL']}/session/{sid}/permissions/{pid}"
pw  = os.environ["OPENCODE_SERVER_PASSWORD"]
body = json.dumps({"response": response, "remember": remember == "true"}).encode()
req = urllib.request.Request(url, data=body, method="POST", headers={
    "Content-Type": "application/json",
    "Authorization": "Basic " + base64.b64encode(f"opencode:{pw}".encode()).decode(),
})
try:
    with urllib.request.urlopen(req, timeout=10) as r:
        print(r.read().decode("utf-8","replace"))
except Exception as e:
    print(f"ERR {type(e).__name__}: {e}", file=sys.stderr); sys.exit(2)
PY
    ;;
  *) cat >&2 <<EOF
oc-permission.sh — respond to opencode permission request

usage: oc-permission.sh respond <sid> <permissionID> <accept|deny> [--remember]
EOF
    exit 1 ;;
esac
