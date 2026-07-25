---
description: LLM Wiki 볼트에서 관련 페이지를 검색하여 컨텍스트에 주입한다
argument-hint: <검색 키워드>
---

LLM Wiki 볼트에서 "$ARGUMENTS"와 관련된 지식을 찾아 현재 작업 컨텍스트에 주입해줘.

## 볼트 경로 · CLI 위치

```bash
WIKI="${WIKI_PATH:-$OBSIDIAN_VAULT_PATH}"
CLI="${CLAUDE_PLUGIN_ROOT}/src/cli.ts"   # llm-wiki 검색 CLI (Bun)
```

`WIKI`가 미설정이면 사용자에게 안내하고 중단.

## 검색 절차 (전용 인덱스 — index.md Grep 아님)

### 1단계: llm-wiki 검색 실행

```bash
bun run "$CLI" search "$ARGUMENTS" --vault "$WIKI" --json --level 3 --rerank -n 8
```

- 이 CLI는 **파일시스템 전체를 인덱싱한 전용 검색 인덱스**(BM25 형태소 + bge-m3 벡터 하이브리드)를
  쓴다. `index.md` 등록 여부와 무관하게 볼트의 모든 위키 페이지가 검색된다(과거 index.md Grep의
  74% 누락 문제 해소).
- 출력은 JSON: `{ query, mode, degraded, results: [{ path, title, type, tags, confidence, score, snippet, updated }] }`.
- `"degraded": true`면 모델 미준비로 BM25-only 상태다(결과는 유효하나 의미검색·rerank 미적용).
  이 경우 `bun run "$CLI" status --vault "$WIKI"`로 모델 준비 상태를 확인해 사용자에게 알린다.
- 인덱스가 없다는 오류가 나면 먼저 `bun run "$CLI" index --vault "$WIKI"`를 안내한다
  (첫 인덱싱은 모델 다운로드 ~1GB + 임베딩으로 시간이 걸림 — 백그라운드 권장).

### 2단계: 후보 선별 · 본문 확장 (Level 3 → Level 4)

- JSON `results`의 `snippet`으로 관련성을 판단해 **상위 1~5개만** 선별한다.
- 선별한 후보의 `path`를 `$WIKI` 기준으로 **Read**하여 전체 본문 확인(= Level 4 확장).
- 각 페이지의 `[[wikilink]]`를 따라 1-hop 이웃도 필요 시 확인.
- 전체 결과를 무턱대고 Read하지 말 것 — snippet으로 좁힌 뒤 최소한만 확장(토큰 절약).

## 결과 제공

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

## 답변 파일링 (Query Feedback)

합성한 답변이 **재도출하기 아까운 수준**(실질적 비교 분석, 딥다이브, 신규 합성)이면 저장을 제안한다:

> "이 분석을 위키에 저장할까요? (queries/ 또는 comparisons/)"

사용자가 동의하면 wiki-schema 스킬 규칙대로:

1. SCHEMA.md frontmatter 형식으로 `queries/`(일반 합성) 또는 `comparisons/`(A vs B)에 Write — `type: query` 또는 `comparison`, `sources:`에 인용한 위키 페이지 표기
2. outbound `[[wikilink]]` 최소 2개 포함, 관련 페이지 최대 5개에 역링크 삽입
3. `log.md` 끝에 `## [YYYY-MM-DD] query | {주제}` append (파일링 여부 명시)
4. 저장 직후 인덱스 증분 갱신:
   ```bash
   bun run "$CLI" index --vault "$WIKI" --file "<새로 저장한 파일 절대경로>"
   ```

단순 조회 결과는 파일링하지 않는다.

## 주의사항

- 전체 노트를 그대로 출력하지 말 것 (토큰 낭비). 핵심만 요약.
- 검색 결과가 없으면(`results: []`) "볼트에 관련 페이지 없음"으로 짧게 알리고 끝낸다.
- 현재 작업 맥락과 연결해서 어떻게 활용할 수 있는지 제안한다.
