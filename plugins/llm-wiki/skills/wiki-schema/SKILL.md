---
name: wiki-schema
description: Obsidian 볼트(LLM Wiki)에 노트를 작성하거나 수정할 때 자동 적용. 볼트 루트의 SCHEMA.md를 SSoT로 삼아 오리엔테이션(SCHEMA→index→log)을 강제하고, frontmatter·태그 택소노미·교차참조·모순 처리·index/log 갱신 규칙을 적용한다. capture, research, 볼트 Write/Edit 작업 시 트리거.
---

볼트에 노트를 쓰기 전 반드시 이 절차를 따른다.

# 원칙: 볼트의 SCHEMA.md가 SSoT다

스키마 규칙(타입 분류, frontmatter 필드, 태그 택소노미, 페이지 생성 기준)은 이 스킬이 아니라 **볼트 루트의 `SCHEMA.md`에 정의**되어 있다. 이 스킬은 그 규칙을 읽고 따르도록 강제하는 래퍼다. 이 문서와 SCHEMA.md가 충돌하면 SCHEMA.md가 우선한다.

볼트 경로 결정:

```bash
WIKI="${WIKI_PATH:-$OBSIDIAN_VAULT_PATH}"
```

둘 다 미설정이면 사용자에게 안내하고 중단.

# 규칙 1: 오리엔테이션 (세션당 1회, 볼트 쓰기 전 필수)

① `Read $WIKI/SCHEMA.md` — 도메인, 컨벤션, frontmatter 정의, 태그 택소노미, 페이지 생성 기준(Page Thresholds), Update Policy를 파악한다.
② `$WIKI/index.md` — 헤더(Total pages, 섹션 구성)를 확인하고, 작업 주제 키워드로 Grep하여 관련 기존 페이지를 식별한다. 인덱스가 작으면(50항목 미만) 전체 Read 가능.
③ `Bash: tail -40 "$WIKI/log.md"` — 최근 활동을 파악해 중복 작업을 방지한다.

오리엔테이션 없이 쓰기 시작하면 중복 페이지 생성, 교차참조 누락, 스키마 위반이 발생한다.

# 규칙 2: 레이어 구분

| 레이어 | 경로 | 쓰기 권한 |
|--------|------|-----------|
| Raw Sources | `raw/` (articles/papers/transcripts 등) | 추가만 가능. **기존 파일 수정 절대 금지** |
| Wiki | `entities/` `concepts/` `comparisons/` `queries/` | 생성·갱신 가능 |
| Schema | `SCHEMA.md` | 택소노미에 새 태그 추가 시에만 Edit (사용 전에 추가) |

관리 파일 `log.md`는 규칙 5의 절차로만 갱신하고, `index.md`는 직접 갱신하지 않는다(lint가 재생성). `.obsidian/` 수정 금지.

# 규칙 3: 페이지 작성

1. **타입 분류와 저장 위치**: SCHEMA.md의 type 정의를 따르고, type에 해당하는 디렉토리에 저장한다 (entity→`entities/`, concept→`concepts/`, comparison→`comparisons/`, query→`queries/`, summary→`summaries/`). type과 디렉토리는 1:1이며 새 type을 만들지 않는다 — 페이지 성격은 `tags`로 표현한다.
2. **생성 기준**: SCHEMA.md의 Page Thresholds를 따른다 — 2개 이상 소스에서 등장하거나 단일 소스의 중심 주제일 때만 새 페이지. 스치는 언급은 기존 페이지에 추가하거나 생략.
3. **frontmatter**: SCHEMA.md의 Frontmatter 절을 그대로 따른다 — 필수 `type/tags/summary/date/sources` + 선택 `confidence/contested/contradictions/subjects`. **이 8개가 전부이며 다른 키는 쓰지 않는다**(`title`/`created`/`updated`/`source`/`source_hash` 등은 폐지됨). 갱신 시 `date`(= 최종 갱신일)를 올린다. 표시 이름은 frontmatter가 아니라 H1이 갖는다.
4. **태그**: SCHEMA.md 택소노미에 있는 태그만 사용. 새 태그가 필요하면 SCHEMA.md 택소노미에 먼저 추가한 뒤 사용하고, 보고에 명시한다.
5. **파일명**: lowercase-kebab-case, 공백 없음.
6. **분량**: 200줄 초과 시 하위 주제로 분리하고 상호 링크.

# 규칙 4: 교차참조

- 모든 신규/갱신 페이지는 다른 페이지로 향하는 `[[wikilink]]`를 **최소 2개** 포함한다.
- 작성 후 관련 기존 페이지 **최대 5개**에 새 페이지로의 역링크를 Edit으로 삽입하고, 어디에 삽입했는지 보고한다.
- 제외 대상: `index.md`, `log.md`, `SCHEMA.md`, `CLAUDE.md`, `raw/`, `.obsidian/`.

# 규칙 5: index.md / log.md 갱신 (쓰기 후 필수)

**index.md** — **손대지 않는다.** 디렉토리별 카탈로그와 루트 지도의 자동 구간은 정비 스크립트(lint)가 frontmatter에서 전량 재생성한다. 수동 편집은 재생성 때 사라진다.

**log.md** — 파일 **끝에 append** (append-only):

```markdown
## [YYYY-MM-DD] action | 제목
- 생성/갱신한 파일 목록
```

action은 log.md 헤더에 정의된 것(ingest, update, query, lint, create, archive, delete 등)을 사용. 500항목 초과 시 `log-YYYY.md`로 회전.

# 규칙 6: 모순 처리 (SCHEMA.md Update Policy)

새 정보가 기존 페이지와 충돌하면:

1. 날짜 확인 — 최신 소스가 일반적으로 우선
2. 진짜 모순이면 양쪽 주장을 날짜·출처와 함께 본문에 병기
3. frontmatter에 `contested: true`, `contradictions: [상대-페이지-slug]` 표기
4. 사용자 검토가 필요함을 보고에 명시

조용히 덮어쓰지 않는다. 보충/확장 관계는 모순이 아니다.
