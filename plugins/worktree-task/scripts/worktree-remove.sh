#!/bin/bash
# WorktreeRemove hook script — Agent tool의 isolation: "worktree" 종료 시 자동 실행
# stdin으로 JSON 입력: { "worktree_path": "..." }
set -euo pipefail

log() { echo "[worktree-remove] $*" >&2; }

INPUT=$(cat)
WORKTREE_PATH=$(echo "$INPUT" | jq -r '.worktree_path')

if [ -z "$WORKTREE_PATH" ] || [ ! -d "$WORKTREE_PATH" ]; then
  log "Worktree not found: $WORKTREE_PATH"
  exit 0
fi

# 브랜치명 추출
BRANCH=$(cd "$WORKTREE_PATH" && git rev-parse --abbrev-ref HEAD 2>/dev/null || true)

# worktree 삭제 전 repo root로 이동 (cwd가 worktree 내부에 있을 경우 대비)
REPO_ROOT=$(git -C "$WORKTREE_PATH" rev-parse --path-format=absolute --git-common-dir 2>/dev/null | sed 's|/\.bare$||; s|/\.git$||')
if [ -n "$REPO_ROOT" ] && [ -d "$REPO_ROOT" ]; then
    cd "$REPO_ROOT" 2>/dev/null || true
fi

# git worktree remove
log "Removing worktree: $WORKTREE_PATH"
git worktree remove "$WORKTREE_PATH" --force 2>/dev/null || true

# worktree- 접두사 브랜치만 삭제
if [ -n "$BRANCH" ] && [[ "$BRANCH" == worktree-* ]]; then
  git branch -D "$BRANCH" >&2 2>/dev/null || true
  log "Branch deleted: $BRANCH"
fi

log "Done"
