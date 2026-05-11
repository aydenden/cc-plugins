# Worktree-Isolated Delegation

When the delegation might touch files you are also editing — or when the change is large enough that you want to evaluate it in isolation before merging — use `--worktree`.

## Trigger

User to Opus:

> "Refactor all `getXxxData` callsites to `fetchXxxProfile` across the entire codebase. There are dozens of files."

Mechanical rename across many files = ideal for OpenCode, but you don't want it stomping over your in-progress edits.

## Delegate with isolation

```
/cc-opencode-cmux:delegate "Rename getXxxData → fetchXxxProfile for all symbols and call sites" --worktree
```

## What `worktree-dispatch.sh` does

1. `git worktree add -b oc/refactor-20260511-1430 ../wt-oc-20260511-1430 HEAD`
2. Copies the prompt into the worktree
3. Runs `safe-oc.sh refactor <worktree> <prompt>` in the isolated tree
4. After completion, prints:

```
Worktree changes:
 M src/api/user.ts
 M src/api/order.ts
 M src/api/product.ts
 M tests/api.test.ts
 ...

To review:    git -C ../wt-oc-20260511-1430 diff
To merge:     git -C /path/to/project merge oc/refactor-20260511-1430
To discard:   git worktree remove --force ../wt-oc-20260511-1430 && git branch -D oc/refactor-20260511-1430
```

## Opus review

```
/cc-opencode-cmux:review <session_id>
```

Reads the diff from the worktree, walks file-by-file, flags any suspicious changes (missed callers, wrong type signatures, broken imports).

## Accept or discard

- **Accept**: `git merge oc/refactor-20260511-1430` (or open a PR from the branch)
- **Discard**: run the printed `git worktree remove --force` command
- **Partial accept**: cherry-pick specific commits with `git cherry-pick`

## Why this beats in-place

- Your working tree stays clean while OpenCode runs
- You can keep editing during the delegation (no file lock contention)
- The diff is reviewable as a unit (single branch)
- Rollback is one command
