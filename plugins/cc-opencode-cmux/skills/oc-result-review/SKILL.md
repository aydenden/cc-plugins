---
name: oc-result-review
description: Use when reviewing the diff produced by a /cc-opencode-cmux:delegate call, or whenever the post-oc-run hook has just emitted "OpenCode delegation finished" with a session path. Walks Opus through critique, hallucination detection, and decide accept/reject/re-delegate/manual-fix.
---

# Reviewing OpenCode Output

After OpenCode finishes a delegation, the `post-oc-run.sh` hook surfaces a diff path. This skill structures the review.

## Inputs

- `/tmp/cc-oc-<session>/diff.patch` — full diff against working tree at delegation start
- `/tmp/cc-oc-<session>/diff.stat` — file/line summary
- `/tmp/cc-oc-<session>/oc.ndjson` — raw OpenCode events (tool calls, message updates)
- `/tmp/cc-oc-<session>/status` — done / error / aborted-* / warn-soft-*
- `/tmp/cc-oc-<session>/exit_code`

## Review checklist (run in order)

### 1. Status sanity check

- If `status` is `error` or `aborted-*`: the diff is partial. Decide whether to keep partial work or `git restore .`.
- If `exit_code` is non-zero but `status` is `done`: a wall-clock timeout fired during a long final write. Inspect last events in `oc.ndjson` for what was in flight.

### 2. Scope adherence

- Did OpenCode touch only the files in the spec? Files touched outside the spec are a yellow flag — read each one. Common drift: editing `package.json`, `Cargo.toml`, or shared utility modules without being asked.

### 3. Hallucination scan

OpenCode models invent things. Verify:

- **APIs**: every function call should exist in the imported module. Grep for the symbol if unsure.
- **Library names**: check the import statement against `package.json` / `Cargo.toml` / `requirements.txt`. Hallucinated dependencies are common.
- **Type signatures**: especially for inferred return types or generics. Run `cargo check` or `tsc --noEmit` if the project supports it.
- **String constants**: error messages, log keys, environment variable names. Verify they match existing conventions.

### 4. Test coverage

- Were the acceptance tests in the spec actually run? Check `oc.ndjson` for a `tool.called` event invoking the test command.
- If OpenCode added new code, did it add tests? If not, flag it.
- Did existing tests change? Why? Lower threshold for accepting test edits than implementation edits.

### 5. Convention check

- Variable naming, indentation, import order match the rest of the codebase
- Error handling style consistent (Result vs panic, throw vs callback, etc.)
- No stray `TODO` comments unless the spec asked for them
- No `// removed for compatibility` comments — those rot

### 6. Security scan

- No hardcoded secrets in env files or config
- No `unsafe` blocks added without reason
- No `eval` / `exec` of user-controlled strings
- No new outbound network calls
- File permissions and ownership preserved

## Decision tree

```
status == done && all checks pass
  → ACCEPT: stage and commit, or hand back to user

status == done && 1-2 minor issues
  → MANUAL FIX: patch the small issues directly in this session, then commit

status == done && multiple issues OR scope drift
  → RE-DELEGATE: write a corrective spec listing specific fixes,
    call /cc-opencode-cmux:delegate again

status == aborted-* OR error OR major hallucinations
  → REJECT: git restore the touched paths (or discard worktree),
    rewrite the spec with more constraint, try again with a stronger model
```

## Re-delegation spec template

```
PRIOR DELEGATION: session <id> introduced the following issues:
- <file>:<line> — <what is wrong>
- <file>:<line> — <what is wrong>

REQUIRED FIXES:
- <specific change 1>
- <specific change 2>

DO NOT TOUCH:
- <files outside scope>

ACCEPTANCE: <test command> must pass.
```

## When to escalate to Opus directly

If two re-delegations on the same task produce wrong output, stop delegating and implement in Opus. The cost saved is not worth the iteration overhead.
