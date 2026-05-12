---
name: deep-question
description: KB 자료에서 소크라테스식 문제 출제와 후속 질문. "퀴즈", "문제 내줘", "테스트", "복습"에 활성화. cc-opencode-cmux 가용 시 출제를 OpenCode에 위임.
---

# Deep Question

KB(memsearch) 자료를 기반으로 출제 → 학습자 답변 → 소크라테스식 후속 질문.

## 모드 감지

```bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:?}"
eval "$("$PLUGIN_ROOT/scripts/resolve-config.sh")"
eval "$("$PLUGIN_ROOT/scripts/oc-detect.sh")"
```

## 워크플로우

### 1. 토픽·자료 수집 (CC 직접)
- `$ARGUMENTS`가 토픽이면 `memsearch search "<토픽>" -k 8`로 청크 수집
- 청크 hash들 모아 `memsearch expand`로 풀 컨텐츠
- 청크들을 `/tmp/cc-dt-question/<session>/chunks.md`에 저장 (CC 컨텍스트 폭주 방지)

### 2. 출제 — `question-generator` agent
- 입력: 토픽 + chunks.md 경로 + 문제 수
- oc 모드: OC에 위임, 결과 JSON을 파일로 받음
- cc-only: generator가 직접 JSON 생성
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

`$ARGUMENTS`: 출제 토픽. 비어 있으면 최근 학습 토픽 추천 (beads ready + memsearch recent).

## 사용 예

```
/cc-deep-tutor:deep-question Q-learning
/cc-deep-tutor:deep-question 트랜스포머 self-attention
```

## 주의
- KB에 없는 사실 출제 금지
- 5지선다 금지 (사고 단계 부족)
- 정답 직접 누설 금지 (소크라테스식)
