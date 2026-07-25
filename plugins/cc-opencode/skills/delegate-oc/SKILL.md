---
name: delegate-oc
description: Use when Claude Code (Opus orchestrator) is about to do repetitive coding work that fits the cc-opencode delegation policy — multi-file boilerplate implementation, mechanical refactors, code summarization, Korean/Chinese documentation, knowledge research, or document composition. Triggers on user requests like "구현해줘", "리팩터링", "이 파일들 요약", "한국어 문서 만들어줘", "조사해줘", or when Opus detects a task with low reasoning complexity but high token volume. **For ≥2 independent sub-tasks fired together** — triggers on "병렬로 위임", "동시에 위임", "한꺼번에", "여러 개 한 번에" — use `oc-fanout.sh` (see Parallel fan-out section). Other plugins (llm-wiki, cc-deep-tutor, pm, ...) call this skill via the Skill tool to delegate their own large-output subtasks.
---

# delegate-oc

Offload a large mechanical task to OpenCode via one controller call. The flow is: **decide → write spec → call `oc-delegate.sh` → branch on exit code**.

## Decide (all four must hold)

- Mechanical / pattern-following (scaffold, rename, summarization, structured doc, research, composition).
- Output > 200 lines or > 5 files or several pages of prose.
- Reasoning shallow — no architecture decisions, no ambiguous requirements.
- User did not ask for Opus quality ("think hard" / "carefully" / explicit Opus).

Skip if: < 3K tokens of work, no acceptance criterion, output > 70K tokens (split first — CC produces fixtures, then delegates the consuming code), binary output, **precise analysis / architecture judgement / subtle reasoning that OpenCode cannot match** — do it in CC directly. (If a native subagent was auto-redirected here by the hook but genuinely needs Opus, retry the Agent/Task call with the `[cc-only]` marker in the prompt to skip redirection.)

For size estimates use `wc -l <path>` — **never Read source files to estimate**.

## Call

One Bash invocation. Spec via heredoc; `OC_DIR` via `--dir`:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/oc-delegate.sh" --dir "$PWD" <<'EOF'
TASK_TYPE: implement | refactor | summarize | doc | research | compose | analyze
MODEL: <optional — opencode-go/<id> to override the TASK_TYPE default>
VARIANT: <optional — provider reasoning effort: high | max | minimal>
PERMISSION: <optional — scoped(default) | allow-all | deny-all; overrides ambient env for THIS delegation>
ALLOW_WRITE: <optional — extra writable roots outside --dir, colon-separated>
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

Flags: `--prompt-file FILE`, `--session-dir DIR`, `--title TITLE`, `--timeout SEC` (default `$CC_OC_WAIT_TIMEOUT` or 300), `--stall SEC` (hang detection — no progress update for SEC → cancel; default `$CC_OC_STALL_SECONDS` or 60).

## Branch on exit code

Transport is ACP (`opencode acp` over stdio, run by the bundled `dist/acp-client.mjs`).

| Code | Status | Action |
|---|---|---|
| 0 | `done` | Optionally `Skill(cc-opencode:oc-result-review, args: "<SESSION_DIR>")` for diff review |
| 11 | `error` | spawn / initialize / `session/new` failed — check opencode install/auth + `node` |
| 12 | `error` | prompt request rejected (transport/protocol) — inspect `SESSION_DIR/controller.log` |
| 13 | `error` | agent stopped with an error reason (refusal) — `oc-result-review` for diagnostic |
| 20 | `aborted-perm` | permission denied by policy (`scoped` default: a path outside `--dir`/`SESSION_DIR`/allowed roots, or a path-less bash/network request). Fix in the spec (no restart): put the target under `OUTPUT_FILE:` (auto-allowed), add `ALLOW_WRITE: <dir>`, or set `PERMISSION: allow-all` |
| 30 | `timeout` | exceeded `--timeout`; turn aborted, partial diff may be salvageable — re-spec with a tighter task or larger `--timeout` |
| 31 | `stalled` | no progress for `--stall`s — hang detected, turn cancelled, partial diff retained — inspect via `oc-result-review`, then re-spec |

Stdout always carries a 7-line report (`status:` / `session:` / `oc_sid:` / `files:` / `diff:` / `done:` / `notes:`). Surface to caller verbatim — downstream parsers depend on the format.

**How you (CC) learn OC status:** you get this report + exit code **once, when the turn finishes** — you do not observe live progress (`session/update` streaming stays inside `acp-client.mjs` to save your tokens). You never wait unboundedly: the stall/timeout watchdogs inside the client cancel a hung turn and return `31`/`30`, so a delegation always terminates with a definite status. For long or parallel work, run in background (`Bash(run_in_background: true)`) and poll with `BashOutput`.

## Parallel fan-out (≥2 independent sub-tasks)

When the user explicitly asks for parallel delegation ("병렬로 위임", "동시에 위임", "한꺼번에") **or** there are ≥2 independent specs ready, fire them in one Bash call so the `opencode acp` subprocesses run concurrently. Sequential `oc-delegate.sh` calls serialize on Opus's turn boundaries (each turn waits for the previous report).

Write each spec to a separate file, then one Bash call (run in background so Opus can yield the turn):

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/oc-fanout.sh" --dir "$PWD" --timeout 900 \
  /tmp/spec-1.md /tmp/spec-2.md /tmp/spec-3.md
```

Output: summary line (`fanout: N specs  wall=...ms  ratio=...`) + ASCII timeline + N×7-line reports concatenated with `--- [i] <SESSION_DIR> ---` separators. Exit code = max of individual delegate exit codes. Each spec spawns its own `opencode acp` subprocess (concurrent); scaling is near-linear (measured ratio ~1.97 for N=2).

Concurrency is capped at `CC_OC_FANOUT_CONCURRENCY` (default 4): with more specs than the cap, the rest queue and start as slots free. Prevents provider-rate / CPU-IO contention that can slow individual sessions into a stall (60s no-update → `31`). Set `0` for unlimited (legacy all-at-once).

Use `Bash(run_in_background: true)` for the fan-out call so Opus's turn is not held for the duration. Then `BashOutput` to collect the consolidated report when CC signals completion.

## Hard constraints

- **Never Read session output files.** `SESSION_DIR/{prompt.md,sse.ndjson,response.json,diff.patch,controller.log,oc_sid,acp-status.json}` are for `oc-result-review` only. Use `grep -c` / `wc -l` / `tail -c <small>` if you absolutely must peek.
- **Never fall back to direct execution.** OC fails → surface the report, stop. The caller decides next steps.
- **No re-delegation loops.** Retry = a fresh explicit call with a corrected spec.
- **No `Agent({subagent_type: "cc-opencode:oc-implementer"})`.** That entry point was removed in v0.6.0; calling it fails.
- **Trust the exit code — don't second-guess it.** The ACP client already classified the turn (permission auto-deny → `20`, hang → `31`). Branch on the code; don't re-run to "check".

Anything beyond this (sizing tables, knowledge-pipeline patterns, spec variants, anti-pattern checklist) lives in the plugin README. Read it once when uncertain — the skill body stays minimal so it doesn't cost tokens on every invocation.
