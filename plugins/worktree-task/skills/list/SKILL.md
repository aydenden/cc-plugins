---
name: list
description: "현재 Git worktree 목록과 각 worktree의 상태(브랜치, 미커밋 여부)를 보여준다."
allowed-tools: ["Bash"]
---

# Worktree 목록

현재 프로젝트의 모든 git worktree 목록과 상태를 보여준다.

## 실행 절차

1. **Worktree 목록 조회**:
   ```bash
   git worktree list --porcelain
   ```

2. **각 worktree 상태 확인**:
   각 worktree에 대해:
   ```bash
   cd <worktree-path> && git status --porcelain | wc -l
   ```

3. **테이블 형식으로 출력**:
   ```
   | 경로 | 브랜치 | 미커밋 | 상태 |
   |------|--------|--------|------|
   | /path/main | main | 0 | clean |
   | /path/feature-auth | worktree-feature-auth | 3 | dirty |
   ```
