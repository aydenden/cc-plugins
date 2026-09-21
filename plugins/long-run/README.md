# long-run

여러 세션에 걸치는 작업을 끝까지 민다.

스킬은 세션 안에서만 살아서 세션 경계를 못 넘는다. 그래서 이 플러그인은 세션 밖의 셋으로 사슬을 굴린다.

| 층 | 무엇 | 왜 세션을 넘나 |
|---|---|---|
| 계약 | bd epic 본문 (맵 헌장) | DB 에 있다. 세션이 죽어도 남는다 |
| 강제 | Stop hook (`scripts/frontier-guard.mjs`) | 플러그인에 달려 있어 어느 repo·worktree 에서 연 세션에도 붙는다 |
| 운반 | `long-run:session-handoff` | 인계 문서 하나로 소유권을 넘긴다 |

## 스킬

| 스킬 | 하는 일 |
|---|---|
| `long-run:map-run` | 목표를 bd epic(맵)으로 세우고, 헌장·프론티어를 깔고, 가드를 걸고, 프론티어가 빌 때까지 민다 |
| `long-run:session-handoff` | 인계 문서 경로를 할당하고, 본문 합성은 `handoff` 스킬에 위임하고, 새 orca 탭에 claude 를 띄워 소유권을 넘긴 뒤 자기 탭을 닫는다 |

### 위임하는 판단

| 필요한 판단 | 부르는 스킬 | 이 플러그인이 남기는 것 |
|---|---|---|
| 대화를 다음 세션이 읽을 문서로 압축 | `handoff` (mattpocock 스킬군) | 저장 위치·번호 사슬, 절 구성 계약, 탭 기동·제출 증명 |
| 무엇을 만들지 아직 결정에 걸려 있을 때 그 길 찾기 | `wayfinder` (같은 스킬군) | 그 결정을 물려받아 완료조건까지 **실행**하는 맵 |

`handoff` 는 OS 임시 디렉터리에 쓰는 것이 기본이라 **저장 위치는 이 플러그인이 덮어쓴다** — 임시
디렉터리는 청소되고 번호도 안 붙어서 인계 사슬이 남지 않는다.

### wayfinder 와의 경계

`wayfinder` 는 **계획**(판정 티켓을 풀어 길을 찾는다), `map-run` 은 **실행**(완료조건까지 민다)이다.
판정은 하나 — **완료 조건을 관측 가능한 문장으로 지금 쓸 수 있는가.** 못 쓰면 남은 것은 작업이 아니라
결정이므로 `wayfinder` 가 먼저다.

닫힌 wayfinder 맵은 헌장으로 이관된다: Decisions so far → 확정된 결정 / Not yet specified →
아직 규정 못 한 것 · 초기 티켓 / Out of scope → 범위 밖.

🚨 **두 맵을 한 맵으로 합치지 않는다.** `wayfinder` 는 「세션당 티켓 하나」·「차팅 후 정지」가 규약이고
이 플러그인의 Stop hook 은 바로 그 정지를 되민다. 라벨도 갈라 둔다(`long-run:map` ↔ `wayfinder:map`) —
섞이면 `wayfinder` 의 「Work through the map」이 실행 맵을 집어 1티켓 규약으로 굴린다.

## 훅

`Stop` 하나. **맵을 선언하지 않은 세션에는 아무 일도 하지 않는다.**

선언한 세션에서는 멈춤 시도마다 **한 번만** 되민다 — 프론티어가 남았으면 「곧장 다음 티켓을 claim
하라」로, 컨텍스트가 창의 50% 를 넘었으면 「이어가지 말고 인계하라」로. 두 번째 멈춤은 무조건
통과시킨다(그러지 않으면 세션이 영영 안 끝난다). 가드가 터지면 막는 것이 아니라 조용히 통과시킨다.

판정 축과 그 근거는 `scripts/lib/guard-core.mjs` 의 머리말에 있다.

## 전제

- `bd` (beads) — 맵과 프론티어. PATH 에 있어야 한다
- `orca` — worktree·터미널. 인계가 새 탭을 띄우는 경로다
- Node.js 18+ (내장 모듈만 쓴다. 런타임 의존성 0)
- 인계는 이 세션이 Orca 터미널에서 돌고 있을 때 자기 탭을 닫는다(`ORCA_TERMINAL_HANDLE`)
- `handoff` 스킬 — 인계 문서 본문 합성을 위임한다. 없으면 `/setup-matt-pocock-skills` 로 설치한다.
  `references/handoff-doc.md` 만으로도 문서는 쓸 수 있지만, 그때는 대화 압축·비밀 삭제 판단이 빠진다
- `wayfinder` 스킬 — 선행 계획 맵이 필요할 때만. 없으면 완료 조건을 사용자와 직접 합의한다

`bd`·`orca` 에는 폴백이 없다. 없으면 그 사실을 보고하고 멈춘다.

## 상태가 사는 곳

작업 저장소가 아니라 홈 아래다 — 이 플러그인은 아무 repo 에서나 열린 세션에 붙으므로, 남의 repo 에
파일을 만들지 않는다.

| 무엇 | 기본 위치 | 환경변수 |
|---|---|---|
| 가드 마커·닫기 로그 | `~/.claude/long-run/` | `LONG_RUN_STATE_ROOT` |
| 인계 문서 | `~/.claude/handoff/<worktree 키>/<슬러그>/handoff-NN.md` | `HANDOFF_ROOT` |

🚨 **키는 worktree 마다 갈린다**(`<basename>-<경로해시8>`). 머신에 하나로 두면 서로 무관한 저장소의
세션까지 같은 맵으로 판정한다. 인계는 같은 worktree 의 새 탭으로 가므로 받는 세션은 같은 키를 읽어
선언을 물려받는다.

## 손으로 부르는 명령

```bash
# 이 세션이 그 맵을 민다고 선언 / 해제 / 지금 판정 보기
node scripts/frontier-guard.mjs claim <epic>
node scripts/frontier-guard.mjs clear
node scripts/frontier-guard.mjs status

# 인계 문서 경로 할당 → 문서를 쓴 뒤 → 넘기고 빠진다
node scripts/handoff.mjs allocate --slug <슬러그>
node scripts/handoff.mjs send --doc <절대경로> --close-self [--bd <epic>]
```

## 테스트

```bash
node --test "scripts/test/*.test.mjs"
```

순수 로직만 테스트한다 — 판정(`lib/guard-core.mjs`), 문서 메타 대조(`lib/doc-meta.mjs`), 경로·키
계산(`lib/handoff-path.mjs`). orca·bd 호출은 실측 대상이라 테스트하지 않는다.

## orca 계약에 기대는 지점

탭 기동과 제출 판정은 화면을 읽지 않는다. orca 가 관측해 주는 것만 쓴다.

| 무엇 | 근거 |
|---|---|
| TUI 가 입력을 받을 상태인가 | `terminal wait --for tui-idle` 의 `wait.satisfied` (출력이 있었다는 사실이 아니다) |
| 프롬프트가 제출됐는가 | `terminal send --wait-submit` 수령증의 단계가 `turn_started` 에 닿았는가 |
| 관측이 가능한 호스트인가 | 같은 수령증의 `prompt.observation === 'supported'` |
| 애매한 전송 실패 복구 | 같은 명령을 `--retry-request <requestId>` 로 재발행 (재전송이 아니다) |

`accepted: true` 는 입력이 받아들여진 것까지고 턴이 시작된 증거가 아니다. 증거가 없으면 exit 6 으로
죽고 **재전송하지 않는다.**

## 알려진 한계

- **`bd` 가 잠깐 죽으면 가드가 마커를 지운다** — `bd list` 실패를 빈 프론티어와 구분하지 못한다.
  세션이 갑자기 안 막히면 `status` 부터 본다
- **같은 worktree 에서 세션 둘을 동시에 굴리면** 둘 다 같은 맵으로 판정된다. 인계가 마커를 지우지
  않는 설계의 대가다
- **구 orca 호스트에서는 제출을 증명할 수 없다**(`observation: old-host`). 그때는 증명 없이 통과시키고
  수령증에 그 사실을 남긴다 — 없는 증거를 만들지 않는다
