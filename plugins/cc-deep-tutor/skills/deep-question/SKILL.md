---
name: deep-question
description: KB 자료에서 소크라테스식 문제 출제와 후속 질문. "퀴즈", "문제 내줘", "테스트", "복습"에 활성화. cc-opencode-cmux 설치 시 출제를 OpenCode에 위임.
---

# Deep Question

KB(마크다운 위키) 자료를 기반으로 출제 → 학습자 답변 → 소크라테스식 후속 질문.

## 환경 준비

```bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:?}"
eval "$("$PLUGIN_ROOT/scripts/resolve-config.sh")"
```

출제(`question-generator`) sub-agent는 내부에서 `Skill(cc-opencode-cmux:delegate-oc, ...)`로 위임한다. delegate-oc가 가용성 판단·daemon ensure를 담당하므로 본 skill은 모드 감지 없이 진행한다.

## 워크플로우

### 1. 토픽·자료 수집 (CC 직접, kb-search 규칙)
- `$ARGUMENTS`가 토픽이면 `Grep "summary:"`/`Grep "tags:"` 에 키워드 + `Glob` 파일명 (대상 `$CC_DEEP_TUTOR_MATERIALS_DIR/**/*.md`, `_wiki/` 제외)으로 후보 노트 경로 수집
- miss 시 `_wiki/INDEX.md` 로드 후 관련 id 선택
- 후보 노트 경로 목록만 확보 (raw 본문은 CC 컨텍스트에 안 올림 — generator/OC가 read)

### 2. 출제 — `question-generator` agent
- 입력: 토픽 + KB 노트 경로 목록(또는 glob) + 문제 수
- generator가 내부에서 delegate-oc Skill 호출 → 결과 JSON을 파일로 받음
- delegate-oc 실패 시 generator가 cc-only fallback으로 직접 Write
- 출력: `/tmp/cc-dt-question/<session>/questions.json`

### 3. 학습자 답변 수집 (CC 직접)
- CC가 questions.json read → 한 문제씩 출제
- 사용자 답 대기 (대화형)
- 답이 오면 평가 (정답/부분정답/오답)

### 4. 소크라테스 follow-up — `socratic-followup` agent
- 매 답변마다 호출 (CC 직접 — 짧은 출력, 대화형)
- 틀렸으면 "어디서 길을 잃었는지" 질문 1개 (정답 직접 X)
- 맞았으면 한 단계 깊은 질문 1개 ("왜?", "반례는?")

### 5. 약점 요약 (세션 종료 시)
- 정답률 + 약한 토픽 식별
- beads task 자동 생성 옵션: `bd create --title="복습: <약점 토픽>" --type=task --priority=2`

## 인자

`$ARGUMENTS`: 출제 토픽. 비어 있으면 최근 학습 토픽 추천 (beads ready + `_wiki/INDEX.md` 최신 항목).

## 사용 예

```
/cc-deep-tutor:deep-question Q-learning
/cc-deep-tutor:deep-question 트랜스포머 self-attention
```

## 주의
- KB에 없는 사실 출제 금지
- 5지선다 금지 (사고 단계 부족)
- 정답 직접 누설 금지 (소크라테스식)
