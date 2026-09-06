# cc-deep-tutor: memsearch → 마크다운 위키 전환 설계

- **날짜**: 2026-06-02
- **대상 플러그인**: cc-deep-tutor (v0.2.0 → 차기)
- **상태**: 설계 확정 (구현 전)
- **관련**: cc-opencode-cmux (v0.8.0), obsidian-knowledge (recall/wiki-schema 패턴 참고)

## 배경 / 동기

cc-deep-tutor의 KB는 현재 `memsearch`(Milvus + ollama bge-m3 임베딩 벡터검색)에
의존한다. 이 때문에:

1. Docker/daemon 인프라가 필요 — 설치 진입장벽.
2. OC(OpenCode) agent는 **bash 도구가 없어** `memsearch search/expand`를 실행할 수
   없다. 따라서 "토픽만 CC가 분류하고 나머지(자료수집+집필)는 OC 워커로 분할 위임"이
   불가능했고, KB 수집 단계는 항상 CC가 떠안아야 했다.

OC agent는 `fs_*`(read/write/glob) + `websearch`/`webfetch`는 보유한다. 따라서 **KB를
마크다운 파일 기반 위키로 바꾸면** OC가 파일을 직접 읽고(`fs_read`) 웹조사·집필까지
전담할 수 있어, cc-opencode-cmux의 read-only 보안 모델을 훼손하지 않고도 완전 위임이
성립한다.

### 규모 적합성 (조사 근거)

학습용 코퍼스는 수십~수백 문서 규모이며 질의가 논문 제목·알고리즘명·약어 등
**전문 용어 중심**이다. 이 영역은 임베딩이 약하고 키워드/grep이 강하다. Anthropic도
"RAG는 컨텍스트 창을 넘는 *대형* KB용 해법"이라 전제 — 컨텍스트에 들어오는 규모에서
벡터DB는 오버엔지니어링이다.

출처:
- Anthropic "Building Effective Agents" (2024-12) — 단순·조합형 패턴, LLM 도구 선택 위임
- Anthropic "Contextual Retrieval" (2024-09) — BM25+임베딩 하이브리드는 대형 KB 기준
- Eugene Yan "LLM Patterns" (2024) — 임베딩 단독은 약어/고유명에 취약
- Simon Willison "Search-based RAG" (2024-06) — 벡터 없이 LLM 키워드 + 텍스트검색으로 실용 RAG

## 트레이드오프

| 잃는 것 | 얻는 것 |
|---|---|
| 의미기반(동의어/패러프레이즈) 랭킹 | Milvus/ollama Docker·daemon 의존성 제로 |
| chunk 단위 granularity | OC 완전 위임(토픽 분류만 CC) |
| | obsidian-knowledge recall 패턴 재사용 |
| | auto-index hook 단순화 |

동의어 약점은 (a) `_wiki/tags.md` 통제 어휘로 태그를 수렴시키고, (b) 질의 키워드 추출
단계에서 LLM이 동의어를 확장하며, (c) miss 시 INDEX.md 통째 로드 fallback으로 보완한다.

## 핵심 설계 결정

1. **스키마 소유권**: cc-deep-tutor **자체 보유(독립)**. obsidian-knowledge 패턴은
   참고·복제만 하고 플러그인 간 의존을 만들지 않는다. 학습 도메인(출처 페이지 인용 등)에
   특화한다.
2. **템플릿 단위**: **공통 코어 + 종류별 확장**. 검색은 공통 코어(summary/tags)만
   스캔해 일관되고, 종류별 특성도 살린다.
3. **검색 신뢰도**: **태그 레지스트리 + 자동 INDEX.md**. 태그는 통제 어휘에서만
   선택하고, PostToolUse hook이 INDEX를 자동 갱신한다.

## 산출물과 파일 배치

### 플러그인 repo (`plugins/cc-deep-tutor/`)

```
skills/kb-search/
├── SKILL.md                 # 재작성: memsearch 제거, 검색 규칙(절차) = SSoT
└── templates/
    ├── note-core.md         # 코어 템플릿(=template.md) — 공통 frontmatter + 섹션 골격
    ├── note-extract.md      # 코어 확장: source_pdf, pages, authors
    ├── note-research.md     # 코어 확장: subtopics, citations
    └── note-solve.md        # 코어 확장: problem, topic, verified
hooks/
├── hooks.json               # PostToolUse: update-index.sh (기존 auto-index.sh 대체)
└── update-index.sh          # _wiki/INDEX.md 재생성 + 태그 레지스트리 검증
```

### 사용자 학습 프로젝트 (`materials/_wiki/`, 런타임 생성)

```
materials/
├── papers/ books/ notes/ extracted/   # 노트 본체
└── _wiki/
    ├── INDEX.md   # 자동: 노트 1개당 1줄 (id | type | tags | summary)
    └── tags.md    # 태그 레지스트리(통제 어휘) — 작성자는 여기서만 선택
```

**SSoT 분리**: 검색 규칙 = kb-search SKILL.md / 작성 규칙 = templates/ / 통제 어휘 =
`_wiki/tags.md`. 모든 agent는 "검색은 kb-search 규칙을 따른다"로 참조한다.

## 코어 템플릿 (note-core.md)

```markdown
---
id: <slug>                 # 파일명과 동일, 안정적 식별자 (백링크 대상)
type: extract|research|solve|note
title: <사람이 읽는 제목>
summary: <1~2줄. 검색 1차 타깃 — 핵심 개념어 원형 반드시 포함>   # 필수
tags: [<tag1>, <tag2>]     # 필수. _wiki/tags.md 레지스트리에서만 선택
source: <pdf경로 | url | "derived">
date: YYYY-MM-DD
---

# <title>

## 요약
<summary를 2~3문장으로 확장>

## 본문
<섹션은 종류별 확장 템플릿이 지정>

## Citations
- kb:<상대경로>#<h2섹션>      # memsearch hash 대체 — 파일+섹션 인용
- <url>
```

### 검색 4대 필드
`id` / `title` / `summary` / `tags` — 나머지(source/date/종류별)는 출처추적·인용용.

### 종류별 확장

| type | 추가 frontmatter | 본문 섹션 |
|---|---|---|
| **extract** | `source_pdf`, `pages`, `authors` | 원문 구조 유지 (MinerU 출력) |
| **research** | `subtopics: []`, `citations: []` | 정의/예시/반례/한계/가지치기후보 |
| **solve** | `problem`, `topic`, `verified: bool` | 계획/풀이단계/검증/재서술 |

### 작성 규약 (템플릿 상단 주석으로 명시)
1. `summary`에 핵심 개념어 **원형** 포함 (grep 1차 히트 지점).
2. `tags`는 레지스트리에서만 — 신규 태그는 `_wiki/tags.md`에 먼저 등록.
3. Citations는 `kb:<경로>#<섹션>` 형식 고정.

### 추출 노트 frontmatter 자동 생성
extract.sh가 MinerU 추출 직후 OC `oc-summarize`에 위임해 `summary`/`tags`를 자동
생성한다 → 사람이 수동 인덱싱하지 않아도 검색 가능 상태가 된다.

## 검색 규칙 (kb-search SKILL.md = SSoT)

obsidian-knowledge recall 패턴을 학습 도메인에 이식한 6단계:

```
[질의]
 ① 키워드 추출 — 질의 → 핵심어 + 동의어/약어 배열
 ② 1차 스캔 (병렬, materials/**/*.md, _wiki/ 제외)
    • Grep "summary:" 라인에 키워드
    • Grep "tags:" 라인에 키워드
    • Glob 파일명에 키워드
    → 후보 경로 집합
 ③ 후보 Read (≤5개) — frontmatter + 본문 확인
 ④ 백링크 확장 — Grep "[[<후보 id>]]" 로 연결 노트 추적
 ⑤ (miss 시) _wiki/INDEX.md 통째 로드(~20K토큰) → LLM이 관련 id 직접 선택 → Read
 ⑥ 결과 = {경로, 매칭 섹션} 목록 (raw 본문은 CC 컨텍스트 미진입 — 경로만)
```

### OC 위임 연결 (핵심 목표)
- CC는 ①②만 수행 → **후보 경로 목록**만 확보 (컨텍스트 절약).
- 그 경로들을 spec의 `INPUT_NOTES: [경로...]`로 OC research 워커에 전달.
- OC가 `fs_read`로 노트 읽고 + websearch 보충 + 본문 집필까지 전담.
- memsearch hash expand가 하던 "풀 컨텐츠 가져오기"를 OC `fs_read`가 대체.

> **검증 완료 (2026-06-02)**: OC `analyze` 프로파일에 glob 입력만 주고(정확한 경로 없이)
> needle 포함 노트를 찾게 한 위임 실측 결과 `status: done`으로 성공 — OC가 스스로
> grep/glob 스캔 → frontmatter `id`/`summary` 추출. SSE auto-deny에 막히지 않음.
> → **grep/glob 가용 확정.** 검색 ①②(키워드 스캔 + 후보 탐색)까지 OC research 워커에
> 넘길 수 있다. CC는 토픽 분류만 수행한다. (주의: OC가 결과에 절대경로를 자동
> 기입하지 않았으므로 spec에서 "매칭 파일의 절대경로를 출력하라"를 명시할 것.)

### kb-search 명령 매핑 (memsearch 대체)

| 기존 | 신규 |
|---|---|
| `search <q>` | ①②③ 절차 실행 → 경로+섹션 반환 |
| `expand <hash>` | `Read <경로>` (또는 OC fs_read) |
| `stats` | `_wiki/INDEX.md` 줄 수 + 디렉토리 집계 |
| `add <pdf>` | extract.sh → 추출 + frontmatter 자동생성 → INDEX 갱신 |
| `index` / `watch` | **삭제** (hook이 대체) |

## 태그 레지스트리 + 자동 INDEX hook

### `_wiki/tags.md` (통제 어휘)

```markdown
# Tag Registry
<!-- 노트의 tags는 이 목록에서만 선택. 신규 태그는 여기 먼저 추가 -->
- attention — 어텐션/self-attention 메커니즘
- q-learning — 강화학습 Q-러닝 계열
- transformer — 트랜스포머 아키텍처
```

신규 개념이면 한 줄 추가 후 사용 → 동의어가 한 태그로 수렴해 grep miss 방지.

### `hooks/update-index.sh` (PostToolUse — memsearch auto-index 대체)

- **트리거**: `materials/**/*.md` Write/Edit (단 `_wiki/` 제외).
- **동작** (백그라운드, 비차단):
  1. 변경 노트 frontmatter 파싱 (id/type/tags/summary).
  2. `_wiki/INDEX.md`의 해당 id 줄 갱신 (없으면 추가): `<id> | <type> | <tags> | <summary>`.
  3. tags 중 `_wiki/tags.md`에 없는 것 발견 시 stderr 경고
     (`⚠ 미등록 태그: <tag> — tags.md에 추가 필요`).
- 순수 bash + frontmatter 파싱 (yq 있으면 사용, 없으면 grep/sed fallback).
  memsearch/Docker 의존 제로.

### `_wiki/INDEX.md` (검색 ⑤단계 fallback 소스)

```markdown
# KB Index (auto-generated — 직접 편집 금지)
- transformer-attention | research | [attention,transformer] | 트랜스포머의 어텐션 메커니즘 정의와 변형
- ddpm-basics | extract | [diffusion] | DDPM 논문 원문 추출, p.1-12
```

수백 노트까지 ~20K토큰 — Claude 창에 통째 로드해 LLM이 직접 선택 가능.

## 변경 범위 (구현 단계)

memsearch는 이미 optional(`command -v memsearch || exit 0` graceful skip) 구조라 하드
의존이 아니다. 신규 파일 외 수정 대상:

| 파일 | 규모 |
|---|---|
| `hooks/auto-index.sh` + `hooks.json` | 삭제 → update-index.sh로 교체 |
| `scripts/extract.sh` | memsearch 블록 제거 + OC frontmatter 자동생성 추가 |
| `skills/kb-search/SKILL.md` | 검색 규칙 재작성, 명령 매핑 교체, index/watch 삭제 |
| `agents/topic-researcher.md` | 도구 우선순위 1항을 recall 3단계로, 출처표기 `kb:hash`→`kb:경로#섹션` |
| `agents/solution-planner.md` | memsearch 검색 1줄 교체 |
| `agents/question-generator.md` | 입력 스펙 "memsearch expand 결과" → "노트 경로 목록" |
| `skills/learn-chat/SKILL.md` | memsearch 호출 → Grep/Glob 절차, `recent` → log.md 참조 |
| `skills/deep-research/SKILL.md`, `skills/deep-question/SKILL.md` | 동일 패턴 1~3줄씩 |
| (신규) `templates/note-*.md` ×4, `hooks/update-index.sh` | 신규 작성 |

## 미해결 / 후속

- ~~**OC fs_* grep/glob 가용성 실측**~~ — **완료 (2026-06-02)**. glob 입력 analyze 위임이
  `status: done`으로 성공, OC가 grep/glob 자체 수행 확인. 검색 ①②를 OC에 위임 가능.
- **하이브리드 fallback(선택)** — 검색 ⑤로도 miss 시 로컬 bge-m3 임베딩을 *선택적*으로
  붙이는 경량 hybrid. 코퍼스가 수백 문서를 크게 넘을 때만 고려. 현재 범위 제외(YAGNI).
- **기존 memsearch 인덱스 마이그레이션** — 기존 사용자는 재인덱싱 불필요(노트 파일은 그대로,
  frontmatter만 보강). 보강 스크립트 제공 여부 후속 결정.
