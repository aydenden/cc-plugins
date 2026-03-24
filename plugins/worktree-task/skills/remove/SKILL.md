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

### 6. Protect cwd — CRITICAL

**This MUST be a separate Bash call BEFORE the remove step.**
Claude Code's working directory must be moved to a safe location first.
If you combine `cd` and `git worktree remove` in the same Bash call, only the subprocess changes directory — Claude Code's process cwd stays on the deleted path, crashing the session.

```bash
cd <repo-root>
```

### 7. Authorize removal

Set the `authorized` flag in the marker file so the PreToolUse guard allows the removal.
This MUST be a separate Bash call AFTER step 6.

```bash
jq '.authorized = true' .claude/pending-worktree-cleanup.json > /tmp/wt-marker.json && mv /tmp/wt-marker.json .claude/pending-worktree-cleanup.json
```

If no marker file exists, create one:
```bash
mkdir -p .claude && echo '{"authorized": true}' > .claude/pending-worktree-cleanup.json
```

### 8. Remove worktree and branch

After confirming cwd is safe (step 6) and authorized (step 7), run in a **new** Bash call:

```bash
git worktree remove <worktree-path> --force
git branch -d <worktree-branch>
```

### 9. Clean up marker file

```bash
rm -f .claude/pending-worktree-cleanup.json
```

### 10. Report

```
Worktree removed:
  Path:    <worktree-path>
  Branch:  <worktree-branch>
  Merged:  <base-branch> (or "not merged")
```
