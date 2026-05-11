# obsidian-knowledge

Obsidian 볼트 기반 LLM Wiki — 엔티티 타입 분류, 출처 추적, 교차참조, 위키 건강점검으로 지식을 복리 축적한다.

## 아키텍처

Karpathy의 [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 패턴을 적용한 3계층 구조:

| 계층 | 역할 | 소유자 |
|------|------|--------|
| **Raw Sources** | 원본 문서, URL, 대화 (불변) | 사용자 |
| **Wiki** | LLM이 생성·유지하는 마크다운 노트 | LLM |
| **Schema** | wiki-schema 스킬 — 타입 분류, 출처 추적, 교차참조 규칙 | 사용자 + LLM |

## 커맨드

| 커맨드 | 설명 |
|--------|------|
| `/obsidian-knowledge:capture <노트 제목 또는 URL>` | 대화 지식 또는 웹 페이지를 볼트에 저장 (Ingest) |
| `/obsidian-knowledge:recall <검색 키워드>` | 볼트에서 관련 노트를 검색하여 컨텍스트에 주입 (Query) |
| `/obsidian-knowledge:research <조사할 주제>` | 주제를 조사하여 리서치 노트를 작성 |
| `/obsidian-knowledge:lint [--fix]` | 위키 건강 점검 — 고아 페이지, 깨진 링크, 태그 불일치, stale 노트, 누락 개념, frontmatter 결함 |

## 스킬

| 스킬 | 설명 |
|------|------|
| wiki-schema | 볼트에 노트를 쓸 때 자동 적용 — 엔티티 타입 분류, 출처 추적, 교차참조 강제, 모순 감지 |

## 에이전트

| 에이전트 | 설명 |
|----------|------|
| research-agent | Obsidian 볼트 검색 → 외부 조사 → 문서 작성 → 교차참조 삽입까지 자율 수행. v0.3.0부터 cc-opencode-cmux 가용 시 외부 조사 + 문서 작성을 OpenCode에 위임 (CC 토큰 70%+ 절감, 자동 fallback) |

## OC 위임 모드 (v0.3.0+)

`cc-opencode-cmux` 플러그인이 함께 설치 + 인증되어 있으면, `research` (및 향후 `capture`, `lint`)가 자동으로 OpenCode에 외부 조사·문서 작성을 위임한다.

### 3-tier 자동 감지

| 우선순위 | 조건 | 모드 |
|---|---|---|
| 1 | `/tmp/cc-oc-serve.env` + daemon health 200 | `oc` (warm, 가장 빠름) |
| 2 | `opencode` CLI + 인증 OK, daemon 미기동 | `oc-coldstart` (자동 serve-start) |
| 3 | 위 둘 다 아님 | `cc-only` (기존 동작, 회귀 없음) |

### 명시적 override

```bash
/obsidian-knowledge:research "주제" --cc-only   # CC 직접 (품질 모드)
/obsidian-knowledge:research "주제" --oc-only   # OC 위임 강제 (미가용 시 에러)
```

### 토큰 절감 패턴

- CC: spec 작성 + raw research 검토 + 백링크/index/log 갱신 (~5–15K)
- OC: WebSearch/WebFetch + 노트 본문 작성 (~30–150K, OC 잔액에서 차감)

CC 세션 토큰 사용량 기존 50–200K → 5–15K (~90% 절감 예상).

### 도메인 책임 분리

위임해도 다음은 CC가 직접 수행 (외부 디렉토리 동시 수정 위험 방지):
- 백링크 5개 Edit
- `_wiki/index.md` 갱신
- `_wiki/log.md` append
- frontmatter 검증

## 엔티티 타입

노트 생성 시 콘텐츠를 분석하여 7가지 타입 중 하나로 분류하고, 해당 템플릿을 적용한다:

| 타입 | 용도 |
|------|------|
| `library` | npm/pip 패키지, 프레임워크, SDK, API |
| `concept` | 추상 아이디어, 디자인 패턴, 방법론 |
| `comparison` | A vs B 비교, 트레이드오프 분석 |
| `person` | 인물, 연구자, 저자, 조직 |
| `source-summary` | 아티클, 논문, 책, 영상 요약 |
| `project` | 코드베이스, 프로덕트, 서비스 |
| `journal` | 일지, 회고, 세션 노트 |

## 볼트 관리 파일

capture/research/lint 연산 후 자동 갱신:

| 파일 | 역할 |
|------|------|
| `_wiki/index.md` | 카테고리별 노트 카탈로그 — recall 시 먼저 참조하여 토큰 절약 |
| `_wiki/log.md` | 연산 이력 (최신순) — 언제 무엇을 했는지 추적 |

## 출처 추적 (Source Provenance)

외부 소스에서 생성한 노트는 `source_hash` (sha256 앞 8자리)를 frontmatter에 기록한다. lint 시 원본을 다시 가져와 해시를 비교하여 stale 노트를 감지한다.
