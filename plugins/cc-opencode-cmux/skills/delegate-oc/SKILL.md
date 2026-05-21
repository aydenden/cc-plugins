---
name: delegate-oc
description: Use when Claude Code (Opus orchestrator) is about to do repetitive coding work that fits the cc-opencode-cmux delegation policy — multi-file boilerplate implementation, mechanical refactors, code summarization, Korean/Chinese documentation, knowledge research, or document composition. Triggers on user requests like "구현해줘", "리팩터링", "이 파일들 요약", "한국어 문서 만들어줘", "조사해줘", or when Opus detects a task with low reasoning complexity but high token volume. Other plugins (obsidian-knowledge, cc-deep-tutor, pm, ...) call this skill via the Skill tool to delegate their own large-output subtasks.
---

# delegate-oc

Offload a task to OpenCode via a **single controller script call**. The main Opus session:

1. Decides delegation eligibility (Skill-level decision).
2. Composes the spec verbatim.
3. Runs `${CLAUDE_PLUGIN_ROOT}/bin/oc-delegate.sh` **once**.
4. Branches on the exit code per the contract below.

The controller script handles the entire pipeline internally (daemon ensure → session create → SSE watcher → HTTP API v2 prompt → wait → diff → classify → report). The main session does not orchestrate intermediate steps and therefore does not pay tokens for them.

## When to delegate

Delegate when **all** hold:

- Task is mechanical or pattern-following (CRUD scaffold, rename, boilerplate, summarization, structured research, composition).
- Expected output is large (>200 lines or >5 files or several pages of prose).
- Reasoning is shallow — no architecture decisions, no ambiguous requirements.
- User did not explicitly ask for Opus-quality output.

## When NOT to delegate

- Architecture / API surface / cross-module coordination.
- User asked to "think hard" or specified Opus.
- Task small enough that delegation overhead (~3K tokens) exceeds savings.
- No clear acceptance criterion — Opus must judge iteratively.
- Output > 70K tokens or any binary — split first (CC produces fixture, then delegates the consuming code).

For LOC-based estimates, use `wc -l <path>` — **do not Read source files just to estimate size**.

## Sizing budget

| Output type | Tokens/line | Safe single-delegate LOC |
|---|---|---|
| Source code (Rust/Py/TS) | 50–80 | ≤ 1000 LOC |
| Markdown / Korean doc | 60–100 | ≤ 800 LOC |
| JSONL / CSV fixture | 150–300 | ≤ 250 LOC |
| Parquet / DB / binary | — | never delegate |

## How to call (the whole procedure)

**Single Bash invocation** — spec via heredoc, `OC_DIR` via `--dir`:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/oc-delegate.sh" --dir "$PWD" <<'EOF'
TASK_TYPE: implement | refactor | summarize | doc | research | compose | analyze
TASK: <one-line summary>

FILES TO TOUCH:
- <absolute path 1> (create / modify)
- <absolute path 2> (modify)

BEHAVIOR:
- <bullet 1>
- <bullet 2>

CONVENTIONS:
- <project rules — e.g. "use anyhow::Result for fallible">

ACCEPTANCE TEST:
- $ <command that verifies success>
EOF
```

The script prints a 7-line report to stdout and exits with a code from the contract table. Read both — the exit code drives the branch, the report carries the data.

### Optional flags

- `--prompt-file FILE` — pass spec via file path instead of stdin.
- `--session-dir DIR` — override session dir (default `$CLAUDE_PROJECT_DIR/.claude/oc-sessions/<uuid>`, `/tmp` fallback).
- `--title TITLE` — OC session title.
- `--timeout SEC` — wait timeout (default `$CC_OC_WAIT_TIMEOUT` or 900).

## Exit-code contract (branch table)

| Code | Status field | Meaning | Recommended action |
|---|---|---|---|
| **0** | `done` | Session completed normally | Optionally `Skill(cc-opencode-cmux:oc-result-review, args: "<session>")` for diff review |
| **10** | `error` | `oc-daemon.sh ensure` failed | Surface `notes:`; check `opencode` install/auth |
| **11** | `error` | `oc-session.sh create` failed | Surface `notes:`; daemon may be unhealthy — try once more then escalate |
| **12** | `error` | `oc-prompt.sh` POST failed | Surface `notes:`; check daemon log at `controller.log` |
| **13** | `error` | OC emitted `session.error` mid-flight | Surface `notes:`; `oc-result-review` for diagnostic |
| **20** | `aborted-perm` | Watcher auto-denied a `permission.asked` | Spec asked for something outside policy — re-spec or abandon |
| **30** | `timeout` | Exceeded `--timeout` (default 900s) | Session already aborted server-side; partial diff retained — may still be salvageable |

The Skill never needs to know the internal pipeline. It only needs:
1. The agreed exit-code table above.
2. The 7-line report format on stdout.
3. The Bash invocation shape.

## Report format

```
status:   <done|error|aborted-perm|timeout>
session:  <SESSION_DIR>                  # .claude/oc-sessions/<uuid> or /tmp fallback
oc_sid:   <OC_SID or "(none)">
files:    +<add> -<del> (<n> files)
diff:     <SESSION_DIR>/diff.patch
done:     <code> <reason>                 # from SSE watcher (0=idle / 2=error / empty=timeout)
notes:    <one-line>
```

Surface this to the caller (user or invoking plugin) verbatim. Do not paraphrase fields — downstream parsers depend on the format.

## Spec template (general code work)

```
TASK_TYPE: implement | refactor | summarize | doc | research | compose | analyze
TASK: <one-line summary>

FILES TO TOUCH:
- <absolute path 1> (create / modify)
- <absolute path 2> (modify)

BEHAVIOR:
- <bullet 1>
- <bullet 2>

CONVENTIONS:
- <project rules>

ACCEPTANCE TEST:
- $ <command that verifies success>
```

Notes:
- **No `WORKING_DIRECTORY:` header.** `--dir` argument supplies it via the `x-opencode-directory` HTTP header.
- **OpenCode auto-loads `AGENTS.md`** from the OC_DIR (and parent dirs via `findUp`). Project conventions documented there are picked up automatically — don't duplicate them in the spec.

## Spec variants for knowledge work

### `research` — external information gathering

```
TASK_TYPE: research
TOPIC: <one-line>

KEY QUESTIONS:
- ...

SOURCE GUIDELINES:
- Prefer official docs / 1st-party / recent material

OUTPUT SCHEMA:
- H2 per question, bullets with citations
- Each fact: claim + source URL + retrieval date
- Write raw research to OUTPUT_FILE
OUTPUT_FILE: <absolute path>
```

Call with `--dir /tmp/cc-oc-scratch-<id>` (writable scratch); OC edit permitted inside `--dir`.

### `compose` — render a document from given research

```
TASK_TYPE: compose
INPUT_RESEARCH: <absolute path to raw research markdown>
OUTPUT_FILE: <absolute path>

FRONTMATTER: <YAML schema>
BODY SECTIONS:
- <section 1>
- <section 2>

CONVENTIONS:
- <project rules>
- Do NOT edit files outside OUTPUT_FILE
```

Call with `--dir` = vault root (or wherever OUTPUT_FILE lives).

### `analyze` — read-only document evaluation

```
TASK_TYPE: analyze
INPUTS:
- <path or glob 1>
- <path or glob 2>

EVALUATION:
- <what to extract / compare / validate>

OUTPUT: <where to write the result, or "stdout">
```

OC has read/grep/glob only.

## Knowledge pipeline pattern

When the work bundles research + composition:

1. Caller (CC, in this session) does local lookup, dedup check.
2. Call `delegate-oc` with a `research` spec → raw markdown at OUTPUT_FILE.
3. Caller briefly reviews (sanity, gaps).
4. Call `delegate-oc` with a `compose` spec referencing the raw research → final document.
5. (optional) Call `delegate-oc` with an `analyze` spec → validates final doc against conventions.
6. Caller handles domain post-processing (backlinks, index updates, issue linking).

## Hard constraints

- **Read-only invariant.** Never `Read`, `cat`, `head`, or `tail -n big` on any file under `SESSION_DIR`. Use `grep -c`, `grep -q`, `wc -l`, `tail -c <small N>` if you ever need to peek (you shouldn't — let `oc-result-review` do it). Content review is exclusively the `oc-result-review` skill's job.
- **No subagent dispatch.** v0.6.0+ removed `oc-implementer`. `Agent({subagent_type: "cc-opencode-cmux:oc-implementer", ...})` no longer exists.
- **No fallback to direct execution.** If OC fails, surface the error. The user/caller decides what to do.
- **No re-delegation loops.** One controller invocation per call. To retry with corrections, write a fresh spec and call again — explicitly.
- **No `--dangerously-skip-permissions`.** Watcher auto-denies; main session decides if any `aborted-perm` deserves a re-spec.

## Anti-patterns

- ❌ Vague specs like "implement the feature" — OC has no conversation history.
- ❌ Asking OC architectural decisions.
- ❌ Skipping diff review (`oc-result-review`) on `done` runs.
- ❌ Parallel delegations on overlapping files — sequence them or use isolated `--dir`s.
- ❌ Reading session output files in this skill to "verify" — defeats the entire point of delegation.
- ❌ Splitting the controller into multiple Bash calls in the main session — costs you the tokens we just saved by introducing `oc-delegate.sh`.
