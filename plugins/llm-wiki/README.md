# llm-wiki

Obsidian 볼트를 [Karpathy LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 패턴으로 운영하는 Claude Code 인터페이스. **런타임 의존성이 없다.** 스키마 규칙은 플러그인이 아니라 **볼트 루트의 `SCHEMA.md`(SSoT)** 가 정의하며, 플러그인은 그 규칙을 읽고 따르도록 강제한다. hermes agent의 `llm-wiki` 스킬과 같은 볼트를 같은 컨벤션으로 공유한다.

## 아키텍처: 3계층

```
$WIKI/
├── SCHEMA.md      # Layer 3: 컨벤션·frontmatter·태그 택소노미·페이지 기준 (SSoT)
├── index.md       # 섹션별 콘텐츠 카탈로그 (한 줄 요약)
├── log.md         # 연산 이력 (append-only, 끝에 추가)
├── raw/           # Layer 1: 불변 원본 소스 (articles/papers/transcripts)
├── entities/      # Layer 2: 엔티티 페이지 (도구, 조직, 인물)
├── concepts/      # Layer 2: 개념/주제 페이지
├── comparisons/   # Layer 2: A vs B 분석
└── queries/       # Layer 2: 보존 가치 있는 질의 결과
```

## 볼트 경로

```bash
WIKI="${WIKI_PATH:-$OBSIDIAN_VAULT_PATH}"
```

`WIKI_PATH` 우선 (hermes `~/.hermes/.env`와 동일 변수), 없으면 `OBSIDIAN_VAULT_PATH` 폴백. SessionStart 훅이 경로와 `SCHEMA.md` 존재를 검증한다.

## 커맨드 (llm-wiki Core Operations 대응)

| 커맨드 | llm-wiki 연산 | 설명 |
|--------|--------------|------|
| `/llm-wiki:capture <URL 또는 제목>` | Ingest | raw/ 캡처(sha256 dedup) → 기존 페이지 확인 → 페이지 생성/갱신 → index/log |
| `/llm-wiki:recall <키워드>` | Query | Grep 전수검색 → 후보 합성 → 가치 있으면 queries/에 파일링 |
| `/llm-wiki:research <주제>` | Ingest(research) | research-agent로 외부 조사 → 위키 페이지 작성 |
| `/llm-wiki:lint [--fix]` | Lint | orphans/doctor CLI + frontmatter·모순·raw drift·태그 위반·로그 회전 |

## 검색: CC 내장 Grep 전수검색

전용 검색 CLI(Bun + Orama + ONNX)는 **제거되었다**(v0.7.0). 볼트 마크다운 총량이 8.5MB로
`rg` 전수검색이 0.02초에 끝나므로 인덱스가 필요 없고, 인덱스를 두는 순간 3플랫폼 무설치
원칙이 깨진다.

- **검색** = CC 내장 Grep. `index.md` 등재 여부와 무관하게 파일시스템 전체가 대상이다.
- **잃은 것**: 시맨틱 유사도·rerank·한국어 형태소 분석. 무설치로는 불가하므로 수용한다.
- 제거된 스택의 원본은 git 히스토리에 있다(`git show f3def78:plugins/llm-wiki/src/cli.ts`).

## 런타임 의존성

**없다.** 읽기·검색·페이지 작성은 CC 내장 도구만 쓰고, 정비용 lint는 의존성 0인 Node
`.mjs` 단일 파일로 동작한다. 무거운 작업(문서 변환·외부 리서치)만 설치형이며 환경 가드로
분리된다.

## 스킬

| 스킬 | 설명 |
|------|------|
| wiki-schema | 볼트 쓰기 전 자동 적용 — SCHEMA.md 오리엔테이션 강제, 레이어 구분(raw 불변), 교차참조(최소 2 outbound + 역링크 5), index/log 갱신, Update Policy(모순 병기) |

## 에이전트

| 에이전트 | 설명 |
|----------|------|
| research-agent | 볼트 검색 → 외부 조사 → SCHEMA.md 준수 페이지 작성 → 역링크/index/log 갱신까지 자율 수행 |

## 스키마 (볼트 SCHEMA.md가 정의 — 아래는 현재 값 요약)

- **type**: `entity | concept | comparison | query | summary` → type별 디렉토리에 저장
- **frontmatter**: `title / created / updated / type / tags / sources` + 선택 `confidence / contested / contradictions`
- **태그**: SCHEMA.md 택소노미에 있는 것만. 새 태그는 택소노미에 먼저 추가
- **Page Thresholds**: 2+ 소스 등장 또는 단일 소스 중심 주제일 때만 신규 페이지, 200줄 초과 시 분리
- **Update Policy**: 모순은 양쪽 병기 + `contested`/`contradictions` 표기, lint가 검토 목록으로 표면화
- **raw/ frontmatter**: `source_url / ingested / sha256` — 재ingest 시 dedup·drift 감지

이 값들이 바뀌면 SCHEMA.md가 우선이다. 플러그인 문서를 고칠 필요 없이 SCHEMA.md만 수정하면 된다.

## hermes llm-wiki와의 관계

hermes agent(`~/.hermes/skills/research/llm-wiki`)가 같은 볼트를 같은 SCHEMA.md로 운영한다. 이 플러그인은 그 컨벤션의 Claude Code 측 구현체다 — 어느 쪽이 쓰든 같은 위키가 자란다.

## 디렉토리 구조

```
plugins/llm-wiki/
├── .claude-plugin/plugin.json   # CC 플러그인 메타데이터
├── commands/                     # 슬래시 명령어
├── skills/                       # SKILL.md
├── agents/                       # 서브에이전트
└── hooks/                        # SessionStart (볼트 검증만)
```

OpenCode 겸용(`src/index.ts` 어댑터)은 v0.7.0에서 제거했다 — Claude Code 전용이다.
