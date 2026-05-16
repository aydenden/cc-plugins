---
name: delegate-oc
description: Use when Claude Code (Opus orchestrator) is about to do repetitive coding work that fits the cc-opencode-cmux delegation policy — multi-file boilerplate implementation, mechanical refactors, code summarization, or Korean/Chinese documentation. Triggers on user requests like "구현해줘", "리팩터링", "이 파일들 요약", "한국어 문서 만들어줘", or when Opus detects a task with low reasoning complexity but high token volume.
---

# Delegating to OpenCode

Decide whether the current task should be delegated to OpenCode (cheaper model) instead of executed in this Opus session, and if so, dispatch it via `/cc-opencode-cmux:delegate`.

## When to delegate

Delegate when **all** of these hold:

- The task is mechanical or pattern-following (CRUD scaffolding, boilerplate, renames, simple refactors, docstring writing, file summarization).
- The expected output is large (>200 lines of code or >5 files touched).
- The reasoning required is shallow — no architectural decisions, no ambiguous requirements, no cross-cutting concerns.
- The user has not asked for Opus-quality output explicitly.

## When NOT to delegate

Do **not** delegate when any of these hold:

- The task requires architecture decisions, API surface design, or cross-module coordination.
- The user asked to "think hard" or explicitly requested Opus.
- The task is small enough to do in this session in fewer tokens than the delegation overhead (~5K tokens for setup + diff review).
- There is no clear acceptance criterion — Opus needs to make judgment calls iteratively.
- The codebase requires understanding of subtle conventions that have not been written down.
- **The output exceeds the Write-token budget** (see "Sizing & token budget" below). OC has no streaming Write — every byte goes through the tool call boundary, and the session aborts with `step-loop` once Write tokens climb past ~88K. Large fixtures/binaries (JSONL cassettes, CSV with hundreds of rows, parquet, DB seeds, image/audio assets) are the typical trigger. **Split the work**: CC generates the fixture(s) first, then delegates only the code that consumes them.

## Sizing & token budget (run this estimate BEFORE delegating)

Use this table to estimate whether one delegate can finish without hitting the Write wall. Multiply the expected new+modified LOC by the bytes/line constant for the output type, divide by 4 (rough chars→token ratio), and compare to the budget.

| Output type | Tokens per line (Write tool) | Safe LOC per single delegate | Hard wall |
|---|---|---|---|
| Source code (Rust/Python/TS) | ~50–80 | **≤ 1000 LOC** | ~1100 LOC |
| Markdown / Korean doc | ~60–100 | **≤ 800 LOC** | ~900 LOC |
| JSONL / CSV fixture | ~150–300 | **≤ 250 LOC** | ~300 LOC |
| Parquet / DB seed / binary | n/a (cannot be Written line-by-line) | **0 — never delegate** | — |

Caps come from: empirical step-loop abort threshold ~88K Write tokens (OC v1.14.48), conservative 20% safety margin, observed token-per-line for each format.

**Decision rule**:
- Estimated tokens **< 30K** → safe single delegate, any `--type`.
- Estimated **30–70K** → still single delegate, but use `--worktree` so a partial failure is reviewable; consider splitting across 2 delegates if natural seams exist.
- Estimated **> 70K** or any binary/parquet output → **must split**: CC produces the fixture/binary, then delegate only the code that reads it. Never put the fixture body inside the prompt.

Symptoms that you skipped the estimate: OC stderr shows `Write` totals climbing past 80K, then `aborted (step-loop)` or `aborted (inactivity-Xs)`, and `oc.ndjson` ends mid-line. The `perm-compose.json` policy only allows generator scripts under `/tmp/cc-oc-*/` — useful for one-shot helpers OC writes itself, but not a workaround for the LOC-size problem.

## Splitting work so OC stays within its bandwidth

When a task bundles "generate data + write code that uses the data", do the split in CC, not in OC:

1. CC generates the fixture/seed file(s) (use a one-off python/bash script in the project tree — CC has unrestricted bash).
2. CC commits or stages those files so OC can read them.
3. CC writes the delegation spec referencing the paths: "Read `tests/fixtures/happy.jsonl` and implement…".
4. Delegate `implement` / `compose` / `refactor` for the code only.

## How to delegate

1. Write a complete, self-contained spec for OpenCode. Include:
   - The exact files to touch (or to create)
   - The behavior or output format expected
   - Any conventions to follow (variable naming, import order, error handling style)
   - The acceptance test (which command verifies success — `npm test`, `cargo check`, etc.)

2. Invoke `/cc-opencode-cmux:delegate "<spec>"`. The plugin auto-classifies the task and selects the right model/permission profile. Override with `--type <implement|refactor|summarize|cjk-doc|research|compose|analyze>` if classification looks wrong, and `--model <provider/model>` if you want a specific model (e.g. `--model opencode-go/kimi-k2.6`, `--model opencode-go/deepseek-v4-pro`, or any from `opencode models opencode-go` / `opencode models opencode`). Without `--model`, the agent's default from `~/.config/opencode/opencode.json` is used.

3. Use `--worktree` when OpenCode might touch files you will also edit, or when the task is large enough that you want to review it isolated.

4. Wait for the delegation to complete. The `oc-watch.sh` watcher will abort the session if it hangs (60–180s inactivity depending on task type). The `post-oc-run.sh` hook will surface the diff path.

5. Run `/cc-opencode-cmux:review` to inspect the diff. Reject hallucinated APIs, missing tests, or convention violations.

## Spec template

```
TASK: <one-line summary>

FILES TO TOUCH:
- path/to/file1.rs (create / modify)
- path/to/file2.rs (modify)

BEHAVIOR:
- <bullet 1>
- <bullet 2>

CONVENTIONS:
- <project-specific rules, e.g. "use `anyhow::Result<T>` for all fallible functions">

ACCEPTANCE TEST:
- $ cargo check --package my-crate
- $ cargo test --test integration_smoke
```

## Knowledge tasks (research / compose / analyze)

Beyond code work, three task types exist for knowledge work. These are **domain-agnostic** building blocks that other plugins (obsidian-knowledge, pm, korean-trading, …) compose into their own workflows.

### `research` — external information gathering

Use when you need to gather facts from the web before writing a document.

```
/cc-opencode-cmux:delegate "<research spec>" --type research
```

Spec template:
```
TOPIC: <one-line>

KEY QUESTIONS:
- ...

SOURCE GUIDELINES:
- Prefer official docs / 1st-party sources / 2026+ recent material

OUTPUT SCHEMA:
- H2 per question, bullets with citations
- Each fact: claim + source URL + retrieval date
```

OC has webfetch + websearch allowed, edit denied. Raw research lands in `/tmp/cc-oc-<id>/oc.ndjson` (and captured stdout). CC reviews briefly and feeds it into the next stage.

### `compose` — write a structured document

Use when you have research material and need to render it into a final document.

```
/cc-opencode-cmux:delegate "<compose spec>" --type compose --dir <target_dir>
```

Spec template:
```
INPUT: /path/to/raw_research.md (read this first)

OUTPUT FILE: <target_dir>/<filename>.md

FRONTMATTER: <YAML schema>

BODY SECTIONS:
- <section 1>
- <section 2>

CONVENTIONS:
- <project-specific rules>
- Do NOT edit files outside OUTPUT FILE
```

OC has edit allowed inside `--dir`, web denied. Writes the file directly.

### `analyze` — read-only document analysis

Use when you have existing documents and need a comparison / evaluation / extraction.

```
/cc-opencode-cmux:delegate "<analyze spec>" --type analyze --dir <project_dir>
```

OC has read/grep/glob allowed, edit + web denied. Outputs the result to stdout.

### Knowledge pipeline pattern

Most knowledge workflows combine the three:

1. Domain plugin (CC) does local lookup, dedup check
2. CC writes research spec → delegate `research` → OC produces raw markdown
3. CC reviews briefly (sanity, gaps)
4. CC writes compose spec referencing raw research → delegate `compose` → OC produces final document
5. (optional) CC writes analyze spec → delegate `analyze` → OC validates the final doc against conventions
6. CC handles domain post-processing (backlinks, index updates, beads issue linking)

The caller plugin keeps domain knowledge; cc-opencode-cmux just runs OpenCode safely. See `examples/knowledge-pipeline.md`.

## Anti-patterns

- ❌ Passing a vague spec like "implement the feature" — OpenCode has no conversation history.
- ❌ Asking OpenCode to make architectural decisions — it will pick something arbitrary.
- ❌ Skipping the diff review — small wrong details accumulate into a broken codebase.
- ❌ Running delegations in parallel that touch the same files — use `--worktree` or sequence them.
- ❌ Leaking domain knowledge into this plugin's config — caller plugins inline their schema in the spec instead.
