---
name: remove
description: "Merge and clean up a git worktree. Checks for uncommitted changes, reviews commits, merges to base branch, and safely removes the worktree and branch."
argument-hint: "[worktree-path]"
allowed-tools: ["Bash", "Read", "AskUserQuestion"]
---

# Worktree Remove

Merge a worktree branch into base and clean up.

## Procedure

### 1. Identify target

- If a worktree path argument is provided, use it.
- Otherwise, check for `.claude/pending-worktree-cleanup.json` marker file:
  ```bash
  cat .claude/pending-worktree-cleanup.json 2>/dev/null
  ```
  The marker contains `worktree_path`, `branch`, `base_branch`, `commit_count`, `first_commit`, `last_commit`.
- If neither exists, show `git worktree list` and ask the user to select (exclude main/master).

### 2. Check for uncommitted changes

```bash
cd <worktree-path> && git status --porcelain
```

If there are uncommitted changes, **stop immediately** and tell the user to commit first.

### 3. Review commits

Show the agent's work to the user before deciding:

```bash
git log <base-branch>..<worktree-branch> --oneline
git diff <base-branch>..<worktree-branch> --stat
```

### 4. Ask merge preference

Ask the user:
- **Merge and remove** — merge into base branch, then clean up
- **Remove without merge** — discard the branch and clean up
- **Cancel** — do nothing

### 5. Merge (if selected)

```bash
git checkout <base-branch>
git merge <worktree-branch>
```

If there are conflicts, inform the user and stop for manual resolution.

### 6. Remove worktree and branch

```bash
git worktree remove <worktree-path> --force
git branch -d <worktree-branch>
```

### 7. Clean up marker file

```bash
rm -f .claude/pending-worktree-cleanup.json
```

### 8. Report

```
Worktree removed:
  Path:    <worktree-path>
  Branch:  <worktree-branch>
  Merged:  <base-branch> (or "not merged")
```
