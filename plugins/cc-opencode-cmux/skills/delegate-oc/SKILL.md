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

## How to delegate

1. Write a complete, self-contained spec for OpenCode. Include:
   - The exact files to touch (or to create)
   - The behavior or output format expected
   - Any conventions to follow (variable naming, import order, error handling style)
   - The acceptance test (which command verifies success — `npm test`, `cargo check`, etc.)

2. Invoke `/cc-opencode-cmux:delegate "<spec>"`. The plugin auto-classifies the task and selects the right model/permission profile. Override with `--type` if classification looks wrong.

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

## Anti-patterns

- ❌ Passing a vague spec like "implement the feature" — OpenCode has no conversation history.
- ❌ Asking OpenCode to make architectural decisions — it will pick something arbitrary.
- ❌ Skipping the diff review — small wrong details accumulate into a broken codebase.
- ❌ Running delegations in parallel that touch the same files — use `--worktree` or sequence them.
