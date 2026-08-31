---
# 워크플로우 스펙 — .claude/<플러그인명>.local.md 에 둔다
# wf:design 이 협의 결과를 여기 기록하고, 생성된 플러그인이 실행 시점에 읽는다.
# 스킬 본문이 아니라 데이터로 두는 이유: 축과 규약은 재생성 없이 자라야 한다.

workflow: my-workflow
domain: frontend            # frontend | backend | data | migration | ...

# --- 증거 저장소 ---
# 검증 훅이 인용 경로를 어디 기준으로 찾을지 결정한다. 정해지지 않으면 검증이 비결정적이 된다.
evidence_store:
  kind: folder              # folder | beads | custom
  root: docs/issues         # kind=folder 일 때
  naming: "<ticket-id>"     # 티켓 ID로 하위 폴더
  # kind=beads 이면 티켓 필드(notes/design)에 남기고 root/naming 불필요
  # kind=custom 이면 아래 note 에 절차를 서술

# --- 도구 ---
toolchain:
  tracker: bd               # 고정
  thinking: mattpocock      # 고정
  runner: orca              # 세션 스폰이 필요할 때
  browser: agent-browser    # 웹이 관여할 때

skills:
  required:                 # 없으면 워크플로우가 성립하지 않음
    - tdd
    - code-review
  recommended:              # 있으면 품질이 오름
    - diagnosing-bugs
  not_installed:            # 조사됐으나 미설치. 설치 명령을 남긴다
    - id: some-owner/repo@skill
      install: npx skills add some-owner/repo@skill
      why: "..."
  excluded:
    - id: other@skill
      why: "이미 설치된 X와 겹침"

# --- 단계 ---
stages:
  - id: define
    kind: seam              # seam(스킬로 만듦) | delegate(기존 스킬 호출)
    produces: "정의 표 (축 × 정의 × 출처)"
    checks: [coverage, citation]
    axes_ref: define        # 아래 axes 의 키

  - id: preview
    kind: seam
    produces: "정적 HTML 프리뷰 + as-is 파일 대조표"
    checks: [existence, coverage]

  - id: implement
    kind: delegate
    delegate_to: /implement
    checks: [execution]

# --- 축 ---
# 정의·설계 성격의 단계에만 필요하다.
# when 이 비면 항상 켜진다. 안 켜진 축도 산출물에 "해당 없음"으로 남긴다 —
# 판단한 적 없는 것과 판단해서 뺀 것은 다르다.
axes:
  define:
    - id: behavior
      ask: "무엇을 하는가 — 입력, 출력, 상태 전이"
    - id: style
      when: "화면에 렌더링되는가"
      ask: "시각 정의의 출처는 — 목업? 디자인 토큰? 기존 컴포넌트?"
      source_hint: "Figma 프레임, 정적 목업, as-is 스타일 레이어"
      closed_when: "치수·색·타이포가 값마다 출처와 함께 적혀 있다"
      excluded_when: "정본에 이 화면이 없다는 것을 찾아본 뒤 적는다"
      added_by: "<언제 어떤 재작업 때문에 추가됐는지>"
---

# 메모

스펙에 담기지 않는 프로젝트 고유 사정을 여기 쓴다. `evidence_store.kind: custom` 이면 그 절차를 여기 서술한다.

축을 추가할 때는 반드시 `added_by`에 계기를 적는다. 목록이 길어졌을 때 실제 사고에서 나온 축과 그냥 넣어본 축이 구분되지 않으면 전체가 형식적 통과 의례가 된다.
