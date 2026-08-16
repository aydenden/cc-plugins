---
description: LLM Wiki 볼트에서 관련 페이지를 검색하여 컨텍스트에 주입한다
argument-hint: <검색 키워드>
---

LLM Wiki 볼트에서 "$ARGUMENTS"와 관련된 지식을 찾아 현재 작업 컨텍스트에 주입해줘.

## 볼트 경로

```bash
WIKI="${WIKI_PATH:-$OBSIDIAN_VAULT_PATH}"
```

`WIKI`가 미설정이면 사용자에게 안내하고 중단.

## 1. 검색

검색 절차의 SSoT는 wiki-schema 스킬이 소유한다. **Read** 후 그대로 따른다:

```
${CLAUDE_PLUGIN_ROOT}/skills/wiki-schema/references/search-expansion.md
```

Grep 전수검색(1차) → 쿼리 확장(필수) → index 폴백(미적중 시) → 후보 1~5개 선별·Read 순이다.

## 2. 결과 제공

```
## 위키 검색 결과: $ARGUMENTS

### 발견된 페이지
1. [[페이지명]] — 핵심 요약 1~2줄
2. [[페이지명]] — 핵심 요약 1~2줄

### 종합
- 현재 작업에 적용 가능한 패턴/결정/교훈. "Based on [[page-a]] and [[page-b]]..." 식으로 출처 페이지 인용.

### 연결된 페이지
- [[관련페이지]] — 관련 이유
```

- 전체 노트를 그대로 출력하지 말 것 (토큰 낭비). 핵심만 요약.
- 현재 작업 맥락과 연결해서 어떻게 활용할 수 있는지 제안한다.

## 3. 답변 파일링 (Query Feedback)

합성한 답변이 **재도출하기 아까운 수준**(실질적 비교 분석, 딥다이브, 신규 합성)이면 저장을 제안한다:

> "이 분석을 위키에 저장할까요? (queries/ 또는 comparisons/)"

사용자가 동의하면 **wiki-schema 스킬의 적재 절차(규칙 4~9)를 그대로 수행**한다 — `queries/`(일반 합성) 또는 `comparisons/`(A vs B)에 작성, `sources:`에는 인용한 위키 페이지를 표기, 교차참조·log 기록까지 포함이다(lint는 훅이 자동으로 돈다).

단순 조회 결과는 파일링하지 않는다.
