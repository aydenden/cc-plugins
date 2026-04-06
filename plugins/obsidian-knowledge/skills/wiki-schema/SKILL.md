---
name: wiki-schema
description: Obsidian 볼트에 노트를 작성하거나 수정할 때 자동 적용. 엔티티 타입 분류, 출처 추적(source provenance), 교차참조 강제, 모순 감지 규칙을 적용한다. capture, research, 볼트 Write/Edit 작업 시 트리거.
---

Obsidian 볼트에 노트를 쓸 때 아래 규칙을 반드시 따른다.

# 규칙 1: 엔티티 타입 분류

노트 생성 전 콘텐츠를 분석하여 타입을 결정하고, 해당 템플릿을 로드한다.

| 시그널 | 타입 | 템플릿 |
|--------|------|--------|
| npm/pip 패키지, 프레임워크, SDK, API | `library` | `${CLAUDE_PLUGIN_ROOT}/templates/library.md` |
| 추상 아이디어, 디자인 패턴, 방법론, 알고리즘 | `concept` | `${CLAUDE_PLUGIN_ROOT}/templates/concept.md` |
| A vs B 비교, 트레이드오프 분석 | `comparison` | `${CLAUDE_PLUGIN_ROOT}/templates/comparison.md` |
| 인물, 연구자, 저자, 조직 | `person` | `${CLAUDE_PLUGIN_ROOT}/templates/person.md` |
| 아티클, 논문, 책, 영상 요약 (웹 클리핑) | `source-summary` | `${CLAUDE_PLUGIN_ROOT}/templates/source-summary.md` |
| 코드베이스, 프로덕트, 서비스, 오픈소스 프로젝트 | `project` | `${CLAUDE_PLUGIN_ROOT}/templates/project.md` |
| 일지, 회고, 세션 노트, 학습 기록 | `journal` | `${CLAUDE_PLUGIN_ROOT}/templates/journal.md` |

**적용 방법:**
1. 타입을 결정한다
2. `Read ${CLAUDE_PLUGIN_ROOT}/templates/{type}.md` 로 템플릿 로드
3. 템플릿의 frontmatter 필드와 섹션 구조를 채워서 노트를 작성

# 규칙 2: 출처 추적 (Source Provenance)

모든 노트의 frontmatter에 다음 필드를 포함한다:

```yaml
---
type: library | concept | comparison | person | source-summary | project | journal
tags: [소문자-태그]
summary: "1-2문장 핵심 요약. 검색 판단용."
date: YYYY-MM-DD
source: "context7 | github:org/repo | web:URL | Claude Code session | recall synthesis"
source_hash: "sha256 앞 8자리"
confidence: high | medium | low
---
```

**source_hash 생성 규칙:**
- 외부 소스(URL, 문서)에서 생성한 노트: 원본 내용 첫 500자의 sha256 앞 8자리
  ```bash
  echo -n "{원본_첫_500자}" | shasum -a 256 | cut -c1-8
  ```
- 대화 지식(`source: "Claude Code session"`)이나 recall 합성(`source: "recall synthesis"`): source_hash 생략

**confidence 기준:**
- `high`: 공식 문서, 1차 소스, 직접 검증된 정보
- `medium`: 블로그, 2차 소스, 신뢰할 만한 커뮤니티
- `low`: 포럼, LLM 생성, 미검증 정보

# 규칙 3: 교차참조 강제

노트를 Write로 작성한 **후** 반드시 수행:

1. 새 노트의 제목과 상위 2-3개 태그를 추출
2. Grep으로 볼트 내 관련 노트를 탐색 (tags/summary/본문에서 키워드 매칭)
3. 관련 노트 **최대 5개**에 대해:
   - 해당 노트를 Read
   - `## 관련 노트` 섹션에 `- [[새노트제목]]` 을 Edit으로 직접 삽입
   - 섹션이 없으면 파일 끝에 `## 관련 노트` 섹션을 추가
4. 어떤 노트에 역링크를 삽입했는지 보고

**주의:** `_wiki/index.md`, `_wiki/log.md`, `.obsidian/` 내 파일은 교차참조 대상에서 제외.

# 규칙 4: 모순 감지

노트를 Write로 작성하기 **전** 수행:

1. 동일 엔티티/주제에 대한 기존 노트를 Grep으로 탐색
2. 기존 노트의 핵심 주장과 새 노트의 내용을 비교
3. 상충하는 정보가 있으면 새 노트 본문 상단에 콜아웃 삽입:

```markdown
> [!warning] 충돌 감지
> [[기존-노트-제목]]의 내용과 상충할 수 있음. 검토 필요.
> - 기존: "기존 주장 요약"
> - 신규: "새로운 주장 요약"
```

명백한 모순만 플래그한다. 보충/확장 관계는 모순이 아니다.
