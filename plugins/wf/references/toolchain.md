# 툴체인 계약

생성되는 워크플로우가 딛는 도구 조합은 **고정**이다. 런타임 감지나 폴백은 없다 — 도구가 없으면 그 사실을 보고하고 멈춘다. 선택지를 열어두면 스킬마다 분기가 생기고, 그 분기를 매 세션 LLM이 다시 해석하면서 동작이 흔들리기 때문이다.

| 계층 | 도구 | 역할 |
|---|---|---|
| 사고 절차 | mattpocock 스킬군 | 무엇을 어떤 순서로 할지 |
| 상태 | beads (`bd`) | 티켓·DAG·ready 계산·게이트 |
| 실행 | orca (`orca`) | 워크트리·터미널·에이전트 스폰 |
| 브라우저 | `agent-browser` | 모든 웹 자동화 |
| 지식 | CC auto-memory | 세션 간 기억 |

## 겹치는 기능의 채택 결정

여러 도구가 같은 일을 할 수 있는 지점이 있다. 매번 고민하지 않도록 미리 정해둔다.

| 겹치는 기능 | 채택 | 이유 |
|---|---|---|
| 워크트리 | `bd worktree` | beads DB를 git common dir로 자동 공유해 워크트리 안에서도 같은 티켓이 보인다. Orca UI 카드가 필요할 때만 `orca worktree` |
| 사람 판단 게이트 | `bd gate` | human/timer/gh:run/gh:pr/bead 5종을 지원하고 DB에 영속한다. `orca gate-*`는 Run이 끝나면 사라진다 |
| 병렬 대상 계산 | `bd ready` | DAG를 풀어 지금 착수 가능한 것만 준다 |
| 워커 실행 | `orca terminal` / `orca orchestration` | beads에 대응물이 없다 |
| 브라우저 | `agent-browser` | orca 내장 브라우저에는 다운로드·인증 볼트·diff·병렬 세션·인젝션 방어가 없다 |
| 영속 메모리 | CC auto-memory | `bd remember`는 쓰지 않는다. `.beads/PRIME.md`가 이 정책을 매 세션 주입한다 |
| ADR·도메인 용어 | `CONTEXT.md` + `docs/adr/` | `bd decision`과 겹치므로 문서 쪽을 SSoT로 둔다 |

## 사고 절차는 위임한다

생성되는 스킬은 이음매만 소유한다. 판단 자체는 이미 존재하는 스킬을 호출한다 — 감싸면 지시문만 한 겹 늘고 원본의 품질이 희석된다.

| 필요한 판단 | 호출할 스킬 |
|---|---|
| 계획 압박·정제 | `/grill-with-docs` (코드베이스 있음) / `/grill-me` |
| PRD 작성 | `/to-prd` |
| 구현 | `/implement`, `/tdd` |
| 리뷰 | `/code-review` |
| 버그 진단 | `/diagnosing-bugs` |
| 트리아지 판정 | `/triage` |
| 대형 작업 지도 | `/wayfinder` |
| 리서치 | `/research`, `llm-wiki:research` |
| 세션 압축 | `/handoff` |

mattpocock 스킬군은 `docs/agents/issue-tracker.md`를 읽어 트래커를 결정한다. 그 파일이 없으면 GitHub Issues를 가정하고 `gh issue create`를 부른다. 생성되는 워크플로우의 부트스트랩 단계가 `${CLAUDE_PLUGIN_ROOT}/templates/issue-tracker.md`를 배치해 beads를 고정해야, 이들을 그냥 호출해도 beads로 흘러간다.
