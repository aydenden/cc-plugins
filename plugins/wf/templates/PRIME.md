# Beads Workflow Context

Run `bd prime` after compaction, clear, or a new session to restore this.

## Memory policy — read this first

**Do not use `bd remember`, `bd recall`, or `bd memories`.** Persistent knowledge belongs in Claude Code's auto-memory (the per-project memory directory with `MEMORY.md` as its index), not in the beads database. This overrides beads' default guidance, which recommends the opposite.

The reason: CC auto-memory is one file per fact with frontmatter and a loaded index, so it is greppable, reviewable, and editable outside a session. Beads memories are opaque rows that only surface at prime time and cannot be curated.

Beads owns **work state**. Auto-memory owns **knowledge**. Keep the split clean.

## Task tracking

Use beads for all task tracking. Do not use TodoWrite, TaskCreate, or markdown checklists — they vanish at compaction while beads survives.

Create the issue before writing code, claim it when starting, close it when done.

```bash
bd ready                      # work with no blockers — the only reliable "what's next"
bd show <id>                  # full detail with dependencies
bd update <id> --claim        # claim before starting
bd create --title="..." --description="why this exists and what to do" \
          --type=task|bug|feature --priority=2 --acceptance="..."
bd dep add <issue> <blocker>  # blocker must close first
bd close <id> --suggest-next  # close and reveal newly unblocked work
bd blocked                    # what is stuck and why
```

Priority is `0`-`4` or `P0`-`P4`. Not `high`/`medium`/`low`.

Never run `bd edit` — it opens `$EDITOR` and blocks the session. Use `bd update --title/--description/--notes/--design`.

When handling wisps (ephemeral molecules), add `--include-ephemeral` to `bd ready` and `bd list` or they stay invisible.

## Git policy — conservative

Do not commit, push, or run `bd dolt push` without an explicit instruction. Beads writes auto-commit to the local Dolt database, but nothing reaches a remote until `bd dolt push` runs.

At the end of a unit of work: close the issues, run the relevant quality gates, show `git status`, and **report the commands you would run**. Wait for approval.

## Session close checklist

```
[ ] bd close <id> ...          issues actually finished
[ ] quality gates              tests, linters, build — report failures honestly
[ ] git status                 show what changed
[ ] report, do not commit      propose commands and wait
```

## Workflow skills

The `wf:` plugin owns the seams between beads, orca, and the engineering skills. Reach for them instead of improvising:

`wf:sources` (gather grounding before starting) · `wf:slice` (spec → issue DAG) · `wf:start` (ready → claimed → running) · `wf:verify` (browser E2E with evidence) · `wf:done` (gates → close → report) · `wf:handoff` (hand the session to a fresh agent) · `wf:intake` (external reports → triaged issues) · `wf:map` (oversized work → investigation tickets)
