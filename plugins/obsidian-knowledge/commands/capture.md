---
description: 대화 지식 또는 웹 페이지를 Obsidian 볼트에 저장한다
argument-hint: <노트 제목 또는 URL>
---

"$ARGUMENTS"를 Obsidian 볼트에 저장해줘.

## 환경변수

볼트 경로: `OBSIDIAN_VAULT_PATH` 환경변수에서 가져온다. 설정되지 않았으면 사용자에게 안내하고 중단.

## 소스 감지

인자를 분석해서 소스 유형을 판단한다:

| 조건 | 유형 | 동작 |
|------|------|------|
| URL 형태 (`http://`, `https://`) | 웹 클리핑 | WebFetch로 본문 추출 후 노트 생성 |
| 그 외 | 대화 지식 저장 | 현재 대화에서 핵심 내용 추출 후 노트 생성 |

## 1. 웹 클리핑 (URL)

1. WebFetch로 URL 본문 추출 (제목, 핵심 내용 요약 요청)
2. 볼트 하위 폴더를 판단하여 Write로 노트 생성
3. frontmatter에 `source: URL` 포함

## 2. 대화 지식 저장 (기본)

현재 대화에서 핵심 지식을 추출하여 노트를 생성한다.

1. 적절한 하위 디렉토리를 판단
2. Write 도구로 직접 파일 생성

## 노트 작성 절차

### A. 엔티티 타입 결정

콘텐츠를 분석하여 타입을 결정한다:

| 시그널 | 타입 |
|--------|------|
| npm/pip 패키지, 프레임워크, SDK, API | `library` |
| 추상 아이디어, 디자인 패턴, 방법론 | `concept` |
| A vs B 비교, 트레이드오프 분석 | `comparison` |
| 인물, 연구자, 저자, 조직 | `person` |
| 아티클, 논문, 책, 영상 요약 | `source-summary` |
| 코드베이스, 프로덕트, 서비스 | `project` |
| 일지, 회고, 세션 노트 | `journal` |

### B. 템플릿 로드

`Read ${CLAUDE_PLUGIN_ROOT}/templates/{type}.md` 로 해당 타입의 템플릿을 읽는다.
템플릿의 frontmatter 필드와 섹션 구조를 따라 노트를 작성한다.

### C. source_hash 생성 (URL 소스만)

웹 클리핑인 경우, WebFetch로 받은 본문 첫 500자로 해시를 생성한다:

```bash
echo -n "{본문_첫_500자}" | shasum -a 256 | cut -c1-8
```

대화 지식 저장인 경우 source_hash는 생략하고 `source: "Claude Code session"` 설정.

### D. confidence 결정

| 소스 | confidence |
|------|------------|
| 공식 문서, 1차 소스 | `high` |
| 블로그, 2차 소스 | `medium` |
| 포럼, LLM 생성, 미검증 | `low` |

### E. Write로 노트 작성

템플릿 구조에 맞춰 Write 도구로 파일을 생성한다.

## 자동 정리 (저장 후 반드시 수행)

### 1. 중복 검사
Grep으로 볼트 내 유사 제목/태그 검색. 중복이면 기존 노트에 append 제안.

### 2. 태그 정규화
Grep으로 기존 태그 패턴 확인 후 일관된 태그 사용 (예: `js`와 `javascript` 혼용 방지).

### 3. 교차참조 삽입

새 노트의 제목과 상위 2-3개 태그를 추출한 뒤:

1. Grep으로 볼트 내 관련 노트를 탐색 (tags/summary/본문에서 키워드 매칭)
2. 관련 노트 **최대 5개**에 대해:
   - 해당 노트를 Read
   - `## 관련 노트` 섹션에 `- [[새노트제목]]` 을 **Edit으로 직접 삽입**
   - 섹션이 없으면 파일 끝에 `## 관련 노트` 섹션을 추가
3. 어떤 노트에 역링크를 삽입했는지 사용자에게 보고

`_wiki/index.md`, `_wiki/log.md`, `.obsidian/` 내 파일은 교차참조 대상에서 제외.

### 4. 모순 감지

동일 엔티티/주제에 대한 기존 노트를 Grep으로 탐색. 상충하는 정보가 있으면 새 노트 본문 상단에 삽입:

```markdown
> [!warning] 충돌 감지
> [[기존-노트-제목]]의 내용과 상충할 수 있음. 검토 필요.
```

### 5. index.md 갱신

1. `$OBSIDIAN_VAULT_PATH/_wiki/index.md` 를 Read (없으면 아래 형식으로 생성)
2. 새 노트의 type에 해당하는 카테고리 섹션을 찾아 행 추가
3. Edit으로 갱신

index.md 기본 구조:
```markdown
---
type: index
date: YYYY-MM-DD
---

# Wiki Index

> 자동 관리됨 — capture/research/lint 작업 후 갱신

## Libraries
| 노트 | 요약 |
|------|------|

## Concepts
| 노트 | 요약 |
|------|------|

## Comparisons
| 노트 | 요약 |
|------|------|

## Persons
| 노트 | 요약 |
|------|------|

## Source Summaries
| 노트 | 요약 |
|------|------|

## Projects
| 노트 | 요약 |
|------|------|

## Journals
| 노트 | 요약 |
|------|------|
```

### 6. log.md append

`$OBSIDIAN_VAULT_PATH/_wiki/log.md` 상단에 엔트리를 추가한다 (없으면 생성):

```markdown
## [YYYY-MM-DD] capture | {노트 제목}
- 파일: `{하위폴더/파일명.md}`
- 타입: {entity_type}
- source_hash: {hash 또는 "없음"}
- 백링크 삽입: [[노트1]], [[노트2]]
```

노트 제목: $ARGUMENTS
