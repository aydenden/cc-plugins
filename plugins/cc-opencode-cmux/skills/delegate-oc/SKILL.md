---
name: delegate-oc
description: Use when Claude Code (Opus orchestrator) is about to do repetitive coding work that fits the cc-opencode-cmux delegation policy — multi-file boilerplate implementation, mechanical refactors, code summarization, Korean/Chinese documentation, knowledge research, or document composition. Triggers on user requests like "구현해줘", "리팩터링", "이 파일들 요약", "한국어 문서 만들어줘", "조사해줘", or when Opus detects a task with low reasoning complexity but high token volume. Other plugins (obsidian-knowledge, cc-deep-tutor, pm, ...) call this skill via the Skill tool to delegate their own large-output subtasks.
---

# delegate-oc

Decide whether the current task should be delegated to OpenCode (cheaper model) instead of executed in this Opus session, and if so, dispatch it via the `oc-implementer` subagent (one `Agent` tool call — no Bash, no Write, no inline orchestration).

## When to delegate

Delegate when **all** of these hold:

- The task is mechanical or pattern-following (CRUD scaffolding, boilerplate, renames, simple refactors, docstring writing, file summarization, external research with clear questions, structured document composition from given research).
- The expected output is large (>200 lines or >5 files touched, or several pages of prose).
- The reasoning required is shallow — no architectural decisions, no ambiguous requirements, no cross-cutting concerns.
- The user has not explicitly asked for Opus-quality output.

## When NOT to delegate

- Architecture decisions, API surface design, cross-module coordination.
- User asked to "think hard" or explicitly requested Opus.
- Task small enough to do in this session for fewer tokens than delegation overhead (~5K tokens).
- No clear acceptance criterion — Opus must make judgment calls iteratively.
- Codebase requires understanding subtle conventions not written down.
- **Output exceeds the Write-token budget** (see "Sizing" below). OC has no streaming Write — the session aborts with `step-loop` once Write tokens exceed ~88K. Split the work: CC generates the fixture/binary, then delegates only the code that consumes it.

## Sizing & token budget (estimate BEFORE delegating)

| Output type | Tokens/line | Safe single-delegate LOC | Hard wall |
|---|---|---|---|
| Source code (Rust/Python/TS) | ~50–80 | ≤ 1000 LOC | ~1100 |
| Markdown / Korean doc | ~60–100 | ≤ 800 LOC | ~900 |
| JSONL / CSV fixture | ~150–300 | ≤ 250 LOC | ~300 |
| Parquet / DB seed / binary | n/a | 0 — never delegate | — |

**Rule of thumb**:
- < 30K tokens → safe single delegate.
- 30–70K → still single, but split if natural seams exist.
- > 70K or any binary → **must split**: CC produces the fixture, then delegates only the code that reads it.

## How to delegate

**Exactly one `Agent` tool call.** No Bash. No Write. No `/cc-opencode-cmux:...` slash commands (those are gone — Agent is the sole entry).

```
Agent({
  subagent_type: "cc-opencode-cmux:oc-implementer",
  prompt: "<the spec — see template below>"
})
```

The `oc-implementer` subagent owns the entire pipeline: daemon ensure, session creation, `opencode run --attach --dir` dispatch with the right working directory, cmux split with live progress, SSE permission auto-deny, diff capture, and a structured 8-line report. Your job in this skill is to **decide** and **write the spec**; the subagent handles execution.

The subagent returns the report verbatim. Surface it to the caller (the user or another plugin's agent) without rewriting.

## Spec template (general code work)

```
TASK_TYPE: implement | refactor | summarize | doc | research | compose | analyze
TASK: <one-line summary>
WORKING_DIRECTORY: <absolute path — usually $PWD; for vault writes, the vault root>

FILES TO TOUCH:
- <absolute path 1> (create / modify)
- <absolute path 2> (modify)

BEHAVIOR:
- <bullet 1>
- <bullet 2>

CONVENTIONS:
- <project rules — e.g. "use anyhow::Result for fallible functions">

ACCEPTANCE TEST:
- $ <command that verifies success>
```

`TASK_TYPE` is a hint to the subagent for choosing an appropriate OpenCode agent name. Default falls back to `builder`.

## Spec variants for knowledge work

### `research` — external information gathering

```
TASK_TYPE: research
TOPIC: <one-line>
WORKING_DIRECTORY: /tmp/cc-oc-<id>  (output-only scratch)

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

OC has webfetch/websearch capability via its `research` agent profile. Edit is denied outside scratch.

### `compose` — render a document from given research

```
TASK_TYPE: compose
INPUT_RESEARCH: <absolute path to raw research markdown>
OUTPUT_FILE: <absolute path>
WORKING_DIRECTORY: <vault root or repo>

FRONTMATTER: <YAML schema>
BODY SECTIONS:
- <section 1>
- <section 2>

CONVENTIONS:
- <project rules>
- Do NOT edit files outside OUTPUT_FILE
```

OC has edit allowed inside the working directory; web denied. Writes the file directly.

### `analyze` — read-only document evaluation

```
TASK_TYPE: analyze
INPUTS:
- <path or glob 1>
- <path or glob 2>
WORKING_DIRECTORY: <project_dir>

EVALUATION:
- <what to extract / compare / validate>

OUTPUT: <where to write the result, or "stdout">
```

OC has read/grep/glob only. Edit and web denied.

## Knowledge pipeline pattern

When the work bundles research + composition:

1. Caller (CC, in this session) does local lookup, dedup check.
2. Call `delegate-oc` with `research` spec → raw markdown lands at OUTPUT_FILE.
3. Caller briefly reviews (sanity, gaps).
4. Call `delegate-oc` with `compose` spec referencing the raw research → final document.
5. (optional) Call `delegate-oc` with `analyze` spec → validates final doc against conventions.
6. Caller handles domain post-processing (backlinks, index updates, issue linking).

The caller plugin keeps domain knowledge; `delegate-oc` just delegates safely.

## Result handling

After the Agent call returns:

- `status: done` → diff at the path in the report. If you want a structured review, invoke `Skill(cc-opencode-cmux:oc-result-review, args: "<session>")`.
- `status: error` → surface the `notes:` line. Common causes: daemon ensure failure, OC CLI non-zero exit, network issues.
- `status: aborted-perm` → OC asked for a permission the watcher auto-denied. Reconsider whether the spec is asking for something out of policy.
- `status: declined` → token budget exceeded. Split the work.

**Never silently re-execute the task yourself.** If OC fails, the report says so; the caller decides next steps.

## Anti-patterns

- ❌ Vague specs like "implement the feature" — OC has no conversation history.
- ❌ Asking OC to make architectural decisions — it picks arbitrary.
- ❌ Skipping diff review — small wrong details accumulate.
- ❌ Parallel delegations touching same files — sequence them or use isolated working directories.
- ❌ Leaking caller-plugin domain knowledge into this skill — inline schema in the spec instead.
- ❌ Calling `Bash` to invoke `safe-oc.sh` or other legacy scripts — those are gone. Use the Agent tool.
