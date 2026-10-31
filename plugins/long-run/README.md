# long-run

여러 세션에 걸치는 작업을 끝까지 민다. 병렬 웨이브도 지원한다 — base worktree 의 코디네이터가 사용자가 승인한 폭·티켓 목록대로 ready 티켓을 orca 하위 worktree 워커에 나눠 돌린다(`wave.mjs start`). 워커는 bd 를 쓰지 않고, 코디네이터가 결과를 검증한 뒤 base 에 순차 병합·정리한다(`wave.mjs settle`).

![map-run 중 상태줄: 맵 제목 · 밀기 · 막힘 · 질문 · 컨텍스트](../../docs/images/long-run.png)

스킬은 세션 안에서만 살아서 세션 경계를 못 넘는다. 그래서 이 플러그인은 세션이 끝나도 남는 세 가지로 나눴다.

| 역할 | 무엇으로 | 왜 세션을 넘나 |
|---|---|---|
| 목표와 남은 티켓 | bd epic 본문(맵 헌장: 목표·완료 조건·운영 규약) | DB 에 있다. 세션이 죽어도 남는다 |
| 멈춤 막기·질문 게이트 | mod (`hooks/register.mjs`), Stop·PreToolUse·UserPromptSubmit hook (`scripts/frontier-guard.mjs`) | 플러그인에 달려 있어 어느 repo·worktree 에서 연 세션에도 붙는다 |
| 다음 세션으로 넘기기 | `long-run:session-handoff` | 인계 문서 하나로 소유권을 넘긴다 |

## 설치

```bash
/plugin marketplace add aydenden/cc-plugins
/plugin install long-run@aydenden-plugins
```

전제:

- [`bd`](https://github.com/steveyegge/beads) (beads): 맵과 프론티어(지금 밀 수 있는 티켓). PATH 에 있어야 한다
- [`orca`](https://www.onorca.dev/): worktree·터미널. 인계가 새 탭을 띄우는 경로다
- Node.js 18+ (내장 모듈만 쓴다. 런타임 의존성 0)
- 상태줄과 mod 판정은 Claude Code v2.1.287 이상. 그보다 낮으면 Stop hook 만으로 동작한다
- 인계는 이 세션이 Orca 터미널에서 돌고 있을 때 자기 탭을 닫는다(`ORCA_TERMINAL_HANDLE`)
- `handoff` 스킬: 인계 문서 본문 합성을 위임한다. 없으면 `/setup-matt-pocock-skills` 로 설치한다.
  `references/handoff-doc.md` 만으로도 문서는 쓸 수 있지만, 그때는 대화 압축·비밀 삭제 판단이 빠진다
- `wayfinder` 스킬: 선행 계획 맵이 필요할 때만. 없으면 완료 조건을 사용자와 직접 합의한다

`bd`·`orca` 에는 폴백이 없다. 없으면 그 사실을 보고하고 멈춘다.

## 스킬

| 스킬 | 하는 일 |
|---|---|
| `long-run:map-run` | 목표를 bd epic(맵)으로 세우고, 헌장·프론티어를 깔고, 가드를 걸고, 완료 조건을 검증해 맵을 닫을 때까지 민다 |
| `long-run:session-handoff` | 인계 문서 경로를 할당하고, 본문 합성은 `handoff` 스킬에 위임하고, 새 orca 탭에 claude 를 띄워 소유권을 넘긴 뒤 자기 탭을 닫는다 |

## 강제: mod 와 Stop hook

**맵을 선언하지 않은 세션에는 아무 일도 하지 않는다.** 선언한 worktree 안에서도 판정되는 것은
`claim` 을 부른 **주인 세션 하나**다. claim 이 출력한 일회용 토큰 줄이 자기 트랜스크립트에 있는
세션이 다음 Stop 에서 주인으로 적힌다(`lib/claim.mjs`). 같은 worktree 에서 다른 일로 연 세션은
되밀리지 않는다.

선언한 세션에서는 멈춤을 되민 뒤 **도구를 썼으면 다시 되민다.** `stop_hook_active` 는 되민 뒤 도구를 쓰고
다시 멈출 때도 참이라, 그 값만 보고 통과시키면 한 턴에 한 번밖에 못 민다. 되민 뒤 도구 없이 또 멈췄으면
승인 요청이나 보고로 보고 통과시킨다. 가드가 터지면 막는 것이 아니라 조용히 통과시킨다.

| 프론티어 | 되미는 말 | 마커 |
|---|---|---|
| 밀 수 있는 티켓이 있다 | 「곧장 다음 티켓을 claim 하라」. 이 세션이 티켓 2건을 닫았거나 컨텍스트가 창의 50% 를 넘었으면 「이어가지 말고 인계하라」 | 남긴다 |
| 밀 수 있는 것은 없고 질문·막힌 티켓만 남았다 | 「기다리는 질문을 모아 보고하고 멈춰라」. 같은 묶음은 한 번만 | 남긴다. 답이 오면 이어 민다 |
| 비었는데 맵이 열려 있다 | 「서브에이전트 하나로 완료 조건을 검증하고 맵을 닫아라」. 50% 를 넘었으면 그 일을 인계 | 남긴다 |
| 비었고 맵이 닫혔다 | 없음 (통과) | 지운다 |
| 모른다 (bd 를 못 읽었다) | 「status 로 다시 읽어라」. 또 멈추면 통과 | 남긴다 |

**밀 수 있는 티켓**은 `bd ready --parent <맵>` 에 나오거나 이미 claim 된 것 중 `human` 라벨이 없는 것이다.
`human` 라벨 티켓은 사람의 답을 기다리는 **질문**이고, `bd defer` 한 티켓은 자기 칸(`deferred`)에 두며, 나머지
열린 티켓은 **막힌 것**이다. claim 됐어도 열린 맵 자식에 `blocks` 의존이 걸린 티켓은 막힌 것이다. 갈림길에서 맵
전체가 서지 않도록 질문은 티켓으로 남겨 두고, 무엇이 그 답을 기다리는지는 `bd dep add` 로 적는다. 가드가 읽을
수 있는 것은 데이터뿐이다.

## 질문 게이트: 답이 없으면 진행하지 못한다

질문의 범위는 의존이 말한다.

| 질문 | 뜻 | 동작 |
|---|---|---|
| 기다리는 티켓이 적혔다(`dependent_count > 0`) | 뒤로 밀어도 된다 | 그 티켓만 서고 나머지가 앞으로 나온다 |
| 기다리는 티켓이 없다(`dependent_count == 0`) | 무엇이 기다리는지 모른다 | **맵 전체가 선다.** `bd dep add` 로 범위를 적어야 풀린다 |

PreToolUse 훅(`--gate`, 규칙은 `lib/gate.mjs`)이 주인 세션의 호출을 거부한다. 공식 문서상 이 거부는
`bypassPermissions` 에서도 선다.

| 호출 | 거부되는 경우 |
|---|---|
| `bd update <id> --claim`, `--status in_progress` | 대상이 질문이거나 막혔다 (bd 자체는 막힌 티켓도 잡아 준다) |
| `bd ready --claim` | 밀 수 있는 것이 없거나 `--exclude-label human` 이 없다 |
| 질문의 `bd close`·`human respond`·`human dismiss`·`delete`, `human` 라벨 제거, `--status closed` | 항상. 아래 `answer`·`delegate-answer` 로만 닫는다 |
| 막힌 티켓의 `bd close --force` | 항상 |
| 질문에 걸린 `bd dep remove` | 질문 이후 사람의 말이 없다 |
| `Edit`·`Write`·`NotebookEdit`(worktree 안), `git commit`·`git push` | 밀 수 있는 티켓이 없다 (웨이브 정산 중은 제외) |

**사람의 답은 영수증으로 가른다.** bd 는 누가 답했는지 모른다. UserPromptSubmit 훅(`--receipt`)이 사람이 친 말을
worktree 별로 최근 20건 남기고(인계 프롬프트와 시스템 입력은 뺀다), `answer <질문> --quote "<원문>"` 은 그 질문
이후의 말과 맞아야 닫힌다. 부분 인용은 8자 이상이고, 짧은 답(`a`)은 프롬프트 전체와 같아야 한다.
사람이 다른 터미널에서 직접 `bd human respond` 를 치는 길은 그대로다.

**한계.** 실수를 막는 장치이지 샌드박스가 아니다. 셸 스크립트나 `sed -i` 로 고치는 것은 잡지 못하고, 「계속해」를
답으로 인용하는 것도 막지 못한다(인용이 bd 코멘트에 남아 감사할 수 있다). 어떤 질문을 밀어도 되는지의 판단
자체는 에이전트가 하고, 하네스는 그 판단을 `bd dep` 으로 기록하게 할 뿐이다.

## 위임: 사람이 맡기면 헌장의 목표대로 푼다

| 단계 | 명령 | 강제되는 것 |
|---|---|---|
| 켠다 | `delegate --quote "<사람 원문>"` | 영수증에 있는 사람의 말이어야 한다. 맵 코멘트에 `[위임 시작]` 이 남고 재claim 이 물려받는다 |
| 답한다 | `delegate-answer <질문> --choice … --cite "<헌장 원문>" --why …` | `--cite` 가 Destination·완료 조건의 원문이어야 한다. 위임을 켠 뒤 목표 절이 바뀌었으면 거부한다. 근거를 못 대는 질문은 사람 몫으로 남는다 |
| 표시 | 자동 | 질문에 `long-run:delegated` 라벨, 코멘트에 `[위임 답변]`, 상태줄에 `위임 답변 N` |
| 끝낸다 | `delegation-report` | 위임 답변이 있는 맵은 그 전부를 담은 보고서가 있고 close 명령에 그 경로가 실려야 닫힌다 |
| 끈다 | `delegate --off` | 맵 코멘트에 `[위임 종료]` 가 남는다 |

보고서는 `~/.claude/long-run/delegation-reports/<맵>.md` 다. 위임의 근거가 된 사람의 말, 헌장 목표, 대신 고른 것,
결정별 이유와 그 답을 기다린 티켓(되돌리면 다시 봐야 하는 곳)을 담는다.

**인계의 1차 축은 닫은 티켓 수다**(문턱 2건. 티켓 하나가 세션의 40~50%). 컨텍스트 비율은 계측이
실패하면 0% 로 떨어지는데, 그것을 「여유」로 읽어 한 세션이 열 티켓을 닫은 선례가 있다. 그래서 못 잰
컨텍스트는 «계측 불가» 로 따로 말하고 그 값으로 판정하지 않는다. 닫은 수는 이 세션이 claim 한 시각
이후 `closed_at` 된 자식을 bd 에서 센다 — 주인이 첫 Stop 에서 적히기 전, 인계받은 첫 턴부터 센다.

맵을 닫는 자리의 검증은 **지시일 뿐 증명이 아니다.** 가드는 검증하라고 되밀고 맵이 닫혔는지만 본다.
서브에이전트가 실제로 돌았는지, 완료 조건이 참인지는 보지 못한다.

판정은 둘 중 하나가 한다. 규칙은 같다. `scripts/lib/guard-core.mjs` 의 `decide()` 이고, 그 축과 근거는
그 파일 머리말에 있다.

| | mod (`hooks/register.mjs`, CLI 의 `judge` 로 묻는다) | Stop hook (`frontier-guard.mjs --hook`) |
|---|---|---|
| 언제 판정하나 | mod 가 뜬 세션 (Claude Code v2.1.287+) | mod 가 안 뜬 세션: 구버전, 조직 정책, `--safe-mode` |
| 컨텍스트 | 세션이 잰 값 (`$.session.usage()`, 실제 창 크기) | 트랜스크립트 꼬리의 `usage`, 창은 모델 이름의 `[1m]` 으로 추정 |
| 상태줄 | `🧭 [<맵 제목>][<잡은 티켓 제목>] · 밀기 N · 막힘 N · 질문 N · 닫음 n/2 · 컨텍스트 N%/50%`. 제목은 맵 20자·티켓 40자에서 자르고, 제목이 없으면 id, 잡은 티켓이 여럿이면 `+N`. 턴 끝과 `bd update/close/create/reopen` 직후에 갱신. 모르는 값은 `?`, 2건을 닫았거나 50% 를 넘으면 `· 인계할 때`, 다른 세션이 주인이면 `🧭 [<맵 제목>] · 다른 세션이 주인` | 없음 |

mod 는 맵을 미는 세션이 **압축될 때**도 끼어든다. 압축은 막지 않고(창이 넘칠 때 건너뛰면 막다른 길이
된다), 요약 지시와 압축 뒤 대화에 「새 티켓을 잡지 말고 하던 티켓까지만 가서 인계하라」를 남긴다.
압축된 세션은 맵의 운영 규약을 잃기 때문이다. 다른 세션이 주인인 맵이면 아무것도 덧붙이지 않는다.

둘이 같은 멈춤을 두 번 판정하지 않도록, mod 는 판정을 얻은 뒤에만 Stop 이벤트에 `long_run_mod: true` 를 실어
아래로 넘기고 Stop hook 은 그것을 보면 빠진다(`guard-core.mjs` 의 `MOD_FLAG`). 판정을 못 얻으면 표지 없이 넘겨
Stop hook 이 판정한다. 환경변수가 아니라 이벤트에 싣는 이유는
환경변수는 mod 가 꺼진 뒤에도 프로세스에 남아 대비까지 입을 다물게 하기 때문이다.

mod 는 마커 경로와 프론티어를 직접 계산하지 않고 `frontier-guard.mjs status`·`judge` 를 부른다. mod 는
`node:` 모듈을 못 쓰므로 키 계산을 다시 짜면 같은 규칙이 두 벌이 된다. 마커가 없으면 CLI 가 `bd` 를 부르지 않는다.

세션의 cwd 가 옮겨 가도(웨이브 worktree 검증 등) 가드는 이 세션이 주인인 마커를 찾아 판정하고, 맵은 마커의
worktree 에서 읽는다.

## 상태가 사는 곳

작업 저장소가 아니라 홈 아래다. 이 플러그인은 아무 repo 에서나 열린 세션에 붙으므로, 남의 repo 에
파일을 만들지 않는다.

| 무엇 | 기본 위치 | 환경변수 |
|---|---|---|
| 가드 마커·영수증·위임 보고서·닫기 로그 | `~/.claude/long-run/` | `LONG_RUN_STATE_ROOT` |
| 인계 문서 | `~/.claude/handoff/<worktree 키>/<슬러그>/handoff-NN.md` | `HANDOFF_ROOT` |

**키는 worktree 마다 갈린다**(`<basename>-<경로해시8>`). 머신에 하나로 두면 서로 무관한 저장소의
세션까지 같은 맵으로 판정한다. 인계는 같은 worktree 의 새 탭으로 가므로 받는 세션은 같은 키를 읽어
선언을 물려받는다.

## 손으로 부르는 명령

```bash
# 이 세션이 그 맵을 민다고 선언 / 해제 / 지금 판정 보기
node scripts/frontier-guard.mjs claim <epic>
# 코디네이터 맵: 닫은 티켓 수 축을 끈다(재claim 이 물려받는다) / 다시 켠다
node scripts/frontier-guard.mjs claim <epic> --no-ticket-limit
node scripts/frontier-guard.mjs claim <epic> --ticket-limit
node scripts/frontier-guard.mjs clear
node scripts/frontier-guard.mjs status [--session <id>] [트랜스크립트]
# 이 worktree 의 맵 id / 선언을 다른 worktree 로 옮기기(주인은 비운다 — 그곳에서 claim 해야 선다)
node scripts/frontier-guard.mjs epic
node scripts/frontier-guard.mjs move <worktree 경로>
# 워커에게 넘긴 티켓을 적는다(정산 전까지 가드가 보고를 기다리라고 되민다) / 정산한 티켓을 뺀다
node scripts/frontier-guard.mjs wave-begin <runId> <티켓>=<dispatch>[=<worktreeId>]...
node scripts/frontier-guard.mjs wave-settle <티켓>

# 사람의 답으로 질문을 닫는다 / 위임을 켜고 끈다 / 헌장 근거로 대신 답한다 / 위임 보고서를 쓴다
node scripts/frontier-guard.mjs answer <질문> --quote <사람 원문> [--answer <뜻>]
node scripts/frontier-guard.mjs delegate --quote <사람 원문>
node scripts/frontier-guard.mjs delegate --off
node scripts/frontier-guard.mjs delegate-answer <질문> --choice <고른 것> --cite <헌장 원문> --why <이유>
node scripts/frontier-guard.mjs delegation-report [맵]

# 승인받은 티켓마다 base 안에 하위 worktree(wave-<티켓>)를 orca 로 만들어 워커를 띄우고 wave-begin 까지 한다.
# --dry-run 은 orca 를 부르지 않고 승인에 보일 계획 JSON 만 낸다. 시작 전에 orca 명령 스키마를 대조한다
node scripts/wave.mjs start <티켓>... [--run <runId>] [--base-branch <ref>] [--model <id>] [--dry-run]
# 워커 하나의 판정(merge·park·wait·refuse)을 worker-show 영수증·시험 병합으로 낸다. 코디네이터가 그 worktree 에서
# 검증한 뒤 --apply 로 병합·release·worktree rm·wave-settle 을 한다(검증 실패면 --apply --park — worktree 는 남긴다)
node scripts/wave.mjs settle <티켓> [--apply] [--park] [--message <병합 메시지>]

# 인계 문서 경로 할당 → 문서를 쓴 뒤 → 넘기고 빠진다
node scripts/handoff.mjs allocate --slug <슬러그>
node scripts/handoff.mjs send --doc <절대경로> --close-self [--bd <epic>] [--hold]
```

맵을 미는 worktree 에서 보내면 새 세션의 첫 단계가 `claim` 이 되고, 대상 worktree 가 다르면 선언도
따라간다. `--bd` 가 그 맵 밖이면 둘 다 건너뛴다. 같은 worktree 의 남의 맵을 빼앗지 않기 위해서다.

## 위임하는 판단

| 필요한 판단 | 부르는 스킬 | 이 플러그인이 남기는 것 |
|---|---|---|
| 대화를 다음 세션이 읽을 문서로 압축 | `handoff` (mattpocock 스킬군) | 저장 위치·번호 사슬, 절 구성 계약, 탭 기동·제출 증명 |
| 무엇을 만들지 아직 결정에 걸려 있을 때 그 길 찾기 | `wayfinder` (같은 스킬군) | 그 결정을 물려받아 완료조건까지 **실행**하는 맵 |

`handoff` 는 OS 임시 디렉터리에 쓰는 것이 기본이라 **저장 위치는 이 플러그인이 덮어쓴다.** 임시
디렉터리는 청소되고 번호도 안 붙어서 인계 사슬이 남지 않는다.

### wayfinder 와의 경계

`wayfinder` 는 **계획**(판정 티켓을 풀어 길을 찾는다), `map-run` 은 **실행**(완료조건까지 민다)이다.
판정은 하나다. **완료 조건을 관측 가능한 문장으로 지금 쓸 수 있는가.** 못 쓰면 남은 것은 작업이 아니라
결정이므로 `wayfinder` 가 먼저다.

닫힌 wayfinder 맵은 헌장으로 이관된다: Decisions so far → 확정된 결정 / Not yet specified →
아직 규정 못 한 것 · 초기 티켓 / Out of scope → 범위 밖.

**두 맵을 한 맵으로 합치지 않는다.** `wayfinder` 는 「세션당 티켓 하나」·「차팅 후 정지」가 규약이고
이 플러그인의 Stop hook 은 바로 그 정지를 되민다. 라벨도 갈라 둔다(`long-run:map` ↔ `wayfinder:map`).
섞이면 `wayfinder` 의 「Work through the map」이 실행 맵을 집어 1티켓 규약으로 굴린다.

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

- **이미 세운 맵의 헌장은 스스로 바뀌지 않는다.** 헌장은 epic 본문에 복사된 글이라, 템플릿의 운영
  규약이 바뀌어도 열려 있는 맵은 옛 문구를 갖고 있다. 가드가 되미는 문구와 어긋나면 `bd update` 로 고친다
- **맵을 접을 때는 선언을 직접 지운다**(`frontier-guard.mjs clear`). 프론티어가 비어도 맵이 열려 있으면
  마커가 남는다
- **구 orca 호스트에서는 제출을 증명할 수 없다**(`observation: old-host`). 그때는 증명 없이 통과시키고
  수령증에 그 사실을 남긴다. 없는 증거를 만들지 않는다

## 테스트

```bash
node --test "scripts/test/*.test.mjs"
claude plugin validate .
```

순수 로직만 테스트한다. 프론티어 분류·주인·판정(`lib/guard-core.mjs`), 질문 게이트(`lib/gate.mjs`), 영수증·헌장 근거·위임 보고서(`lib/delegation.mjs`), claim 토큰(`lib/claim.mjs`), 헌장과 가드의 문구 일치
(`test/charter-wording.test.mjs`), mod 의 입력 조립과 상태줄 문구(`lib/mod-view.mjs`),
문서 메타 대조와 §0 검사(`lib/doc-meta.mjs`), 인계 프롬프트(`lib/handoff-prompt.mjs`), 경로·키 계산(`lib/handoff-path.mjs`), bd 조회의 동시성과 «모름» 처리(`lib/read-map.mjs` — bd 는 스텁으로
갈아 끼운다). orca·bd 자체의 동작은 실측 대상이라 테스트하지 않는다. `hooks/register.mjs` 는 배선뿐이라 `claude plugin validate` 가 읽어 내는 hooks·calls
목록으로 확인한다.
