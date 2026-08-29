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

- **축(커버리지)** — 정의 단계에 "무엇을 정의해야 하는지"의 목록을 두고, 켜진 축 수와 산출물 항목 수를 스크립트가 센다. 축은 스킬이 아니라 스펙 파일의 데이터라서 회고로 자란다.
- **구현 전 프리뷰** — 정의를 정적 HTML로 렌더링해 빈 곳을 눈에 보이게 만든다. 미정의를 그럴듯하게 채우지 않는 것이 규칙이다.

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
  check-coverage.sh     축 수 vs 산출물 항목 수     (차단)
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

**위임 대상 스킬** — 사고 절차는 이쪽에 맡긴다. 없으면 그 판단을 대신할 스킬을 `find-skills`로 조사한다.

```bash
npx skills add mattpocock/skills@grill-with-docs
npx skills add mattpocock/skills@to-prd
npx skills add mattpocock/skills@to-issues
npx skills add mattpocock/skills@implement
npx skills add mattpocock/skills@tdd
npx skills add mattpocock/skills@code-review
npx skills add mattpocock/skills@diagnosing-bugs
npx skills add mattpocock/skills@triage
npx skills add mattpocock/skills@handoff
npx skills add mattpocock/skills@prototype
npx skills add mattpocock/skills@wayfinder
npx skills add mattpocock/skills@domain-modeling
npx skills add mattpocock/skills@research
```

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

## 검증 우회

차단하는 hook에는 우회 경로가 있어야 한다. 없으면 오탐 한 번에 검사 전체가 꺼진다.

```bash
touch .claude/wf-skip-checks    # 의도적 우회. 끝나면 지운다
```
