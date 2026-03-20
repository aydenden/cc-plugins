#!/bin/bash
# Stop hook: 미커밋 변경사항이 있으면 세션 종료 차단
set -euo pipefail

# 메인 세션이면 통과 — worktree 에이전트에서만 동작
if [ -z "${HOOK_AGENT_ID:-}" ]; then
  exit 0
fi

# git repo가 아니면 통과
if ! git rev-parse --git-dir &>/dev/null; then
  exit 0
fi

# main/master에서는 commit-guard 불필요 (main-guard가 수정 자체를 막으므로)
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
  exit 0
fi

# 미커밋 변경사항 확인
CHANGES=$(git status --porcelain 2>/dev/null || true)
if [ -n "$CHANGES" ]; then
  CHANGE_COUNT=$(echo "$CHANGES" | wc -l | tr -d ' ')
  echo "미커밋 변경사항이 ${CHANGE_COUNT}개 있습니다. 커밋 후 종료해주세요." >&2
  echo "" >&2
  echo "변경된 파일:" >&2
  echo "$CHANGES" | head -20 >&2
  if [ "$CHANGE_COUNT" -gt 20 ]; then
    echo "... 외 $((CHANGE_COUNT - 20))개" >&2
  fi
  exit 1
fi

# 미푸시 커밋 확인
UNPUSHED=$(git log --oneline @{upstream}..HEAD 2>/dev/null || true)
if [ -n "$UNPUSHED" ]; then
  UNPUSHED_COUNT=$(echo "$UNPUSHED" | wc -l | tr -d ' ')
  # 미푸시는 경고만 (차단하지 않음)
  echo "WARNING: 미푸시 커밋이 ${UNPUSHED_COUNT}개 있습니다. git push를 고려해주세요."
fi

exit 0
