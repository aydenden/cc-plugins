# llm-wiki

조사한 내용을 Obsidian 볼트에 쌓아 두고, 다음 작업에서 다시 찾고, 쌓인 것끼리 잇는다.
볼트는 [Karpathy LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 패턴으로 운영하고, **런타임 의존성이 없다.**
스키마 규칙은 플러그인이 아니라 **볼트 루트의 `SCHEMA.md`(정본)**가 정의하며, 플러그인은 그 규칙을 읽고 따르도록 강제한다.

## 설치

```bash
/plugin marketplace add aydenden/cc-plugins
/plugin install llm-wiki@aydenden-plugins
```

또는 로컬 테스트:

```bash
claude --plugin-dir ./plugins/llm-wiki
```

전제 조건은 둘뿐이다. **볼트 경로 환경변수**(`WIKI_PATH` 또는 `OBSIDIAN_VAULT_PATH`)와
**그 볼트 루트의 `SCHEMA.md`**. 설치할 패키지는 없다. 둘 중 하나라도 없으면 SessionStart
훅이 stderr에 한 줄 알리고 지나간다. 세션을 막지는 않지만 capture·recall·lint가 실패한다.

```bash
WIKI="${WIKI_PATH:-$OBSIDIAN_VAULT_PATH}"
```

`WIKI_PATH` 우선, 없으면 `OBSIDIAN_VAULT_PATH` 폴백. SessionStart 훅이 경로와 `SCHEMA.md` 존재를 검증한다.

### SCHEMA.md 최소 예시

lint는 `## Frontmatter`의 yaml 블록(`# required` 표시가 필수 필드), `## Page Types & Directories`의 표,
`## Tag Taxonomy`의 `` - `태그` `` 목록을 읽는다. 셋 중 하나라도 없으면 lint가 멈춘다. 나머지 절은 적재 절차가 읽는 규칙이다.

<details><summary>볼트 루트에 둘 <code>SCHEMA.md</code></summary>

````markdown
# Wiki Schema

## Domain
프론트엔드 개발 학습 노트.

## Conventions
- 파일 이름은 소문자·하이픈 (`react-suspense.md`)
- 페이지끼리는 `[[wikilinks]]`로 잇는다 (페이지당 2개 이상)
- 고칠 때마다 `date`를 올린다. `index.md`는 손으로 고치지 않는다(lint가 만든다)
- 모든 작업은 `log.md` 끝에 `## [YYYY-MM-DD] action | 제목` 한 줄로 남긴다

## Frontmatter

```yaml
---
type: entity | concept | comparison | query | summary   # required
tags: [아래 택소노미]                                    # required
summary: 이 페이지 한 줄 설명                            # required
date: YYYY-MM-DD                                        # required, 마지막 수정일
sources:                                                # required, 목록
  - raw/articles/foo.md
  - https://example.com/post
# Optional:
confidence: high | medium | low
contested: true
contradictions: [page-slug]
---
```

## Page Types & Directories

| type | directory | holds |
|---|---|---|
| `entity` | `entities/` | 도구·라이브러리·회사 하나 |
| `concept` | `concepts/` | 개념·주제 하나 |
| `comparison` | `comparisons/` | 둘 이상의 비교 |
| `query` | `queries/` | 여러 페이지로 답한 질문 |
| `summary` | `summaries/` | 원문 하나의 요약 |

## Tag Taxonomy
통제 어휘다. 해당 항목이 있으면 그 표기를 쓰고, 없으면 자유 키워드를 붙인다.

- `react` — React와 그 생태계
- `typescript` — 타입 시스템
- `performance` — 렌더링·번들 성능

## Page Thresholds
- 2개 이상 원문에 나오거나 한 원문의 중심 주제일 때만 새 페이지를 만든다
- 200줄을 넘으면 하위 주제로 나눈다

## Update Policy
새 정보가 기존 내용과 충돌하면 양쪽을 날짜·출처와 함께 적고 `contradictions:`에 표시한다.
````

</details>

`log.md`는 빈 파일(`# Log` 한 줄)로 시작해도 된다.

## 커맨드 (llm-wiki Core Operations 대응)

| 커맨드 | llm-wiki 연산 | 설명 |
|--------|--------------|------|
| `/llm-wiki:capture <URL 또는 제목>` | Ingest | raw/ 캡처(sha256 dedup)까지 담당하고, 적재는 wiki-schema 스킬 절차에 위임 |
| `/llm-wiki:recall <키워드>` | Query | Grep 전수검색 → 후보 합성 → 가치 있으면 queries/에 파일링 |
| `/llm-wiki:research <주제>` | Ingest(research) | 메인이 하위 질문을 세우고, 서브에이전트가 라운드마다 하나씩 열린 질문을 조사·`raw/` 원문 확보 → 메인이 얕은 지점을 판정해 없어질 때까지 반복 → wiki-schema 절차로 적재 |
| `/llm-wiki:setup-channels` | — | 선택 계층 채널(gh·Reddit·X·YouTube) 진단·설치. **옵트인**이라 한 번도 안 돌려도 리서치는 필수 계층으로 완주한다 |

Lint 커맨드는 없다. 정비도 커밋도 아래 훅이 log 기록 직후 자동으로 돌린다.

## 훅

| 훅 | 설명 |
|----|------|
| SessionStart | 볼트 도달·초기화 검증(경로, `SCHEMA.md`) 후 원격과 동기화한다. fetch하고 워킹트리가 깨끗하면 fast-forward, 더럽거나 갈라졌으면 경고만 한다. 세션을 막지 않는다 |
| PostToolUse (`Write\|Edit`) | 대상이 볼트 `log.md`일 때만 동작한다. `--write-index`로 index 재생성 → 점검 → 커밋·푸시. 커밋 메시지는 log.md 마지막 엔트리 헤더에서 뽑는다(`{action}(vault): {제목}`). lint error가 있으면 **커밋을 보류**하고 exit 2로 즉시 조치를 강제한다. review 그룹(`contested`·`confidence: low`)은 커밋을 막지 않고 건수와 드릴다운 명령만 알린다. 그 외 파일 쓰기에서는 아무것도 하지 않고 즉시 종료한다 |

## 검색: Claude Code 내장 Grep 전수검색

볼트 마크다운 총량이 8.5MB라 `rg` 전수검색이 0.02초에 끝난다. 인덱스를 두는 순간 3플랫폼
무설치 원칙이 깨지므로 검색 인덱스는 두지 않는다.

- **검색** = Claude Code 내장 Grep. `index.md` 등재 여부와 무관하게 파일시스템 전체가 대상이다.
- 한국어 볼트는 형태소 분석기가 없으므로 **쿼리 확장이 필수**다. 규칙은
  `skills/wiki-schema/references/search-expansion.md`.
- **잃은 것**: 시맨틱 유사도·rerank. 무설치로는 불가하므로 수용한다.
- 118문항 사후 평가에서 MRR 0.955로, 버린 하이브리드 검색보다 낮지 않았다. → [평가 기록](../../docs/research/2026-08-17-recall-grep-eval.md)

## 스킬

| 스킬 | 설명 |
|------|------|
| wiki-schema | **볼트 적재 절차의 소유자.** 볼트 쓰기 시 자동 적용된다. SCHEMA.md 오리엔테이션, 레이어 구분(raw 불변), Grep 전수검색+쿼리 확장, frontmatter·태그, 교차참조(최소 2 outbound + 역링크 5), log 기록, lint 실행, Update Policy(모순 병기). `index.md`는 손대지 않는다(lint가 재생성) |
| ingest-book | **도서 → `raw/books/<책>/` 번들.** 환경 가드(darwin + `marker_single`)를 먼저 확인하고 통과할 때만 변환한다. 주력 기기 전용이며, 없으면 명시적으로 거부한다. 페이지 마커 기반 챕터 분할·이미지 동반 복사·본문 점검까지 `scripts/ingest-book.mjs`가 담당 |

## 리서치 채널

채널 레지스트리는 [`docs/research-channels.md`](docs/research-channels.md)가 정본이다. **필수 계층**(WebSearch/WebFetch, 논문 5종 무키 REST, 트윗 단건)은 전 기기에서 설치 없이 돌고, **선택 계층**(gh·rdt-cli·twitter-cli·yt-dlp)은 그 질의에 필요할 때만 1회 탐지한다. 채널이 없거나 상류에 오류가 나도 실패로 치지 않고 그 채널을 빼고 진행하며, 빠진 채널은 산출물에 명시한다.

무키 REST 두 채널은 의존성 0 스크립트가 감싼다:

```bash
node scripts/research-channels.mjs papers "<질의>" [--source id,...] [--limit N] [--json]
node scripts/research-channels.mjs tweet <id 또는 URL>
```

선택 계층은 `command -v`가 아니라 **실호출로 판정**한다(`ok | auth | missing | broken`). 설치됐지만 미인증인 것과 상류가 깨진 것은 사용자가 할 일이 다르기 때문이다:

```bash
node scripts/setup-channels.mjs check [--channel id,...] [--json]
node scripts/setup-channels.mjs install --yes    # 계획을 먼저 출력, 인증은 사람 몫
```

**브라우저 우회**는 채널을 늘리는 것이 아니라 이미 고른 소스에 **도달하지 못했을 때** 올라가는
3계단 사다리다: WebFetch → `agent-browser`(JS 렌더링·봇 필터·로그인 벽) → `scrapling`(프록시·
헤더 제어). 한 번에 한 계단만 올라가고, 3계단은 2계단의 상위 집합이 아니라 순서대로 간다(실측).
세 계단이 다 막히면 그 소스는 포기하고 산출물에 남긴다. 절차는
[`docs/browser-fallback.md`](docs/browser-fallback.md)가 소유하며, 진단·설치는 선택 계층과 같이
`/llm-wiki:setup-channels`가 맡는다.

전용 에이전트 파일(`agents/`)은 두지 않는다. 조사 프롬프트는 `/llm-wiki:research` 커맨드가 들고 있고, 적재 절차는 `wiki-schema` 스킬 한 곳에만 있다.

## 런타임 의존성

**없다.** 읽기·검색·페이지 작성은 Claude Code 내장 도구만 쓰고, `scripts/`의 스크립트는 전부 **node:
내장 모듈만 쓰는 의존성 0 Node `.mjs`**라 macOS·Linux·Windows 11에서 `node` 하나로 돈다.
`scripts/surya-guard/sitecustomize.py`만 파이썬인데, 도서 변환 때 marker의 파이썬이 읽는 파일이고
추가로 설치하는 것은 없다.

설치가 필요한 것은 둘뿐이며 **둘 다 선택**이다. 도서 변환(`ingest-book`, 환경 가드가 막고
주력 기기 전용)과 선택 계층 리서치 채널(`/llm-wiki:setup-channels`, 옵트인). 어느 쪽도 없이
읽기·검색·작성·정비·필수 리서치가 전부 동작한다.

## 스키마 (볼트 SCHEMA.md가 정의, 아래는 현재 값 요약)

- **type**: `entity | concept | comparison | query | summary` → type별 디렉터리에 저장
- **frontmatter**: 필수 `type / tags / summary / date / sources` + 선택 `confidence / contested / contradictions / subjects`. 이 키가 전부이며 다른 키는 drift로 lint가 잡는다. 표시 이름은 frontmatter가 아니라 H1이 갖는다
- **태그**: SCHEMA.md 택소노미는 **통제 어휘**다. 해당 항목이 있으면 그 표기를 쓰고, 없으면 자유 키워드를 붙인다. lint가 잡는 건 표기 분열(대소문자·구분자)과 날짜 태그뿐이며, 자유 태그가 10페이지쯤 쌓이면 택소노미로 승격
- **Page Thresholds**: 2+ 소스 등장 또는 단일 소스 중심 주제일 때만 신규 페이지, 200줄 초과 시 분리
- **Update Policy**: 모순은 양쪽 병기 + `contested`/`contradictions` 표기, lint가 검토 목록으로 표면화
- **raw/ frontmatter**: `source_url / ingested / sha256`. 재ingest 시 dedup·drift 감지

이 값들이 바뀌면 SCHEMA.md가 우선이다. 플러그인 문서를 고칠 필요 없이 SCHEMA.md만 수정하면 된다.

## 디렉터리 구조

볼트 (3계층):

```
$WIKI/
├── SCHEMA.md      # Layer 3: 컨벤션·frontmatter·태그 택소노미·페이지 기준 (정본)
├── index.md       # 주제군 지도 (lint가 재생성, 손으로 고치지 않는다)
├── log.md         # 연산 이력 (append-only, 끝에 추가)
├── raw/           # Layer 1: 불변 원본 (articles/papers/transcripts/feeds/books)
├── entities/      # Layer 2: 엔티티 페이지 (도구, 조직, 인물)
├── concepts/      # Layer 2: 개념/주제 페이지
├── comparisons/   # Layer 2: A vs B 분석
├── queries/       # Layer 2: 보존 가치 있는 질의 결과
└── summaries/     # Layer 2: 단일 소스 요약
```

플러그인:

```
plugins/llm-wiki/
├── .claude-plugin/plugin.json    # 플러그인 메타데이터
├── commands/                     # capture · recall · research · setup-channels
├── skills/                       # wiki-schema(적재 절차) · ingest-book(도서 변환)
├── docs/
│   ├── research-channels.md     #   채널 레지스트리 (정본)
│   └── browser-fallback.md      #   WebFetch가 막혔을 때의 승급 사다리
├── hooks/                        # SessionStart(볼트 검증·pull) + PostToolUse(log.md → 정비·커밋)
└── scripts/                      # 의존성 0 Node .mjs, 전부 `node` 하나로 돈다
    ├── lint.mjs                  #   볼트 점검 + index 생성
    ├── vault-git.mjs             #   볼트 원격 동기화 (sync/commit), 두 훅이 공유
    ├── research-channels.mjs     #   무키 논문 5종 + X 단건
    ├── setup-channels.mjs        #   선택 채널 진단·설치
    ├── ingest-book.mjs           #   도서 변환 파이프라인 (설치형 도구 필요)
    └── surya-guard/              #   변환 중 OCR 반복 루프 차단, marker의 파이썬이 읽는다
```

## 테스트

의존성 0으로 같이 돈다:

```bash
node --test scripts/lint.test.mjs scripts/ingest-book.test.mjs \
  scripts/research-channels.test.mjs scripts/setup-channels.test.mjs \
  scripts/vault-git.test.mjs hooks/post-log.test.mjs
bash scripts/surya-guard/sitecustomize.test.sh    # python3 필요
```
