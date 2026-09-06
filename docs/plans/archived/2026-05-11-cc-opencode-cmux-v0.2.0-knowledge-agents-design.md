# cc-opencode-cmux v0.2.0 — Knowledge Agents 분리 설계

- **날짜**: 2026-05-11
- **상태**: design 진행 중
- **선행**: v0.1.0 (코드 작업 4종 — implement/refactor/summarize/cjk-doc)
- **목표**: 지식 작업 3종(research/compose/analyze) 범용 능력으로 추가, 도메인 플러그인(obsidian-knowledge 등)이 약결합으로 호출

---

## 1. 설계 원칙

### 1.1 Port/Adapter — 도메인 의존 단방향

```
obsidian-knowledge ──delegate──> cc-opencode-cmux
                                       │
korean-trading ────delegate────────────┤
                                       │
pm ────────────delegate────────────────┘

cc-opencode-cmux는 호출자의 도메인을 모른다.
호출자가 spec + 작업 디렉토리를 전달, OC가 그 안에서만 작동.
```

### 1.2 SRP — 단계별 책임 분리

| 단계 | 책임 | 외부 I/O |
|---|---|---|
| **research** | 외부 자료 수집 + 구조화 | webfetch, websearch (read-only) |
| **compose** | spec + 자료 → 문서 작성 | edit (--dir 지정) |
| **analyze** | 문서 모음 → 분석/비교/평가 | read-only (--dir 지정) |

각 단계는 자기 책임만 수행. 호출자가 단계 간 데이터 전달.

### 1.3 호출자가 컨텍스트 책임짐

cc-opencode-cmux는 wiki schema도 모르고 OBSIDIAN_VAULT_PATH도 모른다.
호출자(obsidian-knowledge)가 다음을 spec에 인라인:
- 도메인 규칙 (예: wiki schema, 엔티티 타입, frontmatter)
- 작업 디렉토리 (`--dir $OBSIDIAN_VAULT_PATH`)
- 출력 위치 (spec 내 명시)
- 사후 처리 (백링크 삽입, index 갱신)는 호출자가 직접

---

## 2. 추가 컴포넌트 (cc-opencode-cmux 측)

### 2.1 신규 task type 3종

| Task type | Agent | 권장 모델 (OC Go) | Hybrid 옵션 (OC Zen) |
|---|---|---|---|
| `research` | `oc-research` | `opencode-go/deepseek-v4-pro` (ctx 1M) | `opencode/gemini-3.1-pro` |
| `compose` | `oc-compose` | `opencode-go/qwen3.6-plus` (글쓰기 + 한국어) | `opencode/gemini-3-flash` / `opencode/claude-sonnet-4-5` |
| `analyze` | `oc-analyze` | `opencode-go/kimi-k2.6` (긴 reasoning) | `opencode/claude-sonnet-4-5` |

### 2.2 신규 권한 JSON

**`config/perm-research.json`** — 외부 read + 출력은 stdout만
```jsonc
{
  "webfetch": "allow",
  "websearch": "allow",
  "read": "allow",
  "grep": "allow",
  "glob": "allow",
  "edit": "deny",
  "bash": {
    "*": "deny",
    "ls *": "allow",
    "cat *": "allow",
    "shasum *": "allow"
  },
  "task": "deny",
  "question": "deny"
}
```

**`config/perm-compose.json`** — edit 허용(작업 디렉토리), 외부 read 차단
```jsonc
{
  "webfetch": "deny",
  "websearch": "deny",
  "read": "allow",
  "grep": "allow",
  "glob": "allow",
  "edit": {
    "*": "allow",
    "*.env*": "deny",
    "**/.git/**": "deny",
    "**/secrets/**": "deny"
  },
  "bash": {
    "*": "deny",
    "shasum *": "allow",
    "ls *": "allow"
  },
  "task": "deny",
  "question": "deny"
}
```

**`config/perm-analyze.json`** — 완전 read-only
```jsonc
{
  "webfetch": "deny",
  "websearch": "deny",
  "read": "allow",
  "grep": "allow",
  "glob": "allow",
  "edit": "deny",
  "bash": "deny",
  "task": "deny",
  "question": "deny"
}
```

### 2.3 `bin/route-task.sh` 확장

키워드 매칭 추가:
- `research|investigate|조사|찾아` → research
- `write|compose|draft|작성|초안` → compose
- `analyze|compare|evaluate|분석|비교|평가` → analyze

### 2.4 `safe-oc.sh` 매트릭스 확장

| Task | wall-clock | hard-hang | CC mode |
|---|---|---|---|
| research | 1200s | 150s | foreground |
| compose | 900s | 120s | foreground |
| analyze | 900s | 120s | foreground |

### 2.5 `commands/delegate.md` — 변경 없음

이미 `--type T` 옵션이 있으니 신규 type 그대로 지원.

### 2.6 `examples/` 추가

- `examples/knowledge-pipeline.md` — research → compose 2단계 위임 예시 (도메인 무관)
- `examples/multi-doc-analyze.md` — analyze로 여러 문서 비교 예시

---

## 3. obsidian-knowledge 측 변경 (v0.3.0 가정)

### 3.1 `agents/research-agent.md` 재구성

**현재**: 11단계 모놀리식 (검색 → 외부조사 → 작성 → 백링크 → index → log)

**변경 후**: 5단계 오케스트레이션 + 2회 위임

```
[CC Sonnet/Opus] 1. 볼트 frontmatter 검색 (Grep/Glob, 5%)
[CC]            2. 매칭 노트 본문 Read (10%)
                   → 충분히 관련 노트 있으면 즉시 종료 (외부 조사 생략)
[CC]            3. 외부 조사 spec 작성 (research_spec.md)
                   → 어떤 자료 모을지, 어떤 출처가 신뢰할 만한지, 출력 schema
[delegate]      4. /cc-opencode-cmux:delegate "<research_spec>" --type research --dir <tmp>
                   → OC가 WebSearch/WebFetch + raw_research.md 작성
[CC]            5. raw_research 검토 (간단, 50줄 이내) — 누락/거짓 체크
[CC]            6. compose spec 작성 (template 선택 + frontmatter 결정 + entity type)
[delegate]      7. /cc-opencode-cmux:delegate "<compose_spec + raw>" --type compose --dir $VAULT
                   → OC가 wiki template 따라 노트 작성 (Write)
[CC]            8. 백링크 5개 Edit + _wiki/index.md + log.md 갱신 (가벼움, CC 직접)
[CC]            9. 결과 요약 반환
```

토큰 비교 (예상):
- 현재: CC가 WebFetch 본문까지 모두 처리 ~50-200K tokens
- 변경 후: CC는 spec + 결과 요약만 ~5-15K tokens (90%+ 절감)

### 3.2 obsidian-knowledge 신규 명령 (선택)

기존 `/obsidian-knowledge:research`는 보존(품질 모드). 신규 추가:

- `/obsidian-knowledge:research-oc` — OC 위임 모드 (저비용)
- `/obsidian-knowledge:capture-oc` — capture를 compose로 위임
- `/obsidian-knowledge:lint-oc` — lint를 analyze로 위임

또는 기존 명령을 default OC 위임으로 전환하고 `--cc-only` 옵션으로 품질 모드 유지.

### 3.3 wiki schema 인라인 전략

`research_spec.md`, `compose_spec.md`에 다음 인라인 (호출자가 spec 작성 시):

```
WIKI SCHEMA (필수 준수):
- frontmatter: type, tags, summary, date, source, source_hash, confidence
- 엔티티 타입 7종: library | concept | comparison | person | source-summary | project | journal
- source_hash 생성: echo -n "<본문 첫 500자>" | shasum -a 256 | cut -c1-8
- confidence: 공식 문서/Context7=high, 블로그=medium, 포럼/LLM=low
- 한국어 작성 (기술 용어 영문 허용)
- .obsidian/ 폴더 수정 금지
```

→ OC는 이 스니펫만 보고도 schema 준수 가능. wiki-schema 스킬에 의존 X.

---

## 4. 다른 플러그인 활용 시나리오 (강결합 회피 검증)

### 4.1 korean-trading: 종목 리서치

```
/korean-trading:research-stock 005930
  └─ [CC] 가격/재무 API 호출
  └─ /cc-opencode-cmux:delegate "<external research spec>" --type research
      └─ OC: 뉴스/공시/애널리스트 리포트 수집
  └─ /cc-opencode-cmux:delegate "<compose spec + raw>" --type compose --dir reports/
      └─ OC: 한국어 리서치 리포트 작성
  └─ [CC] 검토 + DB 저장
```

### 4.2 pm: PRD 작성

```
/pm:prd "기능명"
  └─ [CC] beads epic 검색 (관련 컨텍스트)
  └─ /cc-opencode-cmux:delegate "<PRD outline + epic context>" --type compose --dir .planning/
      └─ OC: PRD 마크다운 작성
  └─ [CC] beads epic 생성 + 링크
```

### 4.3 모든 플러그인 호출 패턴 통일

```
caller plugin
  ├─ spec 작성 (도메인 지식 + 출력 schema)
  ├─ /cc-opencode-cmux:delegate "<spec>" --type {research|compose|analyze} --dir <target>
  └─ 결과 처리 (도메인 사후 처리)
```

cc-opencode-cmux는 호출자가 누구인지 모름 → 강결합 회피.

---

## 5. v0.2.0 구현 체크리스트

### 5.1 cc-opencode-cmux 측

- [ ] `config/perm-research.json`
- [ ] `config/perm-compose.json`
- [ ] `config/perm-analyze.json`
- [ ] `config/opencode.json.template`에 oc-research / oc-compose / oc-analyze agent 추가
- [ ] `bin/route-task.sh` research/compose/analyze 키워드 분류
- [ ] `bin/safe-oc.sh` wall-clock 매트릭스에 3종 추가
- [ ] `bin/oc-watch.sh` SOFT/HARD threshold 매트릭스에 3종 추가
- [ ] `examples/knowledge-pipeline.md`
- [ ] `examples/multi-doc-analyze.md`
- [ ] `README.md` task type 표 갱신
- [ ] `skills/delegate-oc/SKILL.md`에 지식 작업 위임 가이드 섹션 추가
- [ ] `.claude-plugin/plugin.json` version 0.2.0
- [ ] `.claude-plugin/marketplace.json` version 0.2.0

### 5.2 obsidian-knowledge 측 (v0.3.0 별도 PR)

- [ ] `agents/research-agent.md` 5단계 + 2회 위임으로 재구성
- [ ] `commands/research.md` — research-agent 호출 방식 갱신
- [ ] (선택) 기존 동작 보존용 `--cc-only` 옵션 추가
- [ ] 토큰 사용량 측정 (before/after 비교)

### 5.3 검증

- [ ] cc-opencode-cmux 단독 단위 테스트: 3종 신규 task type smoke
- [ ] obsidian 통합 테스트: 신규 주제로 research → compose → 노트 생성 → 백링크 확인
- [ ] 다른 플러그인 호출 가능성 1개 이상 검증 (pm 또는 korean-trading)

---

## 6. 위험 + 대응

| 위험 | 대응 |
|---|---|
| OC가 wiki schema 누락 | spec acceptance test에 `head -30 <file>` + frontmatter 필드 grep 포함 |
| 한국어 노트 품질 | compose primary를 `qwen3.6-plus` (Go) → 품질 부족 시 `--model opencode/gemini-3-flash` hybrid 옵션 |
| external_directory 권한 | 호출자가 `--dir $VAULT_PATH` 명시 + perm-compose가 `*.env*` 등 deny |
| Context7 MCP 부재 (OC 측) | research 단계에서 Context7 호출은 CC가 사전 처리 후 spec에 inject (compose만 OC) |
| 백링크 누락 | CC가 직접 Edit (OC에 위임하지 않음) — Edit 5개는 가벼움 |
| raw_research → compose 핸드오프 손실 | research 결과를 파일 경로로 전달 (spec inline 금지) |

---

## 7. 출처

- v0.1.0 design: `docs/plans/2026-05-11-cc-opencode-cmux-design.md`
- obsidian-knowledge research-agent: `plugins/obsidian-knowledge/agents/research-agent.md`
- OpenCode `external_directory` 권한: https://opencode.ai/docs/permissions/
- Clean Architecture / Port-Adapter 원칙: 사용자 CLAUDE.md global 설정
