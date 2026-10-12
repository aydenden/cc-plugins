# 툴체인 계약

생성되는 워크플로우가 딛는 도구 조합은 **고정**이다. 런타임 감지나 폴백은 없다 — 도구가 없으면 그 사실을 보고하고 멈춘다. 선택지를 열어두면 스킬마다 분기가 생기고, 그 분기를 매 세션 LLM이 다시 해석하면서 동작이 흔들리기 때문이다.

| 계층 | 도구 | 역할 |
|---|---|---|
| 사고 절차 | mattpocock 스킬군 | 무엇을 어떤 순서로 할지 |
| 상태 | beads (`bd`) | 티켓·DAG·ready 계산·게이트 |
| 실행 | orca (`orca`) | 워크트리·터미널·에이전트 스폰 |
| 브라우저 | `agent-browser` | 모든 웹 자동화 |
| 지식 | CC auto-memory | 세션 간 기억 |
| 세션 경계 | `long-run` 플러그인 | 여러 세션에 걸친 실행·세션 이관 |
| 검사 런타임 | `node` | 생성되는 플러그인의 두 hook (`evidence-patterns.md`). 필수 — `check-deps.mjs` 가 본다 |

스펙의 `toolchain` 키(`tracker`·`thinking`·`runner`·`browser`)는 이 조합을 프로젝트에 기록해 두는 자리다. 검사는 이 키를 읽지 않는다.

## 겹치는 기능의 채택 결정

여러 도구가 같은 일을 할 수 있는 지점이 있다. 매번 고민하지 않도록 미리 정해둔다.

| 겹치는 기능 | 채택 | 이유 |
|---|---|---|
| 워크트리 | `bd worktree` | beads DB를 git common dir로 자동 공유해 워크트리 안에서도 같은 티켓이 보인다. Orca UI 카드가 필요할 때만 `orca worktree` |
| 사람 판단 게이트 | `bd gate` | human/timer/gh:run/gh:pr/bead 5종을 지원하고 DB에 영속한다. `orca gate-*`는 Run이 끝나면 사라진다 |
| 병렬 대상 계산 | `bd ready` | DAG를 풀어 지금 착수 가능한 것만 준다 |
| 워커 실행 | `orca terminal` / `orca orchestration` | beads에 대응물이 없다 |
| 브라우저 | `agent-browser` | orca 내장 브라우저에는 다운로드·인증 볼트·diff·병렬 세션·인젝션 방어가 없다 |
| 세션 이관 | `long-run:session-handoff` | 인계 문서의 저장 위치·번호 사슬과 새 탭 기동·제출 증명을 이미 소유한다. 생성되는 플러그인에 같은 이음매 스킬을 또 만들면 인계 규약이 두 벌이 된다. 본문 압축은 그쪽이 `/handoff` 에 위임한다 |
| 여러 세션에 걸친 실행 | `long-run:map-run` | 분해 단계가 낸 이슈 DAG 를 완료조건까지 민다. Stop 가드가 「다음으로 갈까요?」로 서는 것을 막고, 맵을 닫기 전에 완료 조건을 검증시킨다. `/wayfinder` 는 그 앞의 **결정**을 푸는 맵이라 겹치지 않는다 |
| 영속 메모리 | CC auto-memory | `bd remember`는 쓰지 않는다. `.beads/PRIME.md`가 이 정책을 매 세션 주입한다 |
| ADR·도메인 용어 | `GLOSSARY.md` + `docs/adr/` | `bd decision`과 겹치므로 문서 쪽을 SSoT로 둔다 |

## 사고 절차는 위임한다

생성되는 스킬은 이음매만 소유한다. 판단 자체는 이미 존재하는 스킬을 호출한다 — 감싸면 지시문만 한 겹 늘고 원본의 품질이 희석된다.

위임 대상의 정본은 `stage-patterns.md` 의 「위임 대상 후보」 표다. 아래는 그중 툴체인 결정에 닿는 것을 옮긴 것이고, 모델이 부를 수 없는 스킬의 표시(†)도 그쪽에 있다.

| 필요한 판단 | 호출할 스킬 |
|---|---|
| 계획 압박·정제 | `/grill-with-docs` (코드베이스 있음) / `/grill-me` |
| 스펙 작성 | `/to-spec` |
| 구현 | `/implement`, `/tdd` |
| 리뷰 | `/code-review` |
| 버그 진단 | `/diagnosing-bugs` |
| 트리아지 판정 | `/triage` |
| 대형 작업 지도 | `/wayfinder` |
| 리서치 | `/research`. 조사 결과를 볼트에 쌓는 프로젝트면 `llm-wiki:research`(같은 마켓플레이스의 llm-wiki 플러그인 — 고정 의존성이 아니고 `check-deps.mjs` 가 보지 않는다) |
| 세션 이관 | `long-run:session-handoff` (본문 압축은 그쪽이 `/handoff` 에 위임) |
| 여러 세션에 걸친 실행 | `long-run:map-run` |

mattpocock 스킬군은 `docs/agents/issue-tracker.md`를 읽어 트래커를 결정한다. 그 파일이 없으면 GitHub Issues를 가정하고 `gh issue create`를 부른다. 생성되는 워크플로우의 부트스트랩 단계가 `templates/issue-tracker.md`(플러그인 루트 기준)를 배치해 beads를 고정해야, 이들을 그냥 호출해도 beads로 흘러간다.

## 어디서 돌려 봤나

실제로 돌려 본 것은 macOS 하나다. 아래 표의 나머지는 각 도구의 공식 문서를 읽은 것이고(2026-10-12), 그 환경에서 돌려 보지 않았다 — 문서와 실제가 어긋나면 실제를 믿고 이 절을 고친다.

| 무엇 | macOS | Linux | Windows |
|---|---|---|---|
| 두 hook 이 불리고 막는다 | 실측 (Claude Code 2.1.296) | 돌려 보지 않음 | 돌려 보지 않음 |
| `bd` | 실측 | 설치 안내 있음 (`brew install beads`, 설치 스크립트, `npm install -g @beads/bd`) | 설치 안내 있음 (`install.ps1`) |
| `orca` | 실측 | 배포본 있음 (AppImage, AUR `stably-orca-bin`) | 배포본 있음 (`.exe`). CLI 등록 절차는 확인하지 못함 |
| `agent-browser` | 실측 | 바이너리 있음 (`npm install -g agent-browser`) | 바이너리 있음 (x64) |
| `check-deps.mjs` 의 설치 안내 | 맞음 | **맞지 않음** — 안내가 전부 `brew` 다 | **맞지 않음** |

Windows 에서 닫기 게이트에 걸리는 것 (Claude Code 문서 `hooks`, `tools-reference`):

- 셸 명령은 `Bash` 가 아니라 `PowerShell` 도구로도 나간다. Git Bash 가 없으면 `Bash` 도구는 아예 등록되지 않고, 있어도 `PowerShell` 이 주 셸이다. 그래서 닫기 hook 의 매처는 `Bash|PowerShell` 이다 — `Bash` 만 걸면 그 `bd close` 는 hook 을 지나지 않는다. 두 도구 모두 명령을 `tool_input.command` 로 준다.
- 닫기로 읽는 명령의 형태는 bash 꼴로만 고정돼 있다. `bd.exe close <id>` 와 `if (...) { bd close <id> }` 는 닫기로 읽히지 않는다(2026-10-12, 파서에 직접 넣어 봄).
- hook 의 `command` 는 Git Bash 가 없으면 PowerShell 로 실행된다. 명령 안의 플러그인 루트 변수는 Claude Code 가 치환한다. `node "<경로>"` 가 PowerShell 에서 그대로 도는지는 돌려 보지 않았다.
- 편집 hook 에 오는 경로는 `\` 로 구분된다. `scripts/lib/artifact.mjs` 가 payload 의 경로 꼴을 보고 가른다(테스트로 고정).

Linux·macOS·WSL 에서 `PowerShell` 도구는 사용자가 켰을 때만 있다.
