---
name: oc-result-review
description: Use when reviewing the diff produced by a `cc-opencode-cmux:oc-implementer` Agent call (delegated via the `delegate-oc` skill), or whenever the `post-oc-run.sh` hook emits "OpenCode delegation finished" with a session path. Walks Opus through critique, hallucination detection, and decide accept / reject / re-delegate / manual-fix.
---

# oc-result-review

After OpenCode finishes a delegation, the agent report and the session directory contain everything you need to decide whether to accept the diff, fix small issues yourself, re-delegate with constraints, or reject and try again.

## Inputs

Resolve the session directory from the agent report (`session:` field): `/tmp/cc-oc-<session>/`. Expected contents:

- `prompt.md` — the spec sent to OpenCode
- `events.ndjson` — raw OpenCode CLI event stream (text deltas, tool calls, status, errors)
- `events.ndjson.err` — opencode CLI stderr (empty on clean runs)
- `sse.ndjson` — filtered SSE side-channel (own-session events only; auto-deny log)
- `done` — two lines: exit code, then a one-line reason (e.g. `0\nsession idle`)
- `diff.patch` — full `git diff` of the working directory at end of run
- `oc_sid` — the OpenCode session id (for `session.fork` or `session-cont` patterns)
- `watch.stdout` / `watch.stderr` — SSE watcher logs (mostly diagnostic)

The agent report also has a `server:` line carrying the last server-side status token observed (`idle`, `running`, `error`, …). Use it together with the `status:` line for sanity checking.

If the agent report says `status: done`, expect `done` line-1 to be `0`. Any other status means the diff is partial — read `done` first.

## Review checklist (run in order)

### 1. Status sanity check

- `status: done` + `done` first line `0` + `server: idle|completed` → proceed.
- `status: error` → read `events.ndjson.err` and the last 20 lines of `events.ndjson`. The diff may be partial; decide whether to keep or `git restore .`.
- `status: aborted-perm` → OC asked a permission the watcher auto-denied. Look at the spec — is it implicitly asking OC to write outside `--dir`, run `git push`, or touch a denied tool? Re-spec or reject.
- `status: running-after-detach` → opencode CLI returned but the server-side session was still active after the agent's ~6s grace polling. The `diff.patch` is a **partial snapshot** at detach time. Options:
  1. Re-poll: `${PLUGIN}/bin/oc-session.sh status <oc_sid>`. If now idle, re-capture `git diff` and proceed with the normal checklist.
  2. Wait and re-capture if the task was nearly done.
  3. Abort the runaway session: `${PLUGIN}/bin/oc-session.sh abort <oc_sid>` — then treat the partial diff as an `error` case.
  Common cause: opencode v1.15.x dropping `--attach` on a step boundary. Not a model failure.
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

- Did OC actually run the acceptance test from the spec? Grep `events.ndjson` for a `session.next.tool.called` event with the test command. If absent, the spec's ACCEPTANCE TEST was skipped — run it yourself.
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
     call `Skill(cc-opencode-cmux:delegate-oc, args)` or
     `Agent({subagent_type:"cc-opencode-cmux:oc-implementer"})` again.

status: running-after-detach
  → INSPECT first: re-poll `oc-session.sh status` once, re-capture diff if now idle.
     If still running and not progressing → `oc-session.sh abort`, then treat as error.

status: aborted-* OR error OR major hallucinations
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

Pass this as the `prompt` to a fresh Agent call. Do not re-use the same `oc_sid` unless you specifically want `session.fork` semantics (advanced — see `oc-session.sh fork`).

## When to escalate to Opus directly

If two re-delegations on the same task produce wrong output, **stop delegating**. The cost saved is not worth the iteration overhead. Implement in Opus.

## When called by another plugin's agent

If this skill was invoked via `Skill(cc-opencode-cmux:oc-result-review, args)` from an obsidian-knowledge or cc-deep-tutor agent (knowledge pipeline), return:

- A short verdict line (`accept` / `fix` / `re-delegate` / `reject`)
- The session path (so the caller can reference artifacts)
- A bullet list of specific issues if any

The caller decides what to do (commit, update vault index, file a follow-up). Do not commit on the caller's behalf.
