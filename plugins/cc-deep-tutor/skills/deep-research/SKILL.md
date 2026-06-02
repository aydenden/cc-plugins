---
name: deep-research
description: 큰 학습 주제를 서브토픽으로 분해 후 병렬 리서치하여 인용 포함 보고서 작성. "리서치", "조사", "research", "정리"에 활성화. cc-opencode-cmux 설치 시 조사/압축/종합을 OpenCode에 위임(저토큰).
---

# Deep Research

큰 주제를 작은 단위로 쪼개고, 각 조각을 독립 sub-agent에 맡겨 병렬 조사한 뒤, 압축해 합치는 멀티 에이전트 리서치.

## 환경 준비 (시작 시 수행)

```bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:?}"
eval "$("$PLUGIN_ROOT/scripts/resolve-config.sh")"
echo "[deep-research] max_parallel=$CC_DEEP_TUTOR_MAX_PARALLEL_TOPICS" >&2
```

OC 위임은 모든 sub-agent와 compose 단계가 자체적으로 `Skill(cc-opencode-cmux:delegate-oc, ...)`을 호출해 결정한다. delegate-oc가 자체적으로 daemon ensure + 가용성 판단을 처리하므로 본 skill에서 별도 모드 감지를 하지 않는다. delegate-oc가 `status: declined / error / aborted-perm`을 반환하면 각 agent가 cc-only fallback으로 자체 처리.

## 워크플로우

### 1. 분해 — `topic-decomposer` agent
- 입력: `$ARGUMENTS` (주제)
- 출력: 3~7개 서브토픽 + 의존 관계 + 우선순위

### 2. 조사 (병렬) — `topic-researcher` agent N개
- 한 메시지에 여러 Agent 호출 (concurrent)
- 동시 실행 최대 `$CC_DEEP_TUTOR_MAX_PARALLEL_TOPICS`개
- 각 researcher는 내부에서 `Skill(cc-opencode-cmux:delegate-oc, args: <research spec>)`로 위임 — OC가 `materials/**/*.md` 글롭을 grep/glob 검색 + 웹 보충 + 본문 작성까지 전담 (CC는 자료수집 안 함)
- 결과는 파일 경로로 받음 (CC 컨텍스트에 raw 본문 미진입)
- 각 researcher 입력:
  - 서브토픽 + 부모 주제 컨텍스트
  - KB 검색 루트 (`$CC_DEEP_TUTOR_MATERIALS_DIR`, `_wiki/` 제외)
  - 출력 파일 경로 (`/tmp/cc-dt-research/<session>/T<n>.md`)

### 3. 노트 압축 — `note-compressor` agent
- 각 researcher 결과 파일을 30% 분량으로 압축
- agent 내부에서 `Skill(cc-opencode-cmux:delegate-oc, args: <summarize spec>)` 호출
- 결과는 파일 경로로 받음

### 4. 동적 확장
- researcher 출력의 "가지치기 후보" 검토 (CC가 파일 read 후 후보만 추출)
- 추가 조사 필요 시 큐에 추가, 깊이 2단계 제한

### 5. 종합 (compose)
- 출력 위치 결정:
  - 사용자 명시 → 그 경로
  - 명시 없으면 `$CC_DEEP_TUTOR_MATERIALS_DIR/notes/research-<slug>-<date>.md`
- CC orchestrator가 직접 `Skill(cc-opencode-cmux:delegate-oc, ...)`을 호출해 compose 위임:
  - spec에 모든 압축 노트 파일 경로 + 출력 경로 전달
  - OC가 파일들 read → 보고서 작성 → 출력 파일에 Write
  - **CC는 raw/압축본 본문을 컨텍스트에 받지 않음** (토큰 절감 핵심)
- delegate-oc가 declined/error 반환 시: CC가 압축 노트들 read → 보고서 직접 Write

### 6. 자동 인덱싱
- `auto_index_on_write=true`면 hook이 자동 처리
- 비활성 시에도 별도 인덱싱 불필요 — 노트 Write 시 PostToolUse hook이 `_wiki/INDEX.md`를 갱신

## Compose 위임 패턴 (CC orchestrator)

```
Skill(cc-opencode-cmux:delegate-oc, args:
TASK_TYPE: compose
TASK: <ARGUMENTS> 종합 리서치 보고서 작성
WORKING_DIRECTORY: $CC_DEEP_TUTOR_MATERIALS_DIR/notes

FILES TO TOUCH:
- <OUT_PATH> (create)

BEHAVIOR:
- 다음 압축 노트들을 read:
  - /tmp/cc-dt-research/<session>/compressed-T1.md
  - /tmp/cc-dt-research/<session>/compressed-T2.md
  - ...
- 모든 노트의 인용을 보존하면서 종합 보고서를 작성하여 <OUT_PATH>에 Write

OUTPUT STRUCTURE:
- # <주제>
- ## TL;DR (3~5줄)
- ## 도입 (주제 정의와 범위)
- ## <서브토픽 1> ... ## <서브토픽 N> (각 섹션마다 인용)
- ## 종합 / 관계도
- ## 결론
- ## 참고 출처 (KB hash, URL, 파일+페이지 전체 목록)

CONVENTIONS:
- 마크다운 보고서, 한국어
- 모든 사실에 인용 (KB hash, URL, 파일+페이지)
- 출처 없는 단정 금지
- <OUT_PATH> 외 파일 생성/수정 금지

ACCEPTANCE TEST:
- $ test -s <OUT_PATH>
- $ grep -q '참고 출처' <OUT_PATH>
)
```

## 인자

`$ARGUMENTS`: 리서치 주제. 비어 있으면 사용자에게 묻기.

## 사용 예

```
/cc-deep-tutor:deep-research 트랜스포머 attention 메커니즘
/cc-deep-tutor:deep-research Q-learning과 DQN의 차이
```

## 주의
- 모든 인용은 출처 ID 보존 (`kb:<상대경로>#<섹션>`, URL, 파일 경로 + 페이지)
- 한국어 보고서 (default)
- delegate-oc 위임 실패 시 각 단계가 cc-only fallback으로 자체 처리
