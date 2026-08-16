---
description: 웹 페이지 또는 대화 지식을 LLM Wiki 볼트에 ingest한다
argument-hint: <URL 또는 노트 제목>
---

"$ARGUMENTS"를 LLM Wiki 볼트에 ingest해줘.

## 볼트 경로

```bash
WIKI="${WIKI_PATH:-$OBSIDIAN_VAULT_PATH}"
```

`WIKI`가 미설정이면 사용자에게 안내하고 중단.

## 절차의 주인은 wiki-schema 스킬이다

이 커맨드는 **소스를 확보하는 데까지**만 규정한다. 확보 이후의 모든 것 — 오리엔테이션, 기존 페이지 확인, 페이지 작성·frontmatter·태그, 교차참조, log 기록, lint 실행, 보고 — 은 `wiki-schema` 스킬의 절차를 그대로 따른다. 절차가 두 벌이 되면 한쪽만 낡는다.

## 1. 오리엔테이션 (wiki-schema 규칙 1)

이 세션에서 아직 안 했다면: `SCHEMA.md` Read → 루트 `index.md` 전체 Read → `tail -40 log.md`.

## 2. 소스 확보

인자를 분석해서 소스 유형별로 처리한다.

### URL (`http://`, `https://`)

1. WebFetch로 본문 추출 (제목 + 전체 내용).
2. wiki-schema 규칙 2의 `raw/` 저장 절차를 따른다 — 저장 위치, frontmatter(`source_url`/`ingested`/`sha256`), 재ingest 감지가 모두 거기에 있다.

### 대화 지식 (URL이 아닌 경우)

현재 대화에서 핵심 지식을 추출한다. 일회성 대화는 raw 캡처를 생략하고 위키 페이지에 직접 합성하되 `sources:`에 `session:YYYY-MM-DD`를 기재한다. 원문 보존 가치가 있는 긴 내용(트러블슈팅 전문, 외부에서 붙여넣은 텍스트)은 `raw/transcripts/`에 저장 후 진행한다.

## 3. 적재

wiki-schema 스킬의 규칙 3~9를 순서대로 수행한다 — 기존 페이지 확인(Grep 전수검색 + 쿼리 확장) → 페이지 작성·갱신 → 교차참조 → log.md 기록 → 훅이 돌린 lint 결과 처리 → 보고.

인자: $ARGUMENTS
