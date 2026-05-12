---
name: deep-research
description: 큰 학습 주제를 서브토픽으로 분해 후 병렬 리서치하여 인용 포함 보고서 작성. "리서치", "조사", "research", "정리"에 활성화. cc-opencode-cmux 가용 시 조사/압축/종합을 OpenCode에 위임.
---

# Deep Research

큰 주제를 작은 단위로 쪼개고, 각 조각을 독립 sub-agent에 맡겨 병렬 조사한 뒤, 압축해 합치는 멀티 에이전트 리서치.

## 모드 감지 (시작 시 수행)

```bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:?}"
eval "$("$PLUGIN_ROOT/scripts/resolve-config.sh")"
eval "$("$PLUGIN_ROOT/scripts/oc-detect.sh")"
echo "[deep-research] mode=$OC_MODE max_parallel=$CC_DEEP_TUTOR_MAX_PARALLEL_TOPICS" >&2
```

- `OC_MODE=oc` → researcher/compressor/compose 모두 OC 위임
- `OC_MODE=cc-only` → 모두 CC sub-agent로 직접 수행
- `oc_only_compose=true` → 조사는 CC, compose만 OC

## 워크플로우

### 1. 분해 — `topic-decomposer` agent
- 입력: `$ARGUMENTS` (주제)
- 출력: 3-7개 서브토픽 + 의존 관계 + 우선순위

### 2. 조사 (병렬) — `topic-researcher` agent N개
- 한 메시지에 여러 Agent 호출 (concurrent)
- 동시 실행 최대 `$CC_DEEP_TUTOR_MAX_PARALLEL_TOPICS`개
- 각 researcher는 자체 모드 감지 (oc 모드면 OC에 본문 위임)
- 결과는 파일 경로로 받음 (CC 컨텍스트에 raw 본문 미진입)
- 각 researcher 입력:
  - 서브토픽 + 부모 주제 컨텍스트
  - 출력 파일 경로 (`/tmp/cc-dt-research/<session>/T<n>.md`)

### 3. 노트 압축 — `note-compressor` agent
- 각 researcher 결과 파일을 30%로 압축
- oc 모드: OC에 위임 (CC가 raw/압축본 모두 안 봄)
- cc-only: haiku로 직접 압축
- 결과는 파일 경로로 받음

### 4. 동적 확장
- researcher 출력의 "가지치기 후보" 검토 (CC가 파일 read 후 후보만 추출)
- 추가 조사 필요 시 큐에 추가, 깊이 2단계 제한

### 5. 종합 (compose)
- 출력 위치 결정:
  - 사용자 명시 → 그 경로
  - 명시 없으면 `$CC_DEEP_TUTOR_MATERIALS_DIR/notes/research-<slug>-<date>.md`
- oc 모드 또는 `oc_only_compose=true`: OC에 compose 위임
  - spec에 모든 압축 노트 파일 경로 + 출력 경로 전달
  - OC가 파일들 read → 보고서 작성 → 출력 파일에 Write
  - **CC는 raw/압축본 본문을 컨텍스트에 받지 않음** (토큰 절감 핵심)
- cc-only: CC가 압축 노트들 read → 보고서 직접 Write

### 6. 자동 인덱싱
- `auto_index_on_write=true`면 hook이 자동 처리
- 비활성 시 사용자에게 "memsearch 인덱싱할까?" 묻기

## OC compose 위임 패턴

```bash
SESS="cc-dt-compose-$(date +%s)-$$"
SPEC="/tmp/cc-dt-compose/$SESS/spec.md"
mkdir -p "$(dirname "$SPEC")"

cat > "$SPEC" <<EOF
# Research compose spec

## 주제
$ARGUMENTS

## 압축 노트 파일들
$(for f in /tmp/cc-dt-research/$RESEARCH_SESS/compressed-*.md; do echo "- $f"; done)

## 출력 파일
$OUT_PATH

## 작성 지침
- 마크다운 보고서, 한국어
- 서브토픽별 섹션
- 모든 사실에 인용 (KB hash, URL, 파일+페이지)
- 출처 없는 단정 금지
- 도입/결론 포함
EOF

bash "$OC_BIN_DIR/safe-oc.sh" --session "$SESS" --task "compose" --spec "$SPEC"
```

## 인자

`$ARGUMENTS`: 리서치 주제. 비어 있으면 사용자에게 묻기.

## 사용 예

```
/cc-deep-tutor:deep-research 트랜스포머 attention 메커니즘
/cc-deep-tutor:deep-research Q-learning과 DQN의 차이
```

## 주의
- 모든 인용은 출처 ID 보존 (memsearch hash, URL, 파일 경로 + 페이지)
- 한국어 보고서 (default)
- OC 위임 실패 시 cc-only fallback (oc_delegate=always면 에러)
