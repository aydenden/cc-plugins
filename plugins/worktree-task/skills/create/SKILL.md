---
name: create
description: "Git worktree를 생성한다. 현재 브랜치를 base로 새 worktree를 만들고 프로젝트별 post-create 스크립트를 실행한다."
argument-hint: "<worktree-name>"
allowed-tools: ["Bash", "Read", "Glob"]
---

# Worktree 생성

현재 브랜치를 base로 새 git worktree를 생성한다.

## 실행 절차

1. **인자 확인**: 사용자가 worktree 이름을 제공했는지 확인. 없으면 요청.

2. **현재 상태 파악**:
   ```bash
   git rev-parse --abbrev-ref HEAD        # 현재 브랜치 (= base)
   git rev-parse --git-common-dir         # bare repo 또는 .git 경로
   git worktree list                      # 기존 worktree 목록
   ```

3. **Worktree 경로 결정**:
   - bare repo 구조: `<bare-root>/<worktree-name>`
   - 일반 repo: `../<worktree-name>`
   - 이름 변환: 슬래시를 하이픈으로 (`feature/auth` → `feature-auth`)

4. **중복 확인**: 같은 이름의 worktree가 이미 있으면 경고하고 중단.

5. **Worktree 생성**:
   ```bash
   git worktree add "<path>" -b "worktree-<name>"
   ```
   - 브랜치 이름: `worktree-<name>` 접두사 자동 부여

6. **Post-create 스크립트 실행**:
   - 프로젝트 루트에 `.claude/worktree-task.local.md`가 있으면 YAML frontmatter에서 `post-create` 경로를 읽어 실행
   - 없으면 기본 동작만 수행:
     - `.env` 파일이 있으면 복사
     - `.memsearch/memory` 디렉토리가 있으면 symlink

7. **결과 보고**:
   ```
   Worktree 생성 완료
   - 경로: /path/to/worktree
   - 브랜치: worktree-<name>
   - Base: <current-branch>
   ```

## Post-create 설정 파일 형식

프로젝트의 `.claude/worktree-task.local.md`:
```yaml
---
post-create: .claude/hooks/worktree-post-create.sh
protected-branches:
  - main
  - master
  - production
---
```

post-create 스크립트는 첫 번째 인자로 worktree 경로를, 두 번째 인자로 base 브랜치를 받는다.
