---
# 소프트웨어 개발 기본 스펙 — 새 워크플로우의 출발점
# wf:design 이 "일반적인 개발 워크플로우"로 시작할 때 이걸 복사해 변형한다.
# 그대로 쓰라는 뜻이 아니다. 단계 이름과 개수는 프로젝트마다 달라진다.

workflow: dev
domain: software

evidence_store:
  kind: beads
  # 티켓의 notes/design 필드에 남긴다. 파일이 늘지 않고 티켓이 SSoT가 된다.
  # 스크린샷·영상처럼 파일이 필요한 증거가 있으면 kind: folder 로 바꾼다.

toolchain:
  tracker: bd
  thinking: mattpocock
  runner: orca
  browser: agent-browser

skills:
  required: [tdd, code-review, implement, grill-with-docs, to-prd]
  recommended: [diagnosing-bugs, triage, wayfinder, research, prototype, handoff, domain-modeling]

stages:
  - id: bootstrap
    kind: seam
    produces: "beads 초기화(--skip-agents) · .beads/PRIME.md · docs/agents/ 어댑터 3종"
    checks: [existence]
    note: "templates/PRIME.md, issue-tracker.md, triage-labels.md, domain.md 를 복사한다"

  - id: sources
    kind: seam
    produces: "근거 표 — 확정 / 미정 / 상충, 각각 출처와 시점"
    checks: [citation, negation]
    note: "beads · ADR · CONTEXT.md · git log · 볼트 다섯 곳. 안 찾은 것과 찾았는데 없는 것을 구분한다"

  - id: shape
    kind: delegate
    delegate_to: /grill-with-docs

  - id: spec
    kind: delegate
    delegate_to: /to-prd

  - id: slice
    kind: seam
    produces: "beads 이슈 DAG"
    checks: [existence, invariant]
    note: "수직 슬라이스. acceptance 빈 티켓 0개, bd ready 비어있지 않음"

  - id: start
    kind: seam
    produces: "claim된 티켓 + 실행 환경(bd worktree / orca terminal)"
    checks: [existence]

  - id: implement
    kind: delegate
    delegate_to: /implement
    checks: [execution]

  - id: verify
    kind: seam
    produces: "브라우저 조작 결과 + 증거(스크린샷·영상·시각 diff)"
    checks: [execution, existence]
    note: "웹이 관여하지 않으면 이 단계를 뺀다"

  - id: review
    kind: delegate
    delegate_to: /code-review

  - id: done
    kind: seam
    produces: "게이트 해제 · 이슈 close · 커밋 제안(실행 아님)"
    checks: [execution, invariant]

  - id: handoff
    kind: seam
    produces: "인수인계 티켓 + 새 세션"
    checks: [existence]
    note: "단계가 아니라 어느 지점에서든 부를 수 있는 횡단 관심사"

  - id: intake
    kind: seam
    produces: "외부 유입 → 재현 증거 → 트리아지 상태"
    checks: [existence, citation]

  - id: map
    kind: seam
    produces: "조사 티켓 지도"
    checks: [existence]
    note: "규모 때문에 slice로 바로 못 갈 때 앞에 놓는다"

# 이 기본 스펙에는 축이 없다. 정의 단계가 없기 때문이다.
# 기획서·목업·참조 구현을 근거로 무엇을 만들지 확정하는 단계가 있는 워크플로우는
# define 단계와 axes 를 추가하고, 그 뒤에 preview 단계를 넣는다.
# references/axis-patterns.md, references/preview-patterns.md 참조.
axes: {}
---

# 메모

이 구성은 소프트웨어 구현 작업에 맞춰져 있다. 디자인 리뷰, 데이터 파이프라인, 문서 작업처럼 모양이 다른 워크플로우는 이 단계 목록을 변형하는 것으로는 나오지 않는다 — `wf:design`으로 처음부터 도출한다.

`bootstrap` 단계가 배치하는 어댑터 문서가 없으면 mattpocock 스킬군이 GitHub Issues를 가정한다. 이 스펙에서 가장 먼저 실행되어야 하는 단계다.
