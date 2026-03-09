---
description: 대화 지식 또는 웹 페이지를 Obsidian 볼트에 저장한다
argument-hint: <노트 제목 또는 URL>
---

"$ARGUMENTS"를 Obsidian 볼트에 저장해줘.

## 소스 감지

인자를 분석해서 소스 유형을 판단한다:

| 조건 | 유형 | 동작 |
|------|------|------|
| URL 형태 (`http://`, `https://`) | 웹 클리핑 | defuddle로 본문 추출 후 노트 생성 |
| 그 외 | 대화 지식 저장 | 현재 대화에서 핵심 내용 추출 후 노트 생성 |

## 1. 웹 클리핑 (URL)

```bash
# 1단계: defuddle로 본문 추출
defuddle parse <URL> --md

# 2단계: 볼트에 저장
obsidian create name="제목" content="..." tags="clipping,소스도메인" silent
```

defuddle 결과에서 제목/본문을 추출하고, frontmatter에 source URL을 포함한다.

## 3. 대화 지식 저장 (기본)

현재 대화에서 핵심 지식을 추출하여 노트를 생성한다.

```bash
obsidian create name="$ARGUMENTS" content="---\ntags:\n  - 자동추론태그\ndate: YYYY-MM-DD\nsource: Claude Code 세션\n---\n\n# 제목\n\n## 핵심 요약\n...\n\n## 상세 내용\n..." silent
```

적절한 하위 디렉토리를 판단하여 저장한다 (AI/, 백엔드/, DesignPattern/ 등).

## 자동 정리 (모든 유형 공통)

저장 후 반드시 수행:

1. **중복 검사**: `obsidian search query="제목 키워드" limit=5`로 유사 노트 확인. 중복이면 기존 노트에 append 제안.
2. **관련 노트 연결**: `obsidian search`와 `obsidian backlinks`로 관련 노트를 찾아 본문에 `[[wikilink]]` 추가.
3. **태그 정규화**: `obsidian tags sort=count`로 기존 태그 목록 확인 후 유사 태그 통일 (예: `js`와 `javascript`가 혼용되면 빈도 높은 쪽으로).
