---
name: oc-result-review
description: Use when reviewing the diff produced by a `cc-opencode-cmux:delegate-oc` Skill call, or whenever a delegate-oc report carries a SESSION_DIR path. Walks Opus through critique, hallucination detection, and decides accept / reject / re-delegate / manual-fix. This is the **only** place where the session output files may be Read for content inspection.
---

# oc-result-review

After OpenCode finishes a delegation, the report and the session directory contain everything you need to decide whether to accept the diff, fix small issues yourself, re-delegate with constraints, or reject and try again.

## Inputs

Resolve the session directory from the delegate-oc report (`session:` field). As of v0.6.0 it lives in the project's `.claude/oc-sessions/<uuid>/` (or `/tmp/cc-oc-<uuid>/` on the read-only fallback path). Expected contents:

- `prompt.md` — the spec sent to OpenCode
- `sse.ndjson` — filtered SSE event stream (own-session events only; permission auto-deny log + status transitions)
- `done` — two lines: exit code, then a one-line reason (e.g. `0\nsession idle`)
- `diff.patch` — full `git diff` of the working directory at end of run
- `oc_sid` — the OpenCode session id (for follow-up via `oc-session.sh fork`)
- `watch.stdout` / `watch.stderr` — SSE watcher logs (mostly diagnostic)

Note: as of v0.6.0 there is **no `events.ndjson`** — `opencode run --attach` (which produced it) has been replaced by direct HTTP API calls. All in-flight observability flows through `sse.ndjson`.

If the report says `status: done`, expect `done` line-1 to be `0`. Any other status means the diff is partial — read `done` first.

## Review checklist (run in order)

### 1. Status sanity check

- `status: done` + `done` first line `0` → proceed.
- `status: error` → read `watch.stderr` (small) and `tail -c 1000 sse.ndjson`. Look for `session.error` events. The diff may be partial; decide whether to keep or `git restore .`.
- `status: aborted-perm` → OC asked a permission the watcher auto-denied. Look at the spec — is it implicitly asking OC to write outside `OC_DIR`, run `git push`, or touch a denied tool? Re-spec or reject.
- `status: timeout` → the agent loop ran past `CC_OC_WAIT_TIMEOUT` (default 900s). The session has already been aborted by delegate-oc. The `diff.patch` is a **partial snapshot** at abort time. Decide whether to keep, manually finish, or restore.
- `status: declined` → token budget exceeded before dispatch. Split the work; don't re-delegate the same spec.

### 2. Scope adherence

Did OpenCode touch only the files in the spec? Files outside the spec are a yellow flag — read each one. Common drift: editing `package.json`, `Cargo.toml`, shared utility modules, or unrelated test fixtures without being asked. Grep `diff.patch` for unexpected paths.

### 3. Hallucination scan

OpenCode models invent things. Verify:

- **APIs**: every function call should exist in the imported module. Grep the symbol if unsure.
- **Library names**: check imports against `package.json` / `Cargo.toml` / `requirements.txt`. Hallucinated dependencies are common.
- **Type signatures**: especially inferred return types or generics. Run `cargo check` / `tsc --noEmit` / `mypy` if the project supports it.
- **String constants**: error messages, log keys, env var names. Match existing conventions.
- **File paths**: absolute paths in code should match what actually exists.

### 4. Test coverage

- Did OC actually run the acceptance test from the spec? Grep `sse.ndjson` for tool-call events matching the test command. If absent, the spec's ACCEPTANCE TEST was skipped — run it yourself.
- New code without new tests is a yellow flag.
- Existing tests changed? Why? Lower the bar for accepting test edits than implementation edits.

### 5. Convention check

- Variable naming, indentation, import order match the rest of the codebase.
- Error handling style consistent (Result vs panic, throw vs callback, etc.).
- No stray `TODO` unless the spec asked for them.
- No `// removed for compatibility` comments — those rot.

### 6. Security scan

- No hardcoded secrets in env files or config.
- No `unsafe` blocks added without reason.
- No `eval` / `exec` of user-controlled strings.
- No unexpected outbound network calls.
- File permissions / ownership preserved.

## Decision tree

```
status: done  &&  all checks pass
  → ACCEPT: stage and commit, or hand back to user / caller plugin.

status: done  &&  1-2 minor issues
  → MANUAL FIX: patch the issues directly in this session, then commit.
     (Faster than re-delegating for trivial fixes.)

status: done  &&  multiple issues OR scope drift
  → RE-DELEGATE: write a corrective spec listing specific fixes,
     call `Skill(cc-opencode-cmux:delegate-oc, args)` again.

status: timeout
  → INSPECT the partial diff. If most of the work is done, manually finish
     the rest. Otherwise treat as error and `git restore`.

status: aborted-perm OR error OR major hallucinations
  → REJECT: `git restore` the touched paths (or discard the working tree),
     rewrite the spec with tighter constraints, retry with a stronger model.
```

## Re-delegation spec template

```
PRIOR DELEGATION: session <oc_sid> produced these issues:
- <file>:<line> — <what is wrong>
- <file>:<line> — <what is wrong>

REQUIRED FIXES:
- <specific change 1>
- <specific change 2>

DO NOT TOUCH:
- <files outside scope>

ACCEPTANCE: <test command> must pass.

WORKING_DIRECTORY: <absolute path — same as prior delegation>
```

Pass this as the `args` to a fresh `Skill(cc-opencode-cmux:delegate-oc, ...)` call. Do not re-use the same `oc_sid` unless you specifically want `session.fork` semantics (advanced — see `oc-session.sh fork`).

## When to escalate to Opus directly

If two re-delegations on the same task produce wrong output, **stop delegating**. The cost saved is not worth the iteration overhead. Implement in Opus.

## When called by another plugin's agent

If this skill was invoked via `Skill(cc-opencode-cmux:oc-result-review, args)` from an obsidian-knowledge or cc-deep-tutor agent (knowledge pipeline), return:

- A short verdict line (`accept` / `fix` / `re-delegate` / `reject`)
- The session path (so the caller can reference artifacts)
- A bullet list of specific issues if any

The caller decides what to do (commit, update vault index, file a follow-up). Do not commit on the caller's behalf.
