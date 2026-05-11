---
description: Show active OpenCode delegations and their live SSE progress (tool calls, idle time, hang warnings).
argument-hint: "[<session_id>]"
allowed-tools: Bash, Read
---

# /cc-opencode-cmux:status

Report on running or recent OpenCode delegations.

## Steps

1. **List all sessions**:
   ```bash
   ls -td /tmp/cc-oc-* 2>/dev/null | head -20
   ```

2. **Daemon health**:
   - If `/tmp/cc-oc-serve.env` exists, source it and `curl -sf -o /dev/null -u opencode:$OPENCODE_SERVER_PASSWORD "$CC_OC_ATTACH_URL/global/health"` to verify
   - Report: daemon pid, port, last-known status

3. **Per-session table** (if `$1` not provided):
   For each `/tmp/cc-oc-<id>/`:
   - status file content (running / done / error / warn-soft-Ns / aborted)
   - exit_code if present
   - last event in events.ndjson (type and timestamp)
   - lines in oc.ndjson (output volume)

4. **Detailed view** (if `$1` provided):
   - Tail `/tmp/cc-oc-<id>/events.ndjson` to show last 10 SSE events
   - Show `/tmp/cc-oc-<id>/status`
   - If status is `warn-soft-*` or `running` and last event is >30s ago, warn about likely hang and suggest abort

5. **Abort suggestion**:
   - If any running session looks hung, suggest:
     `curl -X POST -u opencode:$OPENCODE_SERVER_PASSWORD $CC_OC_ATTACH_URL/session/<id>/abort`

## Notes

- Sessions older than 24h are not pruned automatically. Suggest `rm -rf /tmp/cc-oc-<id>` for cleanup.
