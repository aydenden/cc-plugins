# worktree-task

Git worktree 기반 태스크 격리 개발 플러그인 — worktree 생성/제거, main 브랜치 보호, 미커밋 방지 기능 제공

## 스킬

| 스킬 | 설명 |
|------|------|
| `/worktree-task:create` | Git worktree 생성 — 현재 브랜치를 base로 새 worktree를 만들고 프로젝트별 post-create 스크립트 실행 |
| `/worktree-task:list` | 현재 Git worktree 목록과 각 worktree의 상태(브랜치, 미커밋 여부) 표시 |
| `/worktree-task:remove` | Worktree 정리 — 미커밋 확인, 커밋 리뷰, base 브랜치 머지, worktree 및 브랜치 제거 |

## 에이전트

| 에이전트 | 설명 |
|----------|------|
| worktree-task | 격리된 git worktree에서 자율 개발 수행하는 에이전트. `isolation: "worktree"`와 함께 사용 |

## 훅

| 이벤트 | 설명 |
|--------|------|
| PreToolUse (Edit/Write) | main 브랜치 보호 — 보호된 브랜치에서 직접 파일 수정 차단 (서브에이전트 전용) |
| Stop | 미커밋 변경사항 감지 시 경고 (서브에이전트 전용) |
| SubagentStop | 완료된 worktree 정보 출력 및 `/worktree-task:remove` 안내 |
