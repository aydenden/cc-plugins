---
description: Review the diff produced by a recent OpenCode delegation. Reads /tmp/cc-oc-<session>/diff.patch and presents it for Opus review.
argument-hint: "[<session_id>]"
allowed-tools: Bash, Read
---

# /cc-opencode-cmux:review

Inspect and critique an OpenCode delegation's diff.

## Steps

1. **Resolve session id**:
   - If `$1` is provided, use it
   - Otherwise pick the newest `/tmp/cc-oc-*` directory: `ls -td /tmp/cc-oc-* 2>/dev/null | head -1`

2. **Verify session exists**:
   - Check `/tmp/cc-oc-$SESSION/` exists
   - If not, tell user no session found and stop

3. **Show status**:
   - Print: session id, task type (from `oc.ndjson` first event title if available), status file content, exit code

4. **Show diff**:
   - Read `/tmp/cc-oc-$SESSION/diff.patch` if it exists
   - If empty, fall back to `git diff` in the current project
   - For long diffs, summarize: files changed, lines added/removed, then show the patch in full

5. **Critique**:
   - Walk through the changes file by file
   - Check: convention adherence, security issues, test coverage, breaking changes, backwards compatibility risks
   - Flag anything that looks like the OpenCode model hallucinating an API or using a library incorrectly

6. **Recommend next action**:
   - **Accept**: changes look correct → suggest commit
   - **Reject**: changes are wrong → suggest `git restore .` or worktree discard
   - **Re-delegate**: changes are partial → suggest `/cc-opencode-cmux:delegate "<refined spec>"` with specific fixes
   - **Manual fix**: small touch-up → do it directly in this Opus session

## Notes

- The diff includes only changes against the working tree at delegation time. If the user has made other changes since, isolate the OpenCode portion using `oc.ndjson` for the list of files touched.
