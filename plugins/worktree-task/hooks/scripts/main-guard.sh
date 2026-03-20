#!/bin/bash
# PreToolUse hook: 보호 브랜치에서 Edit/Write 차단
# .claude/worktree-task.local.md에 protected-branches가 설정된 프로젝트에서만 활성화
set -euo pipefail

# 메인 세션이면 통과 — worktree 에이전트에서만 보호
if [ -z "${HOOK_AGENT_ID:-}" ]; then
  exit 0
fi

# 프로젝트별 설정 파일 확인 — 없으면 즉시 통과
LOCAL_CONFIG="${CLAUDE_PROJECT_DIR:-.}/.claude/worktree-task.local.md"
if [ ! -f "$LOCAL_CONFIG" ]; then
  exit 0
fi

# YAML frontmatter에서 protected-branches 파싱
PROTECTED_BRANCHES=$(sed -n '/^---$/,/^---$/p' "$LOCAL_CONFIG" \
  | grep -A 100 'protected-branches:' \
  | grep '^\s*-\s*' \
  | sed 's/^\s*-\s*//' \
  | tr '\n' ' ' || true)

# protected-branches 목록이 비어있으면 통과
if [ -z "$PROTECTED_BRANCHES" ]; then
  exit 0
fi

# 현재 브랜치
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

# 현재 브랜치가 보호 목록에 있는지 확인
for branch in $PROTECTED_BRANCHES; do
  if [ "$CURRENT_BRANCH" = "$branch" ]; then
    echo "${CURRENT_BRANCH} 브랜치에서는 코드 수정이 불가합니다. /worktree-task:create <name>으로 worktree를 만들어주세요." >&2
    exit 2
  fi
done

exit 0
