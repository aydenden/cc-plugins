---
description: Stop the opencode serve daemon.
allowed-tools: Bash
---

# /cc-opencode-cmux:serve-stop

Terminate the running OpenCode daemon and remove its metadata file.

## Steps

1. Run `${CLAUDE_PLUGIN_ROOT}/bin/oc-serve-stop.sh`
2. Report what was stopped
3. Optionally prune `/tmp/cc-oc-*` session directories if the user requests cleanup
