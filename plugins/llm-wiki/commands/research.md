---
description: 주제를 조사해 원문을 raw/에 확보하고 wiki-schema 절차로 볼트에 적재한다
argument-hint: <조사할 주제>
---

"$ARGUMENTS"를 조사해서 LLM Wiki 볼트에 적재해줘.

## 볼트 경로

```bash
WIKI="${WIKI_PATH:-$OBSIDIAN_VAULT_PATH}"
```

`WIKI`가 미설정이면 사용자에게 안내하고 중단.

## 경계 — 이 커맨드는 소스를 확보하는 데까지다

조사는 서브에이전트 1개에 위임하고, **적재는 `wiki-schema` 스킬이 소유한다.** 절차가 두 벌이 되면 한쪽만 낡는다(그 비용의 실물이 구 `research-agent`였다).

## 1. 오리엔테이션 (wiki-schema 규칙 1)

이 세션에서 아직 안 했다면: `SCHEMA.md` Read → 루트 `index.md` 전체 Read → `tail -40 log.md`.

## 2. 기존 페이지 먼저 확인 (wiki-schema 규칙 3)

Grep 전수검색은 0.02초다. 조사를 위임하기 **전에** 확인해서 이미 있는 것을 다시 조사하지 않는다. 확장 규칙은 `${CLAUDE_PLUGIN_ROOT}/skills/wiki-schema/references/search-expansion.md`.

- 관련 페이지 있음 → 상위 1~3개 Read → 요약 + 경로 보고 후 **종료**. 갱신이 필요하면 3단계로.
- 없음 → 3단계.

## 3. 조사 위임 (서브에이전트 1개)

Task 도구로 `general-purpose` 서브에이전트 **하나만** 띄운다. 병렬 팬아웃하지 않는다 — 조사 원문이 메인 컨텍스트를 밀어내는 것을 막는 게 위임의 목적이지, 속도가 아니다.

프롬프트(그대로 전달, `$ARGUMENTS`와 `$WIKI`는 실제 값으로 치환):

````
주제: $ARGUMENTS
볼트: $WIKI

너는 조사만 한다. 위키 페이지를 쓰지 마라 — 적재는 메인 세션이 한다.

1. `${CLAUDE_PLUGIN_ROOT}/docs/research-channels.md`를 Read하고 그 레지스트리대로
   질의 성격에 맞는 채널만 고른다. 필요한 선택 채널만 1회 탐지하고, 실패하면 즉시 축퇴한다.
2. 조사 원칙: 공식 문서·1차 자료 우선, 최신 우선, 각 사실에 출처 URL과 발행일.
   추측 금지 — 출처 없는 사실은 보고하지 않는다.
2-1. **WebFetch가 403·빈 본문·"Just a moment…"로 막히면 포기하기 전에 브라우저 사다리를 한 계단
   올라간다.** 절차는 `${CLAUDE_PLUGIN_ROOT}/docs/browser-fallback.md`를 Read해 그대로 따른다.
   한 번에 한 계단이고, 세 계단이 다 막히면 그 URL을 조사 제외 채널에 남긴다.
3. **원문을 반드시 `raw/`에 파일로 남긴다.** 요약만으로 페이지를 쓰면 품질이 떨어지므로
   메인이 필요한 원문을 골라 읽을 수 있어야 한다. 저장 위치·frontmatter(`source_url`/
   `ingested`/`sha256`)·재ingest 감지는 `${CLAUDE_PLUGIN_ROOT}/skills/wiki-schema/SKILL.md`
   규칙 2를 Read해 그대로 따른다. 웹 문서는 `raw/articles/`, 논문은 `raw/papers/`.
   `raw/`의 기존 파일은 수정하지 않는다(추가만).
4. 볼트의 다른 어떤 파일도 만들거나 고치지 않는다(`index.md`·`log.md`·위키 디렉토리 포함).

반환은 아래 형식으로 40줄 이내. **본문·원문·긴 인용을 반환에 넣지 마라** — 메인이 raw 파일을
직접 Read한다.

## 조사 결과
**한 줄 결론:** (15단어 이내)
**사용한 채널:** (예: papers(arxiv,openalex), WebSearch)
**조사 제외 채널:** (예: Reddit·X — 이 기기 미설치 / pubmed — http 429. 없으면 "없음")

### 확보한 원문
- `raw/articles/{파일}.md` — 한 줄 요약 (출처 URL, 발행일)

### 핵심 발견
- 사실 — 출처 파일 또는 URL   ← 5~10개, 각 2줄 이내
````

## 4. 적재 (wiki-schema 규칙 3~9)

서브에이전트 반환을 받으면:

1. 핵심 발견을 보고 **필요한 raw 파일만** Read한다. 전부 읽지 않는다.
2. 규칙 3~9를 순서대로 수행한다 — 기존 페이지 확인 → 페이지 작성·갱신(type↔디렉토리, frontmatter 8필드, summary, sources, confidence, 태그) → 교차참조 → `log.md` append → 훅이 돌린 lint 결과 처리 → 보고.
3. `sources:`에는 확보한 `raw/…` 경로를 쓰고, raw가 없는 사실만 URL을 직접 적는다.
4. `index.md`는 손대지 않는다(lint가 재생성).

## 5. 보고

wiki-schema 규칙 9의 보고에 **조사 제외 채널을 한 줄로 반드시 옮긴다.** 축퇴를 조용히 삼키면 나중에 이 페이지의 커버리지를 판단할 수 없다.

인자: $ARGUMENTS
