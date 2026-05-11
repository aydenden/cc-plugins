---
description: Start the opencode serve daemon (HTTP API + SSE) used by /cc-opencode-cmux:delegate for fast attach.
allowed-tools: Bash
---

# /cc-opencode-cmux:serve-start

Start the OpenCode daemon. Idempotent — does nothing if already running.

## Steps

1. Run `${CLAUDE_PLUGIN_ROOT}/bin/oc-serve-start.sh`
2. Report the printed metadata (port, pid, log path)
3. If startup failed, surface the contents of the log file path

## Why this matters

Every `opencode run` invocation pays a ~75 second cold-start penalty if invoked standalone. Attaching to a running daemon via `--attach http://127.0.0.1:4096` reduces this to 1–3 seconds and reuses MCP servers across delegations.
