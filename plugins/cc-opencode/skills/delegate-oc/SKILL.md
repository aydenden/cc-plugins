---
name: delegate-oc
description: Use when Claude Code (Opus orchestrator) is about to do repetitive coding work that fits the cc-opencode delegation policy — multi-file boilerplate implementation, mechanical refactors, code summarization, Korean/Chinese documentation, knowledge research, or document composition. Triggers on user requests like "구현해줘", "리팩터링", "이 파일들 요약", "한국어 문서 만들어줘", "조사해줘", or when Opus detects a task with low reasoning complexity but high token volume. **For ≥2 independent sub-tasks fired together** — triggers on "병렬로 위임", "동시에 위임", "한꺼번에", "여러 개 한 번에" — use `oc-fanout.sh` (see Parallel fan-out section). Other plugins (obsidian-knowledge, cc-deep-tutor, pm, ...) call this skill via the Skill tool to delegate their own large-output subtasks.
---

# delegate-oc

Offload a large mechanical task to OpenCode via one controller call. The flow is: **decide → write spec → call `oc-delegate.sh` → branch on exit code**.

## Decide (all four must hold)

- Mechanical / pattern-following (scaffold, rename, summarization, structured doc, research, composition).
- Output > 200 lines or > 5 files or several pages of prose.
- Reasoning shallow — no architecture decisions, no ambiguous requirements.
- User did not ask for Opus quality ("think hard" / "carefully" / explicit Opus).

Skip if: < 3K tokens of work, no acceptance criterion, output > 70K tokens (split first — CC produces fixtures, then delegates the consuming code), binary output, codebase needs subtle judgment.

For size estimates use `wc -l <path>` — **never Read source files to estimate**.

## Call

One Bash invocation. Spec via heredoc; `OC_DIR` via `--dir`:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/oc-delegate.sh" --dir "$PWD" <<'EOF'
TASK_TYPE: implement | refactor | summarize | doc | research | compose | analyze
MODEL: <optional — opencode-go/<id> to override the TASK_TYPE default>
VARIANT: <optional — provider reasoning effort: high | max | minimal>
TASK: <one-line summary>

FILES TO TOUCH:
- <absolute path> (create / modify)

BEHAVIOR:
- <bullet>

CONVENTIONS:
- <project-specific rules — or rely on AGENTS.md auto-loaded from --dir>

ACCEPTANCE TEST:
- $ <verifying command>
EOF
```

Model is chosen by `TASK_TYPE` (override with `MODEL:`): `implement`/`research` → `deepseek-v4-pro`, `refactor`/`doc`/`compose` → `qwen3.6-plus`, `summarize` → `deepseek-v4-flash`, `analyze` → `kimi-k2.6`. Upgrade candidates for `MODEL:`: `opencode-go/glm-5.2` (quality), `opencode-go/kimi-k2.7-code` (coding).

For `research` / `compose` / `analyze` task types, the spec uses extra fields (`OUTPUT_FILE`, `INPUT_RESEARCH`, scratch `--dir`, etc.) — see README's "Spec variants" section.

Flags: `--prompt-file FILE`, `--session-dir DIR`, `--title TITLE`, `--timeout SEC` (default `$CC_OC_WAIT_TIMEOUT` or 900).

## Branch on exit code

| Code | Status | Action |
|---|---|---|
| 0 | `done` | Optionally `Skill(cc-opencode:oc-result-review, args: "<SESSION_DIR>")` for diff review |
| 10 | `error` | `oc-daemon.sh ensure` failed — check opencode install/auth |
| 11 | `error` | `oc-session.sh create` failed — daemon may be unhealthy |
| 12 | `error` | HTTP POST failed — inspect `SESSION_DIR/controller.log` |
| 13 | `error` | OC emitted `session.error` — `oc-result-review` for diagnostic |
| 20 | `aborted-perm` | Spec implicitly asked something outside policy — re-spec or abandon |
| 30 | `timeout` | Session already aborted; partial diff may be salvageable |

Stdout always carries a 7-line report (`status:` / `session:` / `oc_sid:` / `files:` / `diff:` / `done:` / `notes:`). Surface to caller verbatim — downstream parsers depend on the format.

## Parallel fan-out (≥2 independent sub-tasks)

When the user explicitly asks for parallel delegation ("병렬로 위임", "동시에 위임", "한꺼번에") **or** there are ≥2 independent specs ready, fire them in one Bash call so the daemon receives them simultaneously. Sequential `oc-delegate.sh` calls serialize on Opus's turn boundaries (each turn waits for the previous report).

Write each spec to a separate file, then one Bash call (run in background so Opus can yield the turn):

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/oc-fanout.sh" --dir "$PWD" --timeout 900 \
  /tmp/spec-1.md /tmp/spec-2.md /tmp/spec-3.md
```

Output: summary line (`fanout: N specs  wall=...ms  ratio=...`) + ASCII timeline + N×7-line reports concatenated with `--- [i] <SESSION_DIR> ---` separators. Exit code = max of individual delegate exit codes.

Measured scaling (read-only analyze task on local daemon, v1.15.5):

| N | wall (ms) | ratio | efficiency |
|---|---|---|---|
| 1 | 23 184 | 1.00 | 100 % |
| 3 | 23 310 | 2.73 |  91 % |
| 5 | 21 273 | 4.87 |  97 % |
| 8 | 26 317 | 6.76 |  84 % |

Use `Bash(run_in_background: true)` for the fan-out call so Opus's turn is not held for the duration. Then `BashOutput` to collect the consolidated report when CC signals completion.

## Hard constraints

- **Never Read session output files.** `SESSION_DIR/{prompt.md,sse.ndjson,diff.patch,controller.log,watch.*}` are for `oc-result-review` only. Use `grep -c` / `wc -l` / `tail -c <small>` if you absolutely must peek.
- **Never fall back to direct execution.** OC fails → surface the report, stop. The caller decides next steps.
- **No re-delegation loops.** Retry = a fresh explicit call with a corrected spec.
- **No `Agent({subagent_type: "cc-opencode:oc-implementer"})`.** That entry point was removed in v0.6.0; calling it fails.
- **Never pass `--dangerously-skip-permissions`.** The SSE watcher auto-denies; let `aborted-perm` surface so the main session can re-spec.

Anything beyond this (sizing tables, knowledge-pipeline patterns, spec variants, anti-pattern checklist) lives in the plugin README. Read it once when uncertain — the skill body stays minimal so it doesn't cost tokens on every invocation.
