#!/usr/bin/env python3
"""Follow an opencode CLI NDJSON file (or read stdin) and emit a one-line
human-readable summary per event.

Usage:
  oc-stream-format.py <ndjson-path>   follow the file
  oc-stream-format.py                 read from stdin
"""
import sys, json, time, os

def dget(o, k, default=None):
    return o.get(k, default) if isinstance(o, dict) else default

def render(d):
    try:
        t = dget(d, "type", "?")
        p = dget(d, "part", {}) or {}
        if t == "step_start":
            return ">> step"
        if t == "step_finish":
            tk = dget(d, "tokens", {}) or {}
            out_tokens = dget(tk, "output", "?")
            cost = dget(d, "cost", "?")
            return f"<< step done (out_tokens={out_tokens} cost={cost})"
        if t == "tool_use":
            tool_obj = dget(p, "tool", {})
            tool = (dget(tool_obj, "name") if isinstance(tool_obj, dict) else tool_obj) \
                   or dget(p, "toolName") or dget(p, "name") or "?"
            return f"   tool: {tool}"
        if t == "text":
            txt = (dget(p, "text") or "").replace("\n", " ")[:160]
            return f"   text: {txt}" if txt else None
        if t == "error":
            return f"   ERROR: {json.dumps(d)[:200]}"
        return f"   ({t})"
    except Exception as e:
        return f"   (format error: {type(e).__name__})"

def emit(line):
    try:
        d = json.loads(line)
    except Exception:
        return
    s = render(d)
    if s:
        print(s, flush=True)

def main():
    if len(sys.argv) >= 2:
        path = sys.argv[1]
        while not os.path.exists(path):
            time.sleep(0.2)
        with open(path, "r") as f:
            for line in f:
                emit(line)
            while True:
                line = f.readline()
                if not line:
                    time.sleep(0.2)
                    try:
                        st = os.stat(path)
                        if st.st_size < f.tell():
                            f.seek(0)
                    except FileNotFoundError:
                        time.sleep(0.5)
                    continue
                emit(line)
    else:
        for line in sys.stdin:
            emit(line)

if __name__ == "__main__":
    main()
