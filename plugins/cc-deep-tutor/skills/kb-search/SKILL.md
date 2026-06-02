---
name: kb-search
description: This skill should be used when the user asks to "KB 검색", "자료 찾아줘", "노트 찾아줘", "search the knowledge base", "find notes about X", or when a cc-deep-tutor skill/agent needs to retrieve learning materials from the markdown wiki. Defines the canonical frontmatter-scan-first retrieval procedure (Grep/Glob/Read, no memsearch) and the add/expand/stats commands over the materials/ wiki.
---

# KB Search

cc-deep-tutor KB 검색의 단일 출처(SSoT). KB는 `materials/` 아래 마크다운 노트 위키이며,
검색은 벡터 DB 없이 **frontmatter scan-first**(Grep/Glob/Read)로 수행한다. 모든
cc-deep-tutor agent/skill은 "KB 검색"을 이 절차로 정의한다.

## 환경 준비

```bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:?}"
eval "$("$PLUGIN_ROOT/scripts/resolve-config.sh")"
# 검색 루트 = $CC_DEEP_TUTOR_MATERIALS_DIR (단 _wiki/ 는 제외)
```

memsearch는 더 이상 사용하지 않는다. 설치 의존성 없음.

## 검색 절차 (6단계 — 이 순서를 따른다)

대상 글롭: `$CC_DEEP_TUTOR_MATERIALS_DIR/**/*.md`. **`_wiki/` 디렉토리는 항상 제외**
(INDEX.md/tags.md 자체가 검색에 잡히지 않도록).

1. **키워드 추출** — 질의를 핵심어 + 동의어/약어 배열로 확장한다.
   예: "어텐션" → `[attention, self-attention, 트랜스포머]`.
2. **1차 스캔 (병렬)** — 세 가지를 동시에 실행한다:
   - `Grep "summary:"` 라인에 키워드
   - `Grep "tags:"` 라인에 키워드
   - `Glob` 파일명에 키워드
   결과를 합쳐 후보 경로 집합을 만든다.
3. **후보 Read (≤5개)** — frontmatter + 본문을 확인해 적합도를 판정한다.
4. **백링크 확장** — `Grep "[[<후보 id>]]"` 로 연결된 노트를 추적한다.
5. **(miss 시) INDEX fallback** — 1차 스캔이 비면 `_wiki/INDEX.md`(노트 1줄 요약 모음,
   수백 노트까지 ~20K토큰)를 통째로 Read 하고, LLM이 관련 id를 직접 골라 Read 한다.
6. **결과 반환** — `{경로, 매칭 섹션}` 목록. raw 본문은 호출자(CC) 컨텍스트에 올리지
   않고 경로만 넘긴다 (토큰 절감).

## OC 위임 연결 (대규모 조사 시)

OC `analyze`/`research` 프로파일은 glob/grep을 직접 수행할 수 있다(실측 확인). 따라서
대규모 조사에서는 CC가 1·2단계를 직접 하지 않고, OC 워커에게 검색 디렉토리/글롭을 그대로
넘겨 검색+읽기+집필을 전담시킬 수 있다. spec에 다음을 명시한다:
- `INPUTS: <materials_dir>/**/*.md` (단 `_wiki/` 제외)
- "매칭 노트의 **절대경로**를 결과에 명시할 것" (OC가 경로를 누락하지 않도록)

자세한 위임 패턴은 `cc-opencode-cmux:delegate-oc` Skill을 통한다.

## 명령 라우팅

`$ARGUMENTS`의 첫 단어로 분기:

| 명령 | 동작 |
|------|------|
| `search <쿼리>` | 위 6단계 절차 실행 → `{경로, 매칭 섹션}` 목록 반환 |
| `expand <경로>` | `Read <경로>` (해당 노트 풀 컨텐츠) |
| `add <pdf>` | `${CLAUDE_PLUGIN_ROOT}/scripts/extract.sh <pdf>` (추출 + frontmatter 자동생성 → hook이 INDEX 갱신) |
| `stats` | `_wiki/INDEX.md` 줄 수 + `materials/` 디렉토리별 노트 수 집계 |

`index`/`watch`/`add-md`는 폐기됨 (PostToolUse hook `update-index.sh`가 인덱싱을 자동 처리).

## 새 노트 작성 규칙

KB에 노트를 추가할 때는 `skills/kb-search/templates/`의 템플릿을 따른다:
- 공통: `note-core.md` (검색 4대 필드 id/title/summary/tags 필수)
- 종류별: `note-extract.md` / `note-research.md` / `note-solve.md`

`tags`는 `_wiki/tags.md` 레지스트리의 값만 사용한다. 신규 태그는 레지스트리에 먼저 추가한다.
노트를 Write/Edit 하면 PostToolUse hook이 `_wiki/INDEX.md`를 자동 갱신하고 미등록 태그를
경고한다.

## 사용 예

```
/cc-deep-tutor:kb-search search "self-attention"
/cc-deep-tutor:kb-search add materials/papers/attention.pdf
/cc-deep-tutor:kb-search stats
```
