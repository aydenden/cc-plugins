---
name: wiki-schema
description: Obsidian 볼트(LLM Wiki)의 적재 절차 소유자. 볼트 루트의 SCHEMA.md를 SSoT로 삼아 오리엔테이션(SCHEMA→index→log)을 강제하고, 기존 페이지 확인·frontmatter·태그 택소노미·교차참조·모순 처리·log 기록·lint 실행까지 볼트에 쓰는 전 과정을 규정한다. capture, research, ingest-book, 볼트 Write/Edit 작업 시 트리거.
---

볼트에 노트를 쓰는 모든 경로(`/capture`, `/research`, `ingest-book`, 직접 Write/Edit)는 이 절차를 따른다. 커맨드는 소스를 확보하는 데까지 하고, **적재는 여기가 소유한다** — 스키마가 바뀔 때 고칠 곳이 하나여야 한다.

# 원칙: 볼트의 SCHEMA.md가 SSoT다

스키마 규칙(타입 분류, frontmatter 필드, raw/ frontmatter, 태그 택소노미, 페이지 생성 기준, Update Policy)은 이 스킬이 아니라 **볼트 루트의 `SCHEMA.md`에 정의**되어 있다. 이 스킬은 그 규칙을 읽고 따르도록 강제하는 절차 래퍼다. 이 문서와 SCHEMA.md가 충돌하면 SCHEMA.md가 우선한다.

볼트 경로 결정:

```bash
WIKI="${WIKI_PATH:-$OBSIDIAN_VAULT_PATH}"
```

둘 다 미설정이면 사용자에게 안내하고 중단.

# 규칙 1: 오리엔테이션 (세션당 1회, 볼트 쓰기 전 필수)

① `Read $WIKI/SCHEMA.md` — 도메인, 컨벤션, frontmatter 정의, 태그 택소노미, 페이지 생성 기준(Page Thresholds), Update Policy를 파악한다.
② `Read $WIKI/index.md` — **전체를 읽는다.** 루트 index는 전수 카탈로그가 아니라 주제군 지도(작게 유지)이므로 항상 전량 읽어 볼트가 쓰는 어휘와 카테고리 구성을 잡는다.
③ `Bash: tail -40 "$WIKI/log.md"` — 최근 활동을 파악해 중복 작업을 방지한다.

볼트를 원격과 맞추는 일은 세션 시작 훅(`hooks/session-start.sh`)이 한다 — 깨끗한 브랜치는 자동 fast-forward되고, 워킹트리가 더럽거나 갈라졌으면 경고만 뜬다. `GIT dirty` / `GIT diverged` / `GIT pull-failed` 경고를 봤다면 **볼트에 쓰기 전에 그것부터 해소한다** — 낡은 사본 위에 쓰면 규칙 3의 중복 검사가 원격에 이미 있는 페이지를 못 본다.

**검색은 오리엔테이션이 아니라 규칙 3의 첫 단계다.** index는 Grep 미적중 시의 폴백이자 어휘 공급원이지 1차 검색 경로가 아니다 — 상세는 [references/search-expansion.md](references/search-expansion.md).

오리엔테이션 없이 쓰기 시작하면 중복 페이지 생성, 교차참조 누락, 스키마 위반이 발생한다.

# 규칙 2: 레이어 구분

| 레이어 | 경로 | 쓰기 권한 |
|--------|------|-----------|
| Raw Sources | `raw/` (articles/papers/transcripts/feeds 등) | 추가만 가능. **기존 파일 수정 절대 금지** |
| Wiki | `entities/` `concepts/` `comparisons/` `queries/` `summaries/` | 생성·갱신 가능 |
| Schema | `SCHEMA.md` | 자유 태그를 통제 어휘로 승격할 때만 Edit (규칙 7) |

관리 파일 `log.md`는 규칙 6의 절차로만 갱신하고, `index.md`는 **직접 갱신하지 않는다**(lint가 재생성). `.obsidian/` 수정 금지.

## raw/ 저장

원문을 보존할 가치가 있으면 위키 페이지를 쓰기 전에 `raw/`에 먼저 남긴다 — 웹 문서는 `raw/articles/`, 논문은 `raw/papers/`, 대화·붙여넣은 전문은 `raw/transcripts/`. 파일명은 서술적 kebab-case(예: `raw/articles/karpathy-llm-wiki-2026.md`).

책은 여기서 다루지 않는다 — `raw/books/<책>/`는 `ingest-book` 스킬이 소유하는 번들이며 손으로 만들지 않는다.

frontmatter는 SCHEMA.md의 `raw/ Frontmatter` 절을 그대로 따른다(`source_url` / `ingested` / `sha256`). `sha256`은 **frontmatter 닫는 `---` 다음 줄부터의 본문**에 대해 계산한다 — 이 기준은 lint의 drift 검사와 동일해야 한다.

**재ingest 감지**: 같은 `source_url`이 `raw/`에 이미 있으면 새 sha256과 비교해 — 동일하면 처리 생략을 보고하고, 다르면 drift로 표시한 뒤 갱신한다.

일회성 대화 지식은 raw 저장을 생략하고 위키 페이지에 바로 합성하되 `sources:`에 `session:YYYY-MM-DD`를 기재한다.

# 규칙 3: 기존 페이지 확인 (작성 전 필수)

**이 단계가 위키와 중복 더미를 가르는 차이다.**

소스에 등장한 엔티티·개념 이름으로 `$WIKI`의 `entities/` `concepts/` `comparisons/` `queries/` `summaries/`를 **Grep 전수검색**한다. 볼트 마크다운 총량 8.5MB, 전수검색 실측 0.02초 — 인덱스도 사전 준비도 없다.

한국어 볼트에서 미적중의 대부분은 부재가 아니라 표기 불일치이므로 **쿼리 확장은 필수**다. 확장 규칙과 index 폴백 절차는 [references/search-expansion.md](references/search-expansion.md)를 따른다.

# 규칙 4: 페이지 작성·갱신

1. **타입 분류와 저장 위치**: SCHEMA.md의 type 정의를 따르고, type에 해당하는 디렉토리에 저장한다 (entity→`entities/`, concept→`concepts/`, comparison→`comparisons/`, query→`queries/`, summary→`summaries/`). type과 디렉토리는 1:1이며 새 type을 만들지 않는다 — 페이지 성격은 `tags`로 표현한다.
2. **생성 기준**: SCHEMA.md의 Page Thresholds를 따른다 — 2개 이상 소스에서 등장하거나 단일 소스의 중심 주제일 때만 새 페이지. 스치는 언급은 기존 페이지에 추가하거나 생략.
3. **frontmatter**: SCHEMA.md의 Frontmatter 절을 그대로 따른다 — 필수 `type/tags/summary/date/sources` + 선택 `confidence/contested/contradictions/subjects`. **이 8개가 전부이며 다른 키는 쓰지 않는다** — 스키마 밖 키는 SCHEMA.md의 Removed fields 목록대로 오래된 페이지에서도 걷어낸다. 갱신 시 `date`(= 최종 갱신일)를 올린다. 표시 이름은 frontmatter가 아니라 H1이 갖는다.
4. **summary**: 디렉토리 `index.md` 자동 생성의 입력이므로 한 줄로 반드시 채운다. 비면 생성된 카탈로그에 구멍이 난다.
5. **sources**: 항상 배열이며 원소는 `raw/…`(볼트 상대경로, lint가 존재를 검증) | URL | `github:org/repo` | `session:YYYY-MM-DD`.
6. **confidence**: 공식 문서·1차 소스 다수=high, 1·2차 혼재=medium, 포럼·미검증=low. 의견성이거나 단일 소스 주장은 medium 이하.
7. **태그**: SCHEMA.md 택소노미는 **통제 어휘지 화이트리스트가 아니다**(ccp-30j). 해당하는 항목이 있으면 반드시 그 표기를 쓰고, 없으면 페이지가 실제로 다루는 키워드를 자유롭게 붙인다. 지켜야 할 것은 표기 규칙뿐이다 — 소문자·하이픈, 목록에 있는 용어는 목록 표기 그대로, 영어 항목이 있는 한국어 중복은 영어로 접기, 날짜 태그 금지. 자유 태그가 10페이지쯤 쌓이면 SCHEMA.md에 승격한다.
8. **파일명**: lowercase-kebab-case, 공백 없음.
9. **분량**: 200줄 초과 시 하위 주제로 분리하고 상호 링크.

하나의 소스가 5~15개 페이지 갱신을 일으킬 수 있다 — 이것이 정상이고 복리 효과다. 단, 기존 페이지 10개 이상을 건드리게 되면 진행 전에 범위를 사용자에게 확인한다.

# 규칙 5: 교차참조

- 모든 신규·갱신 페이지는 다른 페이지로 향하는 `[[wikilink]]`를 **최소 2개** 포함한다.
- 작성 후 관련 기존 페이지 **최대 5개**에 새 페이지로의 역링크를 Edit으로 삽입하고, 어디에 삽입했는지 보고한다.
- 제외 대상: `index.md`, `log.md`, `SCHEMA.md`, `CLAUDE.md`, `raw/`, `.obsidian/`.

인바운드 링크 수는 lint가 루트 index의 허브 상위 N개를 뽑는 신호이기도 하다 — 역링크를 빠뜨리면 그 페이지는 탐색 경로에서도 가라앉는다.

# 규칙 6: log.md 기록

`index.md`는 손대지 않는다. 기록 대상은 `log.md` 하나이며, 파일 **끝에 append**한다(append-only):

```markdown
## [YYYY-MM-DD] action | 제목
- Raw: `raw/articles/{파일}.md` (또는 "raw 생략 — 대화 지식")
- Created/Updated: {파일 목록}
- 역링크: [[노트1]], [[노트2]]
```

action은 log.md 헤더에 정의된 것(ingest, update, query, lint, create, archive, delete 등)을 사용한다.

**log.md를 통째로 Read하지 않는다.** append는 꼬리만 있으면 된다 — `Read(log.md, offset=<끝 근처>, limit=5)`로 마지막 줄을 앵커로 잡고 Edit한다(줄 수는 규칙 1의 `tail -40`이나 `wc -l`로 안다). 파일이 커져도 append 비용이 일정해야 이 로그가 유지 가능하다.

회전은 손으로 옮기지 말고 명령으로 한다 — lint가 `log-rotation`을 error로 올리면(**150KB 또는 500엔트리 중 먼저 오는 쪽**):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/lint.mjs" --vault "$WIKI" --rotate-log
```

`log-YYYY.md`(아카이브에 담긴 최신 엔트리의 연도)로 옮기고 헤더와 이전 이력 포인터를 남긴다. 아카이브도 Grep 전수검색 대상이라 과거 이력은 잃지 않는다.

# 규칙 7: 정비(lint)와 커밋 — 훅이 자동 실행한다

**직접 호출하지 않는다.** 규칙 6의 `log.md` append가 끝나면 `PostToolUse` 훅(`hooks/post-log.mjs`)이 그 쓰기를 감지해 index 재생성(`--write-index`) → 점검 → **커밋·푸시**를 순서대로 돌린다. 사용자 호출용 커맨드는 없다 — 실행 시점이 log 기록에 고정돼 있어야 빠지지 않는다. `git add`나 `git commit`을 직접 실행하지 않는다.

훅이 돌려주는 것은 lint 요약 한 덩어리와 `GIT <status> — <detail>` 한 줄이다.

- 요약이 `LINT ok backlog=N`이면 그대로 보고에 옮기고 끝낸다.
- `LINT error=N …`이면 **그 자리에서 조치**한다. error 그룹은 `broken-links` `frontmatter` `raw-drift` `log-rotation` `contested`이며, 이때만 드릴다운한다:

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/lint.mjs" --vault "$WIKI" --group <id> --json --limit 30
  ```

- backlog 그룹(`source-format` `tags` `orphans` `raw-unabsorbed` `low-confidence-unmarked` `stale-pages` `oversized` `title-dups`)은 볼트 전역 레거시다. 건수만 보고하고 넘어간다. **전체 목록을 대화에 쏟지 않는다.**
- 훅 출력이 오지 않았으면(훅 미설치, `WIKI_PATH` 미설정, node 부재) 위 요약 명령을 직접 한 번 돌리고, 그마저 안 되면 "정비 미실행"을 보고에 한 줄로 남긴다.

## 커밋·푸시 (`GIT` 줄)

lint가 통과한 사이클만 커밋된다. **error 그룹이 있으면 훅은 커밋을 보류한다** — 깨진 상태를 공유 히스토리에 남기지 않기 위해서다. error를 조치한 뒤 규칙 6대로 `log.md`에 다시 기록하면 그때 이번 사이클 변경까지 함께 커밋된다.

커밋 메시지는 묻지 않는다 — 훅이 `log.md` 마지막 엔트리 헤더를 `{action}(vault): {제목}`으로 옮긴다. 규칙 6의 헤더 형식이 곧 커밋 메시지이므로 제목을 성의 있게 쓴다.

| `GIT` 상태 | 뜻 | 할 일 |
|---|---|---|
| `pushed` / `committed` | 커밋(·푸시) 완료 | 보고에 한 줄 옮기고 끝 |
| `nothing-to-commit` | 변경 없음 | 그대로 보고 |
| `push-rejected` | 다른 기기가 원격을 먼저 옮겼다 | 커밋은 로컬에 안전하다. `git -C "$WIKI" pull --rebase` 후 push하고, 충돌은 규칙 8(모순 처리)로 다룬다 |
| `push-failed` / `commit-failed` | 네트워크·인증·잠금 실패 | 원인을 사용자에게 보고한다. 자동 재시도하지 않는다 |
| `not-a-repo` / `no-upstream` | 볼트가 git으로 공유되지 않는다 | 조치 없음 |

# 규칙 8: 모순 처리 (SCHEMA.md Update Policy)

새 정보가 기존 페이지와 충돌하면:

1. 날짜 확인 — 최신 소스가 일반적으로 우선
2. 진짜 모순이면 양쪽 주장을 날짜·출처와 함께 본문에 병기
3. frontmatter에 `contested: true`, `contradictions: [상대-페이지-slug]` 표기
4. 사용자 검토가 필요함을 보고에 명시

조용히 덮어쓰지 않는다. 보충·확장 관계는 모순이 아니다.

# 규칙 9: 보고

생성·갱신한 모든 파일 목록, 역링크 삽입 위치, lint 요약(error 조치 내역 + backlog 건수), 그리고 커밋·푸시 결과(`GIT` 줄)를 사용자에게 보고한다. 커밋이 보류됐거나 푸시가 거절됐으면 그 사실을 숨기지 않는다 — 다른 기기에서 그만큼 낡은 볼트를 보게 된다.
