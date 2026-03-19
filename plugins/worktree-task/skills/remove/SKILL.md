---
name: remove
description: "Git worktree를 병합하고 정리한다. 미커밋 확인, base 브랜치 병합, worktree 및 브랜치 삭제를 수행한다."
argument-hint: "[worktree-path]"
allowed-tools: ["Bash", "Read", "AskUserQuestion"]
---

# Worktree 제거

worktree를 base 브랜치에 병합하고 정리한다.

## 실행 절차

1. **대상 확인**:
   - 인자로 worktree 경로가 주어지면 해당 경로 사용
   - 없으면 `git worktree list`로 목록을 보여주고 사용자에게 선택 요청
   - main/master worktree는 목록에서 제외

2. **미커밋 확인**:
   ```bash
   cd <worktree-path>
   git status --porcelain
   ```
   - 미커밋 변경사항이 있으면 **즉시 중단**하고 사용자에게 커밋 먼저 하도록 안내

3. **브랜치 정보 수집**:
   ```bash
   git rev-parse --abbrev-ref HEAD   # worktree 브랜치
   ```
   - `worktree-<name>` 형식에서 base 브랜치를 추론하거나, 사용자에게 병합 대상 확인

4. **병합 여부 확인**:
   - 사용자에게 "이 worktree를 <base-branch>에 병합할까요?" 확인
   - 옵션: 병합 후 삭제 / 병합 없이 삭제 / 취소

5. **병합 실행** (선택 시):
   ```bash
   git checkout <base-branch>
   git merge <worktree-branch>
   ```
   - 충돌 발생 시 사용자에게 알리고 수동 해결 안내

6. **정리**:
   ```bash
   git worktree remove <worktree-path> --force
   git branch -d <worktree-branch>
   ```

7. **결과 보고**:
   ```
   Worktree 제거 완료
   - 삭제된 경로: /path/to/worktree
   - 삭제된 브랜치: worktree-<name>
   - 병합 대상: <base-branch>
   ```
