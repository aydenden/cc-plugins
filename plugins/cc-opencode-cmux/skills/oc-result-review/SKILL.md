---
name: oc-result-review
description: Use when reviewing the diff produced by a `cc-opencode-cmux:delegate-oc` Skill call, or whenever a delegate-oc report carries a SESSION_DIR path. Walks Opus through critique, hallucination detection, and decides accept / reject / re-delegate / manual-fix. This is the **only** place where the session output files may be Read for content inspection.
---

# oc-result-review

After a delegation, decide: **accept / manual-fix / re-delegate / reject**.

## SESSION_DIR contents (the only place you may Read)

```
prompt.md           spec sent to OC
diff.patch          git diff snapshot at completion
sse.ndjson          filtered SSE events for this session (status, permission.asked, …)
done                2 lines: exit code + reason (e.g. "0\nsession idle")
oc_sid              OpenCode session id (for fork/abort)
controller.log      oc-delegate.sh step log
watch.{stdout,stderr}  SSE watcher diagnostics
```

If the report's `status:` is `done`, expect `done` line-1 to be `0`. Anything else → diff is partial; read `done` first.

## Status branch (start here)

| status | First move |
|---|---|
| `done` | Run the checklist below. |
| `error` | `tail -c 1000 sse.ndjson` + `tail watch.stderr` — find the `session.error`. Diff is partial; keep or `git restore`. |
| `aborted-perm` | Spec asked something outside policy (write outside OC_DIR / git push / denied tool). Re-spec with tighter scope or abandon. |
| `timeout` | Session already aborted server-side. Inspect partial diff — if mostly done, finish manually; otherwise restore. |

## Checklist (after `done`)

1. **Scope** — `grep '^diff --git' diff.patch` ⇒ all paths from spec's `FILES TO TOUCH`? Unexpected files (package.json, shared modules) are yellow flags — Read those.
2. **Hallucinations** — APIs/imports/types exist? Grep symbols, run `cargo check` / `tsc --noEmit` / `mypy` if the project supports it. Hallucinated dependencies are common.
3. **Acceptance test** — did OC actually run it? `grep -i '<test cmd>' sse.ndjson`. If absent, run it yourself.
4. **Conventions** — naming, indentation, error handling style match the rest. No stray `TODO` or `// removed for compat`.
5. **Security** — no hardcoded secrets, no new `unsafe` / `eval` without reason, no unexpected outbound calls.

## Decide

```
all checks pass            → ACCEPT (commit / hand back)
1–2 minor issues           → MANUAL FIX in this session (faster than re-delegate)
multiple issues / drift    → RE-DELEGATE with corrective spec (template below)
aborted-perm / error /     → REJECT (git restore, rewrite spec tighter or escalate to Opus)
  major hallucinations
```

If two re-delegations on the same task still fail, **stop delegating and implement in Opus** — iteration overhead exceeds the savings.

## Re-delegation template

```
PRIOR DELEGATION: <oc_sid> produced these issues:
- <file>:<line> — <what's wrong>

REQUIRED FIXES:
- <specific change>

DO NOT TOUCH:
- <files outside scope>

ACCEPTANCE: <test command> must pass.
```

Pass as `args` to a fresh `Skill(cc-opencode-cmux:delegate-oc, ...)` call. Don't reuse `oc_sid` unless you want fork semantics (`oc-session.sh fork`).

## When invoked by another plugin

Return a structured verdict:
- one line: `accept` / `fix` / `re-delegate` / `reject`
- session path (for caller reference)
- bullet list of specific issues (if any)

Don't commit on the caller's behalf — the caller decides.
