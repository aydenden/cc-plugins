---
description: Delegate a coding task to OpenCode (low-cost model). Auto-classifies task type, injects per-task permissions, spawns cmux pane, and watches via SSE.
argument-hint: "<task description> [--type implement|refactor|summarize|cjk-doc] [--worktree] [--model <override>]"
allowed-tools: Bash, Read, Write
---

# /cc-opencode-cmux:delegate

You are delegating a coding task from Claude Code (Opus, orchestrator) to OpenCode (cheaper implementer).

## Steps

1. **Parse arguments**:
   - Extract the task description (first positional, may include quoted text)
   - Detect flags: `--type`, `--worktree`, `--model`
   - If `--type` is missing, auto-classify with `${CLAUDE_PLUGIN_ROOT}/bin/route-task.sh "<spec>"`

2. **Prepare prompt file**:
   - Generate session id: `SESSION=$(uuidgen 2>/dev/null || date +%s-$$)`
   - Create directory: `mkdir -p /tmp/cc-oc-$SESSION`
   - Write the full spec (including any context the user wants OpenCode to have) into `/tmp/cc-oc-$SESSION/prompt.md`
   - Prepend project conventions snippet from `${CLAUDE_PLUGIN_ROOT}/templates/AGENTS.md.snippet` so OpenCode receives consistent style guidance

3. **Daemon auto-start**: `safe-oc.sh` checks `/tmp/cc-oc-serve.env` + health and auto-starts the daemon if missing (since v0.2.1). No explicit action needed unless `CC_OC_NO_AUTOSTART=1` is set.

4. **Spawn visual pane (optional, best-effort)**:
   - `${CLAUDE_PLUGIN_ROOT}/bin/cmux-spawn.sh "oc-$SESSION" tail -F /tmp/cc-oc-$SESSION/events.ndjson`

5. **Run watcher in background**:
   - `CC_OC_SESSION_ID=$SESSION ${CLAUDE_PLUGIN_ROOT}/bin/oc-watch.sh $SESSION <task_type> &`

6. **Invoke OpenCode**:
   - If `--worktree` is present, call `${CLAUDE_PLUGIN_ROOT}/bin/worktree-dispatch.sh <task_type> $PWD /tmp/cc-oc-$SESSION/prompt.md`
   - Otherwise: `CC_OC_SESSION_ID=$SESSION ${CLAUDE_PLUGIN_ROOT}/bin/safe-oc.sh <task_type> $PWD /tmp/cc-oc-$SESSION/prompt.md [<model_override>]`

7. **Report**:
   - Show: session id, task type, agent name, output location
   - Suggest: `/cc-opencode-cmux:review $SESSION` to inspect the diff

## Failure handling

- If `opencode` is not installed: tell the user to run `brew install opencode-ai/opencode/opencode`
- If no API key env var is set: tell the user to set one of `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, `OPENCODE_API_KEY`
- If `safe-oc.sh` exits non-zero: read `/tmp/cc-oc-$SESSION/status` and stderr for the reason. Common causes: `aborted (inactivity-Xs)`, `aborted (step-loop)`, `error`. Surface the reason and the path to `oc.ndjson` for debugging.

## Notes

- **Never** pass `--dangerously-skip-permissions` through to OpenCode. The plugin's permission JSONs encode the safe policy already.
- **Never** invoke `opencode -p` (that's password). Always use `opencode run`.
- Prompts are passed via **stdin redirection from a file** — do not pass long prompts inline.
