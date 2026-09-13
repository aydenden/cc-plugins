# wf — 워크플로우 생성기

작업 흐름을 설명하면 그에 맞는 **워크플로우 플러그인**을 설계한다. 플러그인 구조 생성·검증·테스트는 `plugin-dev:create-plugin`이 이미 소유하므로, 이 플러그인은 그것이 갖지 못한 앞단만 담당하고 결과를 넘긴다.

```
wf:design  워크플로우 설명
             → 단계 분해 · 이음매/위임 판정
             → 증거 저장소 결정
             → find-skills 조사 → 필수/추천/대안/제외 → 협의
             → 정의 단계에 검토 축 + 구현 전 프리뷰
             → 단계별 증거 검사 설계 (hook + script)
             → .claude/<name>.local.md 스펙 기록
             → create-plugin Phase 4~8 로 인계

wf:retro   재작업·주기 회고 → 원인 단계 → 빠진 축 → 스펙에 추가
             → 축이면 재생성 불필요 (실행 시점에 읽힘)
             → 단계·위임 스킬·증거 저장소 변경이면
               drift 확인 → 영향 파일 제시 → 컨펌 → 생성물 반영
```

## 왜 축과 프리뷰가 있나

검증은 보통 **만들어진 것**을 검사한다. 그런데 가장 비싼 실패는 **만들어지지 않은 것**이다 — 검토 축이 통째로 빠지면 검토된 축만 완벽하게 통과하고, 누락은 결과물이 나온 뒤에야 드러나 재작업이 된다.

그래서 두 장치를 넣는다.

- **축(커버리지)** — 정의 단계에 "무엇을 정의해야 하는지"의 목록을 두고, 산출물이 축마다 답했는지를 스크립트가 센다. 축은 스킬이 아니라 스펙 파일의 데이터라서 회고로 자란다.
- **구현 전 프리뷰** — 정의를 정적 HTML로 렌더링해 빈 곳을 눈에 보이게 만든다. 미정의를 그럴듯하게 채우지 않는 것이 규칙이다.

축 하나는 이렇게 생겼다 (`templates/axis-store/frontend.axes.json`의 `style`):

```jsonc
{
  "id": "style",
  "when": "화면에 렌더링되는가",              // 이 조건이 참일 때만 축이 켜진다
  "ask": "시각 정의의 출처는 — 목업? 디자인 토큰? 기존 컴포넌트 재사용?",
  "closed_when": "치수·색·타이포·radius·간격이 **값마다 출처와 함께** 적혀 있다"
}
```

`check-coverage.sh <축 목록> <정의 문서>`는 켜진 축 하나하나를 정의 문서에서 찾아
**두 가지를 가른다**:

| 판정 | 뜻 | 결과 |
|---|---|---|
| `UNADDRESSED` | 그 축의 행이 아예 없다 — 아무도 안 봤다 | 차단 |
| `INCOMPLETE` | 행은 있는데 출처 칸이 비었거나, `해당 없음`에 사유가 없다 | 차단 |

행이 있는 것만으로 통과시키지 않는 이유가 두 번째다. 근거 없는 판정은 **검토한 것처럼
읽히지만 검토가 아니고**, 목록을 형식적으로 훑을 때 누락이 정확히 그 모양을 한다.

## 구성

```
skills/design/     워크플로우 설계 진입점
skills/retro/      회고 → 축 추가
references/
  toolchain.md          고정 의존성 + 겹치는 기능의 채택 결정
  beads-contract.md     bd 호출 규약 + 실측 제약 (문서와 어긋나는 항목 포함)
  stage-patterns.md     흔한 단계와 이음매/위임 판정 기준
  axis-patterns.md      축 문법 · 네 출처 · 원격 축 저장소
  preview-patterns.md   정직한 렌더링 · as-is 파일 대조
  evidence-patterns.md  검증 6종 × 단계 성격별 선택
  spec-change.md        스펙 변경의 파급 · drift · 손수정 보존
scripts/
  check-citations.sh    인용 경로 실존 검사        (차단)
  check-coverage.sh     축마다 행 + 그 행의 근거     (차단)
  check-negation.sh     "없음" 주장에 검색 명령 유무 (경고)
  check-deps.sh         의존성 유무 + 설치법 (design 0단계)
  axis-sync.sh          도메인 축 저장소 pull/push (refs/wf/axes)
templates/
  axis-store/                축 저장소 씨앗 (스키마 + frontend·backend-api)
  workflow.local.md          스펙 형식
  spec-software-dev.local.md 소프트웨어 개발 기본 스펙
  PRIME.md                   bd prime 오버라이드 (메모리 정책 반전)
  issue-tracker.md           mattpocock 스킬군에 beads 고정
  triage-labels.md           트리아지 상태 정의
  domain.md                  CONTEXT.md · ADR 레이아웃
```

## 설치

런타임 감지나 폴백은 없다 — 도구가 없으면 그 사실을 보고하고 멈춘다. 선택지를 열어두면 스킬마다 분기가 생기고, 그 분기를 매 세션 LLM이 다시 해석하면서 동작이 흔들린다.

무엇이 있는지 먼저 확인한다. `wf:design`도 0단계에서 이걸 돌린다.

```bash
plugins/wf/scripts/check-deps.sh
```

**필수** — 없으면 생성된 워크플로우가 실행되지 않는다.

```bash
brew install beads                                    # bd
brew install git                                      # 축 저장소가 refs/wf/axes 에 산다
/plugin marketplace add anthropics/claude-plugins-official   # → plugin-dev 설치 (create-plugin 인계 대상)
/plugin marketplace add steveyegge/beads                     # → beads 설치 (SessionStart bd prime 훅)
```

**조건부** — 없으면 해당 단계를 설계에서 뺀다.

```bash
brew install --cask orca      # 세션 스폰·워크트리
brew install agent-browser    # 웹 검증
brew install node             # npx skills — 스킬 레지스트리 조사
brew install jq               # 축 저장소 조회 (axis-sync.sh ids/resolve)
```

**조사·조작 스킬** — 설계 4단계의 스킬 조사와 브라우저 검증이 여기 기댄다. 소유자가 다르므로 주의.

```bash
npx skills add vercel-labs/skills@find-skills
npx skills add vercel-labs/agent-browser@agent-browser
```

**위임 대상 스킬** — 사고 절차는 이쪽에 맡긴다. 13개 전부 같은 레지스트리(`mattpocock/skills`)에 있어 한 줄로 끝난다. 없으면 그 판단을 대신할 스킬을 `find-skills`로 조사한다.

```bash
for s in grill-with-docs to-prd to-issues implement tdd code-review diagnosing-bugs \
         triage handoff prototype wayfinder domain-modeling research; do
  npx skills add "mattpocock/skills@$s"
done
```

<details><summary>어느 판단을 어디에 맡기는가 (정본: <code>references/stage-patterns.md</code>)</summary>

| 판단 | 위임 |
|---|---|
| 계획 압박 | `/grill-with-docs` (코드베이스 있음) |
| PRD | `/to-prd` |
| 이슈 분해 | `/to-issues` |
| 구현 | `/implement` · `/tdd` |
| 리뷰 | `/code-review` |
| 버그 진단 | `/diagnosing-bugs` |
| 트리아지 | `/triage` |
| 대형 작업 지도 | `/wayfinder` |
| 리서치 | `/research` |
| 세션 압축 | `/handoff` |
| 설계 질문 | `/prototype` |
| 도메인 용어 | `/domain-modeling` |

기존 스킬을 감싸기만 하는 스킬은 만들지 않는다 — 지시문을 한 겹 늘리고 원본의 품질을
희석한다. "`/tdd`를 실행하라"고만 적힌 스킬은 `/tdd`를 직접 부르는 것보다 나쁘다.

</details>

이 위에 얹히는 것만 `find-skills`로 조사해 사용자와 협의한다.

## 도메인 축 저장소

도메인별 기본 축은 문서가 아니라 데이터다. 저장소의 커스텀 ref `refs/wf/axes`에 도메인당 JSON 하나로 살고, `main`과는 만나지 않는다 — 브랜치도 태그도 아니라 웹 브랜치 목록에 안 뜨고 기본 clone이 안 가져온다.

```bash
plugins/wf/scripts/axis-sync.sh init            # 최초 1회 — 씨앗 생성 (push 는 안 함)
plugins/wf/scripts/axis-sync.sh pull            # 생성 또는 fast-forward
plugins/wf/scripts/axis-sync.sh list            # 도메인 목록
plugins/wf/scripts/axis-sync.sh resolve <도메인>  # extends 병합
plugins/wf/scripts/axis-sync.sh ids <도메인>      # check-coverage.sh 입력
plugins/wf/scripts/axis-sync.sh push "메시지"      # 커밋·발행
```

로컬 store는 `~/.cache/wf/axis-store` (`WF_AXIS_STORE`로 변경). 플러그인 디렉토리에 두지 않는다 — 설치 캐시는 버전마다 새 디렉토리라 버전업 즉시 고아가 된다. 형식과 운영 규칙은 `references/axis-patterns.md`.

## 테스트

```bash
bash plugins/wf/scripts/check-coverage.test.sh
```

축 판정만 테스트한다 — 두 차단 검사 중 이쪽만 **문서를 해석해서** 판정하기 때문이다
(`check-citations.sh`는 경로의 실존 여부라 해석이 없다). `UNADDRESSED`/`INCOMPLETE` 구분,
`해당 없음`의 사유 유무, 그리고 `state`가 `state-lifetime` 행을 제 것으로 세지 않는
토큰 경계가 케이스로 있다.

## 검증 우회

차단하는 hook에는 우회 경로가 있어야 한다. 없으면 오탐 한 번에 검사 전체가 꺼진다.

```bash
touch .claude/wf-skip-checks    # 의도적 우회. 끝나면 지운다
```
