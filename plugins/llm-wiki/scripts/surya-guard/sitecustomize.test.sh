#!/usr/bin/env bash
# Tests for surya-guard/sitecustomize.py. Run: scripts/surya-guard/sitecustomize.test.sh
# The guard is loaded against a stand-in for surya's client module, so neither
# surya nor a model server is needed. Python is: the guard only ever runs inside
# marker's own interpreter.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v python3 >/dev/null || { echo "FAIL python3 not on PATH"; exit 1; }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/surya/inference/backends"
touch "$TMP/surya/__init__.py" "$TMP/surya/inference/__init__.py" "$TMP/surya/inference/backends/__init__.py"

# A stand-in with surya's two seams and its retry loop.
cat > "$TMP/client_ok.py" <<'PY'
class Result:
    def __init__(self, raw, error=False):
        self.raw, self.error = raw, error

def _generate_one(item, client, **kwargs):
    completion = client.chat.completions.create(model="m", messages=[], max_tokens=64, temperature=kwargs.get("temperature", 0.0))
    return Result(completion.choices[0].message.content or "")

def _should_retry(result, retries, max_retries):
    if retries >= max_retries:
        return False
    tail = result.raw[:-50] if len(result.raw) > 50 else result.raw
    return result.raw.endswith(" " * 17) or tail.endswith(" " * 17)

def process(item, client):
    result = _generate_one(item, client=client)
    retries = 0
    while _should_retry(result, retries, 3):
        result = _generate_one(item, client=client, temperature=0.2)
        retries += 1
    return result, retries
PY

cat > "$TMP/harness.py" <<'PY'
import sys, types
import surya.inference.backends.openai_client as oc

class Chunk:
    def __init__(self, text, finish=None):
        delta = types.SimpleNamespace(content=text)
        self.choices = [types.SimpleNamespace(delta=delta, finish_reason=finish, logprobs=None)]
        self.usage = None
        self.model_extra = {}

class Stream:
    def __init__(self, pieces, log):
        self.pieces, self.log = pieces, log
    def __iter__(self):
        for i, piece in enumerate(self.pieces):
            self.log["sent"] = i + 1
            yield Chunk(piece, "stop" if i == len(self.pieces) - 1 else None)
    def close(self):
        self.log["closed"] = True

class Client:
    """Replays one scripted response per call and records what it was asked."""
    def __init__(self, scripts):
        self.scripts, self.calls, self.log = list(scripts), [], {}
        self.chat = types.SimpleNamespace(completions=self)
    def create(self, **kwargs):
        self.calls.append(kwargs)
        pieces = self.scripts.pop(0)
        if kwargs.get("stream"):
            return Stream(pieces, self.log)
        message = types.SimpleNamespace(content="".join(pieces))
        return types.SimpleNamespace(choices=[types.SimpleNamespace(message=message, finish_reason="stop", logprobs=None)],
                                     usage=None, model_extra={})

# 50 chars, so surya's cut-50 check lands exactly on the spaces before it.
TAIL = "| margin\n    return result;\n}</pre>\n</div>\n</div>\n"
assert len(TAIL) == 50, len(TAIL)

case = sys.argv[1]
if case == "grammar":
    client = Client([["<pre>x</pre>"]])
    result, retries = oc.process(object(), client)
    grammar = client.calls[0]["extra_body"]["grammar"]
    assert grammar == 'root ::= " "{0,64} ([^ ] " "{0,64})*', grammar
    assert result.raw == "<pre>x</pre>" and retries == 0
elif case == "abort":
    runaway = ["a;"] + [" "] * 3000
    client = Client([runaway, ["<pre>a;</pre>"]])
    result, retries = oc.process(object(), client)
    assert client.log["closed"] and client.log["sent"] < 600, client.log
    assert retries == 1 and result.raw == "<pre>a;</pre>", (retries, result.raw)
elif case == "capped":
    # 64 spaces of alignment padding sitting 50 chars before the end: surya's own check would retry.
    text = "<pre>a;" + " " * 64 + TAIL
    client = Client([[text]])
    result, retries = oc.process(object(), client)
    assert retries == 0, retries
elif case == "short-run-kept":
    # Without the grammar in force the same verdict must stand.
    text = "<pre>a;" + " " * 64 + TAIL
    client = Client([[text]] * 4)
    result, retries = oc.process(object(), client)
    assert retries == 3, retries
elif case == "passthrough":
    client = Client([["<pre>x</pre>"]])
    oc.process(object(), client)
    assert "extra_body" not in client.calls[0] and "stream" not in client.calls[0], client.calls[0]
print("ok")
PY

pass=0 fail=0
# run <name> <client module> <want status substring> <harness case|-> [VAR=value...]
run() {
  local name="$1" module="$2" want_status="$3" hcase="$4"; shift 4
  cp "$TMP/$module" "$TMP/surya/inference/backends/openai_client.py"
  rm -f "$TMP/status"
  local out code
  out="$(env "$@" SURYA_GUARD_STATUS="$TMP/status" PYTHONPATH="$DIR:$TMP" python3 "$TMP/harness.py" "$hcase" 2>&1)"; code=$?
  if [ "$hcase" != "-" ] && [ "$code" != 0 ]; then
    echo "FAIL $name — harness exit $code"; echo "$out" | sed 's/^/      /'; fail=$((fail+1)); return
  fi
  if ! grep -qF -- "$want_status" "$TMP/status" 2>/dev/null; then
    echo "FAIL $name — status lacks '$want_status': $(cat "$TMP/status" 2>/dev/null)"; echo "$out" | sed 's/^/      /'; fail=$((fail+1)); return
  fi
  pass=$((pass+1))
}

ON="SURYA_GUARD_SPACE_CAP=64 SURYA_GUARD_STREAM_ABORT=400"
run "grammar is sent with every request"            client_ok.py "patched space_cap=64 stream_abort=400" grammar $ON
run "a runaway is cut and retried"                  client_ok.py "patched" abort $ON
run "a capped space run is not a loop"              client_ok.py "patched" capped $ON
run "without the cap surya's verdict stands"        client_ok.py "patched space_cap=0" short-run-kept SURYA_GUARD_STREAM_ABORT=400
run "both switches off leaves requests untouched"   client_ok.py "patched space_cap=0 stream_abort=0" passthrough SURYA_GUARD_SPACE_CAP=0

# surya renamed a seam: the guard must say so instead of silently doing nothing.
sed 's/_should_retry/_needs_retry/g' "$TMP/client_ok.py" > "$TMP/client_renamed.py"
run "a missing seam is reported"                    client_renamed.py "failed: surya.inference.backends.openai_client has no _should_retry" - $ON

echo "surya-guard: $pass passed, $fail failed"
[ "$fail" = 0 ]
