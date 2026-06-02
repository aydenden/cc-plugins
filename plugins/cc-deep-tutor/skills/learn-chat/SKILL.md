---
name: learn-chat
description: KB 컨텍스트와 함께 자유 학습 대화. think→act→observe→respond 4단계 자연 수행. "공부 같이 하자", "설명해줘"에 활성화.
---

# Learn Chat

CC 자체 agent loop이 think-act-observe-respond를 자연스럽게 수행하므로, 이 skill은 **KB 자동 부착과 학습자 응답 패턴**만 담당. OC 위임 없음 (대화형 latency 민감).

## 사전 체크

```bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:?}"
eval "$("$PLUGIN_ROOT/scripts/resolve-config.sh")"
```

## 동작 규칙

### 1. KB 자동 검색 (kb-search 규칙)
- 사용자 질문에서 키워드 추출
- `Grep "summary:"`/`Grep "tags:"` 에 키워드 + `Glob` 파일명 (대상 `$CC_DEEP_TUTOR_MATERIALS_DIR/**/*.md`, `_wiki/` 제외) → 후보 노트
- 후보를 Read 해 관련 섹션만 컨텍스트에 부착 (miss 시 `_wiki/INDEX.md` 로드 후 선택)
- 부착 시 출처 표시 (`kb:<상대경로>#<섹션>`)

### 2. 답변 스타일
- 정의 → 예시 → 반례 → 한계 순서
- 수식은 LaTeX, 코드는 코드블록
- 각 주장에 출처 (`kb:<상대경로>#<섹션>` 또는 외부 URL)
- 한국어 default

### 3. 이해도 체크 (선택)
- 답변 끝에 1줄 체크 질문 (학습자가 핵심 잡았는지)
- 형식: `> 💡 확인: <짧은 질문>`
- 빈도: 새 개념 등장 시만

### 4. 세션 메모리
- 학습 대화 내용을 노트로 저장하고 싶으면 사용자에게 묻기
- 동의 시 `$CC_DEEP_TUTOR_MATERIALS_DIR/notes/chat-<slug>-<date>.md`에 저장 → hook이 자동 인덱싱

## 인자

`$ARGUMENTS`: 첫 질문/주제 (선택). 없으면 사용자가 자유롭게 시작.

## 사용 예

```
/cc-deep-tutor:learn-chat
/cc-deep-tutor:learn-chat Q-learning부터 설명해줘
```
