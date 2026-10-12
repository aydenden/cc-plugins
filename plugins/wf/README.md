# wf — 워크플로우 생성기

작업 흐름을 설명하면 그에 맞는 **워크플로우 플러그인**을 설계한다. 플러그인 구조 생성·검증·테스트는 `plugin-dev:create-plugin`이 이미 소유하므로, 이 플러그인은 그것이 갖지 못한 앞단만 담당하고 결과를 넘긴다.

설계한 검사는 생성된 플러그인의 hook 둘로 걸린다 — 문서를 쓴 직후와 `bd close` 직전. 프로젝트마다 다른 것은 스펙 파일의 데이터이고, 검사 런타임은 node 만 요구한다.

```
wf:design  워크플로우 설명
             → 단계 분해 · 이음매/위임 판정
             → 증거 저장소 결정
             → find-skills 조사 → 필수/추천/대안/제외 → 협의
             → 정의 단계에 검토 축 + 구현 전 프리뷰
             → 단계별 증거 검사 설계 (hook + script)
             → .claude/<name>.spec.jsonc 스펙 기록
             → create-plugin Phase 4~8 로 인계

wf:retro   워크플로우의 재작업·누락 → 산출물·우회 로그·세션 기록
             → 검사가 실제로 돌았나 → 원인 단계
             → 기계적 위반이면 검사(invariants), 판단이면 축 → 스펙에 추가
             → 축이면 재생성 불필요 (실행 시점에 읽힘)
             → 주기 회고면 매번 「해당 없음」인 축을 은퇴 후보로
             → 단계·위임 스킬·증거 저장소 변경이면
               drift 확인 → 영향 파일 제시 → 컨펌 → 생성물 반영
```

## 왜 축과 프리뷰가 있나

검증은 보통 **만들어진 것**을 검사한다. 그런데 가장 비싼 실패는 **만들어지지 않은 것**이다 — 검토 축이 통째로 빠지면 검토된 축만 완벽하게 통과하고, 누락은 결과물이 나온 뒤에야 드러나 재작업이 된다.

그래서 두 장치를 넣는다.

- **축(커버리지)** — 정의 단계에 "무엇을 정의해야 하는지"의 목록을 두고, 산출물이 축마다 답했는지를 스크립트가 센다. 답하지 않은 축이 있으면 그 티켓은 닫히지 않는다. 축은 스킬이 아니라 스펙 파일의 데이터라서 회고로 자란다.
- **구현 전 프리뷰** — 정의를 정적 HTML로 렌더링해 빈 곳을 눈에 보이게 만든다. 미정의를 그럴듯하게 채우지 않는 것이 규칙이다.

축 하나는 이렇게 생겼다 (`templates/axis-store/frontend.axes.json`의 `style`):

```jsonc
{
  "id": "style",
  "when": "화면에 렌더링되는가",              // 사람이 읽는 조건. 거짓이면 「해당 없음 — 사유」 행을 쓴다
  "ask": "시각 정의의 출처는 — 목업? 디자인 토큰? 기존 컴포넌트 재사용?",
  "closed_when": "치수·색·타이포·radius·간격이 **값마다 출처와 함께** 적혀 있다"
}
```

커버리지 검사는 스펙의 축 하나하나를 정의 문서의 표에서 찾는다. 인정하는 것은 **첫 칸이
축 id 와 정확히 일치하는 행**뿐이고, 판정은 둘이다:

| 판정 | 뜻 | 결과 |
|---|---|---|
| `UNADDRESSED` | 그 축의 행이 없다 — 아무도 안 봤다 | 차단 |
| `INCOMPLETE` | 행은 있는데 뒤 칸이 비었거나, `해당 없음`에 사유가 없다 | 차단 |

행이 있는 것만으로 통과시키지 않는 이유가 두 번째다. 근거 없는 판정은 **검토한 것처럼
읽히지만 검토가 아니고**, 목록을 형식적으로 훑을 때 누락이 정확히 그 모양을 한다.

목록에 있는 축은 이렇게 엄격하게 대조하고, 목록 밖은 검사에 내장된 `unlisted` 행이 매
문서에서 묻는다. 행 판정 규칙과 `unlisted` 의 정의는 `references/axis-patterns.md` 가 소유한다.

## 검사는 언제 도나

생성된 플러그인은 hook 둘로 검사를 건다. 검사 런타임은 node 만 요구한다.

| 시점 | 검사 | 결과 |
|---|---|---|
| 문서를 쓴 직후 (`PostToolUse`) | 인용 — 문서가 인용한 경로가 실재하는가 | 차단 |
| | 부정 — 「찾아봤는데 없었다」 옆에 검색 흔적이 있는가 | 경고 |
| `bd close` 직전 (`PreToolUse`) | 커버리지 · 프리뷰 존재 · 프로젝트 불변식 | 차단 |

닫기 직전의 차단은 `bd close` 가 실행되지 않는 것이고, 편집 직후의 차단은 쓰기를 되돌리지
못한 채 실패 보고를 모델에게 돌려주는 것이다. 프로젝트마다 다른 것 — 축, 인용 해석 규칙,
부정 패턴, 산출물 위치 — 은 전부 `.claude/<name>.spec.jsonc` 의 데이터라서, 생성물이 가진
스크립트 사본은 wf 원본과 바이트 단위로 같다. 정본은 `references/evidence-patterns.md`.

## 구성

```
skills/design/     워크플로우 설계 진입점
skills/retro/      워크플로우의 재작업·누락 → 검사 또는 축
references/
  toolchain.md          고정 의존성 + 겹치는 기능의 채택 결정
  beads-contract.md     bd 실측 제약과 커밋 정책 (사용법은 beads 스킬 소유)
  stage-patterns.md     흔한 단계와 이음매/위임 판정 기준
  axis-patterns.md      축 문법 · 행 판정 규칙 · unlisted · 원격 축 저장소
  preview-patterns.md   정직한 렌더링 · as-is 파일 대조
  evidence-patterns.md  검증 6종 · 두 시점 hook · 인용/부정 규칙 · 우회
  spec-change.md        스펙 변경의 파급 · drift · 손수정 보존
scripts/
  hook-post-edit.mjs    편집 직후 hook — 인용(차단) · 부정(경고)
  hook-pre-close.mjs    bd close 직전 hook — 커버리지 · 프리뷰 · 불변식(차단)
  lib/                  판정(순수 함수)과 파일·git 어댑터. 생성물로 그대로 복사된다
  check-deps.mjs        의존성 유무 + 설치법 (design 0단계)
  axis-sync.mjs         도메인 축 저장소 pull/push (refs/wf/axes)
  design/               위 둘의 판정과 어댑터. 설계 시점 전용 — 생성물로 복사하지 않는다
  test/                 node --test
templates/
  axis-store/                축 저장소 씨앗 (스키마 + frontend·backend-api)
  workflow.spec.jsonc        스펙 형식
  spec-software-dev.spec.jsonc 소프트웨어 개발 기본 스펙
  workflow.notes.md          스펙에 담기지 않는 메모의 자리
  hooks.json                 생성물의 hooks/hooks.json
  PRIME.md                   bd prime 오버라이드 (메모리 정책 반전)
  issue-tracker.md           mattpocock 스킬군에 beads 고정
  triage-labels.md           트리아지 상태 정의
  domain.md                  GLOSSARY.md · ADR 레이아웃
```

## 설치

런타임 감지나 폴백은 없다 — 도구가 없으면 그 사실을 보고하고 멈춘다. 선택지를 열어두면 스킬마다 분기가 생기고, 그 분기를 매 세션 LLM이 다시 해석하면서 동작이 흔들린다.

무엇이 있는지 먼저 확인한다. `wf:design`도 0단계에서 이걸 돌린다.

```bash
node plugins/wf/scripts/check-deps.mjs
```

**필수** — 없으면 생성된 워크플로우가 실행되지 않는다.

```bash
brew install beads                                    # bd
brew install git                                      # 축 저장소가 refs/wf/axes 에 산다
brew install node                                     # 생성된 플러그인의 검사 hook 이 node 로 돈다
/plugin marketplace add anthropics/claude-plugins-official   # → plugin-dev 설치 (create-plugin 인계 대상)
/plugin marketplace add steveyegge/beads                     # → beads 설치 (SessionStart bd prime 훅)
/plugin install long-run@<이 마켓플레이스>                    # 세션 이관·여러 세션 실행 (같은 마켓플레이스에 있다)
```

**조건부** — 없으면 해당 단계를 설계에서 뺀다.

```bash
brew install --cask orca      # 세션 스폰·워크트리
brew install agent-browser    # 웹 검증
```

스킬 레지스트리 조사에 쓰는 `npx` 는 필수인 node 에 딸려 온다.

**조사·조작 스킬** — 설계 4단계의 스킬 조사와 브라우저 검증이 여기 기댄다. 소유자가 다르므로 주의.

```bash
npx skills add vercel-labs/skills@find-skills
npx skills add vercel-labs/agent-browser@agent-browser
```

**위임 대상 스킬** — 사고 절차는 이쪽에 맡긴다. 13개 전부 같은 레지스트리(`mattpocock/skills`)에 있어 한 줄로 끝난다. 없으면 그 판단을 대신할 스킬을 `find-skills`로 조사한다.

```bash
for s in grill-with-docs to-spec to-tickets implement tdd code-review diagnosing-bugs \
         triage handoff prototype wayfinder domain-modeling research; do
  npx skills add "mattpocock/skills@$s"
done
```

<details><summary>어느 판단을 어디에 맡기는가 (정본: <code>references/stage-patterns.md</code>)</summary>

일부는 사용자만 부를 수 있는 스킬이다(정본의 † 표시). 생성된 워크플로우는 그 단계에서 사용자에게 실행을 요청하고 턴을 넘긴다.

| 판단 | 위임 |
|---|---|
| 계획 압박 | `/grill-with-docs` (코드베이스 있음) |
| 스펙 | `/to-spec` |
| 이슈 분해 | `/to-tickets` |
| 구현 | `/implement` · `/tdd` |
| 리뷰 | `/code-review` |
| 버그 진단 | `/diagnosing-bugs` |
| 트리아지 | `/triage` |
| 대형 작업 지도 | `/wayfinder` |
| 리서치 | `/research` |
| 세션 이관 | `long-run:session-handoff` |
| 여러 세션에 걸친 실행 | `long-run:map-run` |
| 설계 질문 | `/prototype` |
| 도메인 용어 | `/domain-modeling` |

기존 스킬을 감싸기만 하는 스킬은 만들지 않는다 — 지시문을 한 겹 늘리고 원본의 품질을
희석한다. "`/tdd`를 실행하라"고만 적힌 스킬은 `/tdd`를 직접 부르는 것보다 나쁘다.

</details>

이 위에 얹히는 것만 `find-skills`로 조사해 사용자와 협의한다.

## 도메인 축 저장소

도메인별 기본 축은 문서가 아니라 데이터다. 저장소의 커스텀 ref `refs/wf/axes`에 도메인당 JSON 하나로 살고, `main`과는 만나지 않는다 — 브랜치도 태그도 아니라 웹 브랜치 목록에 안 뜨고 기본 clone이 안 가져온다.

```bash
node plugins/wf/scripts/axis-sync.mjs init            # 최초 1회 — 씨앗 생성 (push 는 안 함)
node plugins/wf/scripts/axis-sync.mjs pull            # 생성 또는 fast-forward
node plugins/wf/scripts/axis-sync.mjs list            # 도메인 목록
node plugins/wf/scripts/axis-sync.mjs resolve <도메인>  # extends 병합
node plugins/wf/scripts/axis-sync.mjs retired <도메인>  # 뺀 축과 뺀 이유
node plugins/wf/scripts/axis-sync.mjs push "메시지"      # 커밋·발행
```

전체 명령은 `references/axis-patterns.md`. 저장소는 `wf:design` 이 축을 꺼내는 출발점이고, 검사가 읽는 정본은 프로젝트 스펙이다.

로컬 store는 `~/.cache/wf/axis-store` (`WF_AXIS_STORE`로 변경). 플러그인 디렉토리에 두지 않는다 — 설치 캐시는 버전마다 새 디렉토리라 버전업 즉시 고아가 된다. 형식과 운영 규칙은 `references/axis-patterns.md`.

## 테스트

```bash
node --test "plugins/wf/scripts/test/*.test.mjs"
```

판정은 순수 함수이고 파일·git·프로세스는 어댑터 뒤에 있어서, 테스트는 문서 텍스트와 스펙 값을
넣고 판정을 본다. 케이스로 고정한 것: 스펙 리더(주석·후행 쉼표·필수 키·예약 id), 커버리지의
`UNADDRESSED`/`INCOMPLETE` 구분과 첫 칸 일치(표 밖 언급, `state` 대 `state-lifetime`,
`unlisted`), 문서 기준 상대 인용의 통과와 없는 파일의 `MISSING`, 편집한 줄에만 내는 부정 경고,
대상 단위 우회와 로그 기록, 닫기로 읽는 명령의 형태, 그리고 두 hook 진입점에 payload 를 넣었을
때의 종료 코드(축이 빠진 문서의 티켓을 닫으면 exit 2, 스펙이 깨져 있어도 exit 2).
`deps.test.mjs` 는 `HOME` 과 `PATH` 를 임시 디렉터리로 돌려 필수 플러그인과 node 의 유무가 `check-deps.mjs` 의 종료 코드로 갈리는지 보고, `axis-sync.test.mjs` 는 로컬 bare 저장소를 원격 삼아 init → push → 다른 store 의 pull 과 `extends` 병합을 본다.

## 검증 우회

차단하는 hook에는 우회 경로가 있어야 한다. 없으면 오탐 한 번에 검사 전체가 꺼진다.

```bash
echo "style: 목업 미수령, proj-142" >> .claude/wf-skip-checks    # <대상>: <왜>, <티켓>
```

**우회는 대상 단위다** — 그 줄이 이름 붙인 축 id·인용 경로·프리뷰 경로·불변식 이름 하나만 통과시킨다. 이유 없는 우회는 받지 않고, 우회한 사실은 스크립트가 워킹트리 밖 로그에 남긴다. 검사가 꺼지는 지점이 아무 기록도 남기지 않으면 통과한 것과 끈 것이 같은 출력으로 보인다. 부정 검사는 경고라서 우회가 없다. 규칙의 정본은 `references/evidence-patterns.md`.
