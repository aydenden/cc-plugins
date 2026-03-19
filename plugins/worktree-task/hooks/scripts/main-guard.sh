#!/bin/bash
# PreToolUse hook: 보호 브랜치에서 Edit/Write 차단
set -euo pipefail

# 현재 브랜치
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

# 기본 보호 브랜치 목록
PROTECTED_BRANCHES="main master production"

# 프로젝트별 설정 파일에서 보호 브랜치 목록 읽기
LOCAL_CONFIG="${CLAUDE_PROJECT_DIR:-.}/.claude/worktree-task.local.md"
if [ -f "$LOCAL_CONFIG" ]; then
  # YAML frontmatter에서 protected-branches 파싱
  CUSTOM_BRANCHES=$(sed -n '/^---$/,/^---$/p' "$LOCAL_CONFIG" \
    | grep -A 100 'protected-branches:' \
    | grep '^\s*-\s*' \
    | sed 's/^\s*-\s*//' \
    | tr '\n' ' ' || true)
  if [ -n "$CUSTOM_BRANCHES" ]; then
    PROTECTED_BRANCHES="$CUSTOM_BRANCHES"
  fi
fi

# 현재 브랜치가 보호 목록에 있는지 확인
for branch in $PROTECTED_BRANCHES; do
  if [ "$CURRENT_BRANCH" = "$branch" ]; then
    echo "${CURRENT_BRANCH} 브랜치에서는 코드 수정이 불가합니다. /worktree-task:create <name>으로 worktree를 만들어주세요." >&2
    exit 2
  fi
done

exit 0
