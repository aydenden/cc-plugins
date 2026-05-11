# cc-opencode-cmux Plugin Design

- **날짜**: 2026-05-11
- **저자**: aydenden (Korean)
- **상태**: design 확정, 구현 진입 직전
- **관련 노트**:
  - [[2026-05-11-claude-opus-opencode-cmux-orchestration-workflow]]
  - [[2026-05-11-claude-pro-opencode-go-budget-workflow]]
  - [[2026-05-11-cc-opencode-cmux-existing-tools-survey]]
  - [[2026-05-04-opencode-cli-spec-for-cmux-integration]]

---

## 1. 정체성 및 차별점

**플러그인 이름**: `cc-opencode-cmux`
**버전**: 0.1.0
**한 줄 정의**: Claude Code Opus(오케스트레이터) + OpenCode(저렴 모델 구현 실행기) + cmux(병렬 세션 시각화) 3-tool 하이브리드 위임 플러그인.

### 차별점 매트릭스 (기존 8개 후보 대비)

| 차별점 | 기존 도구 상태 | 본 플러그인 |
|---|---|---|
| CC plugin marketplace 규격 | ❌ 미준수 | ✅ 첫 번째 |
| CLAUDE.md/AGENTS.md 위임 정책 템플릿 | ❌ 없음 | ✅ `templates/` |
| diff 자동 캡처 → Opus context 주입 | ❌ 수동 | ✅ PostToolUse hook |
| 작업 유형 기반 모델 자동 라우팅 | ⚠️ 수동만 | ✅ `bin/route-task.sh` |
| worktree 격리 옵션 | ❌ 없음 | ✅ worktree-task 연계 |
| cmux split + Bash 위임 하이브리드 (CC 중심) | ⚠️ cmux omo는 OC 중심 | ✅ CC 중심 |
| SSE 기반 hang 감지 | ❌ timeout 수동만 | ✅ `bin/oc-watch.sh` |
| 작업별 권한 차등(OPENCODE_PERMISSION) | ❌ 일괄 | ✅ `config/perm-*.json` |

### 비목표 (YAGNI)

- ❌ codex 통합 (직전 `codex-opencode-cmux` 담당, 의도적 제외)
- ❌ MCP 래핑 (미성숙, opencode-cmux 노트 #168)
- ❌ Claude API 키 OC 주입 (OAuth 차단 정책 준수)
- ❌ GUI/대시보드
- ❌ opencode 내부 버그 직접 패치 (upstream 의존)
- ❌ `--dangerously-skip-permissions` 패스스루 (위험)

---

## 2. 컴포넌트 구조

```
plugins/cc-opencode-cmux/
├── .claude-plugin/plugin.json
├── README.md
├── commands/
│   ├── delegate.md            # /cc-opencode-cmux:delegate "<task>" [--type T] [--worktree]
│   ├── review-diff.md         # /cc-opencode-cmux:review
│   ├── status.md              # /cc-opencode-cmux:status (활성 세션 + SSE 진행)
│   ├── serve-start.md         # /cc-opencode-cmux:serve-start
│   └── serve-stop.md
├── skills/
│   ├── delegate-oc/SKILL.md         # Opus 자율 위임 판단 가이드
│   └── oc-result-review/SKILL.md    # diff 캡처 후 리뷰 절차
├── agents/
│   └── oc-implementer.md            # CC thin wrapper (Bash → safe-oc.sh)
├── hooks/
│   ├── hooks.json
│   ├── session-start.sh             # opencode/cmux 검증, env 체크, serve 자동 기동 옵션
│   └── post-oc-run.sh               # PostToolUse: git diff 캡처
├── bin/
│   ├── safe-oc.sh                   # 표준 호출 템플릿
│   ├── oc-serve-start.sh            # 데몬 시작 (127.0.0.1, server password)
│   ├── oc-serve-stop.sh
│   ├── oc-watch.sh                  # SSE 구독 + 3-tier hang 감지
│   ├── route-task.sh                # task 분류 → agent + perm JSON
│   ├── cmux-spawn.sh                # cmux split (또는 tmux fallback)
│   └── worktree-dispatch.sh         # worktree-task 연계
├── config/
│   ├── opencode.json.template
│   ├── perm-implement.json
│   ├── perm-refactor.json
│   ├── perm-summarize.json
│   └── perm-cjk-doc.json
├── templates/
│   ├── CLAUDE.md.snippet
│   └── AGENTS.md.snippet
├── examples/
│   ├── basic-delegate.md
│   └── worktree-isolated.md
└── settings/
    └── cc-opencode-cmux.local.md.example
```

---

## 3. 위임 메커니즘 결정 사항

| 결정 사항 | 값 | 근거 |
|---|---|---|
| 위임 메커니즘 | **`opencode serve` 데몬 + `--attach`** + SSE 구독 | cold start 75s → 1-3s (CLI 조사) |
| 위임 트리거 | 명시적 슬래시 명령 + CLAUDE.md 정책 가이드 | 사용자 결정 |
| 결과 검증 | diff 자동 리뷰 + worktree 옵션 | 사용자 결정 |
| 모델 라우팅 | task 키워드 자동 (override 가능) | 사용자 결정 |
| 자산 처리 | 완전 새로 작성 (직전 `codex-opencode-cmux`와 분리) | 사용자 결정 |
| 프롬프트 전달 | stdin pipe + `--file` 첨부 (shell escape 회피) | CLI 조사 |
| 권한 부여 | `OPENCODE_PERMISSION` env JSON (CLI 플래그 없음) | CLI 조사 |
| 헤드리스 ask | **금지** (allow/deny binary만) | hang 위험 #16367 |

---

## 4. 표준 데이터 플로우

```
[1] session-start hook
    └─ bin/oc-serve-start.sh
       ├─ check $OPENROUTER_API_KEY / $DEEPSEEK_API_KEY
       ├─ generate $OPENCODE_SERVER_PASSWORD (random)
       ├─ opencode serve --port 4096 --hostname 127.0.0.1 &
       └─ wait /global/health 200

[2] /cc-opencode-cmux:delegate "Implement OrderRepository"
    └─ commands/delegate.md
       ├─ task_type = bin/route-task.sh "Implement..."  → implement
       ├─ session_id = uuid
       ├─ /tmp/cc-oc-$session/prompt.md ← spec + AGENTS.md inject
       ├─ bin/cmux-spawn.sh "$session_id"
       └─ bin/safe-oc.sh implement $PWD /tmp/cc-oc-$session/prompt.md
           │
           ├─ OPENCODE_PERMISSION=$(< config/perm-implement.json) \
           │  opencode run \
           │    --attach http://127.0.0.1:4096 \
           │    --dir $PWD \
           │    --agent oc-implement \
           │    --format json \
           │    --title "[cc-bridge] implement $ts" \
           │    < /tmp/cc-oc-$session/prompt.md \
           │    > /tmp/cc-oc-$session/oc.ndjson
           │
           └─ 동시에 bin/oc-watch.sh $session_id (백그라운드)
               └─ curl -N http://127.0.0.1:4096/event
                   ├─ session.next.tool.called → reset tick
                   ├─ message.updated → reset tick
                   ├─ session.idle → 정상 종료, exit 0
                   ├─ session.error → 보고 후 exit 2
                   ├─ idle > soft → soft warn (cmux 노랑)
                   ├─ idle > hard → POST /session/$id/abort, exit 3
                   └─ step loop (5 step/60s, message 0B) → abort, exit 4

[3] post-oc-run hook (PostToolUse)
    ├─ git diff --stat > /tmp/cc-oc-$session/diff.txt
    ├─ git diff > /tmp/cc-oc-$session/diff.patch
    └─ stderr: "OC delegated. session=$id. diff at /tmp/cc-oc-$session/diff.patch"

[4] CC Opus 다음 턴
    ├─ Read /tmp/cc-oc-$session/diff.patch
    ├─ oc-result-review skill 가이드대로 검증
    └─ 문제 시 → 재위임 / 직접 수정

[worktree 분기] /cc-opencode-cmux:delegate "<task>" --worktree
    └─ bin/worktree-dispatch.sh
       ├─ worktree-task plugin: git worktree add ../wt-$ts -b oc/$ts
       ├─ cd 격리 worktree → safe-oc.sh 실행
       └─ 완료 후 Opus가 diff + 병합 결정 (수동)
```

---

## 5. 함정 대응 + Timeout 매트릭스

### 5.1 작업 유형별 Timeout 매트릭스

`safe-oc.sh`는 단일 timeout이 아닌 **SSE 능동 감지 + wall-clock safety net** 이중 구조.

| 작업 유형 | agent | 권장 모델 | wall-clock timeout | CC Bash 모드 | SSE inactivity hard hang |
|---|---|---|---|---|---|
| `summarize` | `oc-summarize` | gemini-3-flash (OC Zen) | 300s | 동기 | 60s |
| `single-file` (~100줄) | `oc-implement` | deepseek-v4-pro (OC Go) | 480s | 동기 | 90s |
| `refactor` (2~5 file) | `oc-refactor` | qwen3.6-plus (OC Go) | 600s | 동기 | 90s |
| `implement` (5+ file) | `oc-implement` | deepseek-v4-pro / sonnet | 1800s | `run_in_background` | 120s |
| `cjk-doc` | `oc-cjk-doc` | **gemini-3-flash → sonnet-4-5 → qwen3.6-plus** | 600s | 동기 | 90s |
| `batch` (unattended) | (분할 권장) | — | 3600s | 백그라운드 + log tail | 180s |

### 5.2 함정 대응 매트릭스

| # | 함정 | 대응 |
|---|---|---|
| 1 | hang #16367 / #17516 / #26220 | SSE `/event` 3-tier 감지 → `POST /session/$id/abort` |
| 2 | 컨텍스트 핸드오프 손실 | stdin pipe + `--file` 첨부 |
| 3 | 파일 동시 수정 충돌 | `--worktree` 옵션 + flock |
| 4 | OC auto memory 없음 | `templates/AGENTS.md.snippet` 자동 주입 + `--continue`/`-s` 세션 재사용 |
| 5 | Claude OAuth 차단 | model 화이트리스트 (BYOK API 키 또는 OC Zen 한정) |
| 6 | sub-session model override 버그 #23909 | `--agent` 사전정의된 agent만 사용, sub-agent 비활성 |
| 7 | 디버깅 어려움 | `--format json` ndjson + diff 자동 캡처 + SSE 실시간 |
| 8 | cmux 버전 의존 #2085, #2712 | `cmux-spawn.sh` fallback 체인 (cmux → tmux → 직접) |
| 9 | 헤드리스 `ask` hang | `OPENCODE_PERMISSION` allow/deny binary만, `ask` 금지 |
| 10 | `--dangerously-skip-permissions` 위험 | plugin이 strip, 패스스루 절대 금지 |
| 11 | cold start 75초 | `opencode serve` + `--attach` 데몬 재사용 |
| 12 | MCP 과적재 context overflow | per-agent `tools: { "*_*": false, "needed_*": true }` |

---

## 6. 권한 / 모델 매트릭스 (config/)

### 6.1 작업 유형별 agent 정의 (`config/opencode.json.template`)

```jsonc
{
  "agent": {
    "oc-implement": {
      "model": "openrouter/deepseek/deepseek-v4-pro",
      "tools": { "*_*": false, "fs_*": true, "git_*": true },
      "prompt": "{file:./prompts/oc-implement.md}"
    },
    "oc-refactor": {
      "model": "openrouter/qwen/qwen3.6-plus",
      "temperature": 0.1,
      "tools": { "*_*": false, "fs_*": true, "lsp_*": true }
    },
    "oc-summarize": {
      "model": "opencode/gemini-3-flash",
      "tools": { "*_*": false, "fs_*": true, "websearch_*": true }
    },
    "oc-cjk-doc": {
      "model": "opencode/gemini-3-flash",
      "fallback_models": [
        "opencode/claude-sonnet-4-5",
        "openrouter/qwen/qwen3.6-plus"
      ],
      "temperature": 0.3,
      "tools": { "*_*": false, "fs_*": true }
    }
  }
}
```

### 6.2 작업별 권한 JSON

**`config/perm-implement.json`**:
```json
{
  "edit": { "*": "allow", "*.env*": "deny", "**/secrets/**": "deny" },
  "bash": {
    "*": "deny",
    "git status*": "allow", "git diff*": "allow", "git log*": "allow",
    "npm test*": "allow", "npm run *": "allow",
    "cargo test*": "allow", "cargo check*": "allow", "cargo build*": "allow",
    "ls *": "allow", "cat *": "allow", "rg *": "allow", "fd *": "allow"
  },
  "webfetch": "deny",
  "websearch": "deny",
  "external_directory": "deny",
  "task": "deny"
}
```

**`config/perm-refactor.json`**: bash 전체 deny, lsp allow, edit allow, web deny
**`config/perm-summarize.json`**: edit deny, bash deny, read/grep/glob allow, webfetch `https://docs.*` allow
**`config/perm-cjk-doc.json`**: edit는 `**/*.md` / `**/*.mdx` 만, bash deny, read allow

### 6.3 모델 선정 근거 (cjk-doc)

| 우선 | 모델 | KMMLU | LMSYS Korean | 단가 ($/M) | 비고 |
|---|---|---|---|---|---|
| Primary | Gemini 3 Flash (OC Zen) | 75~77 | 1~3위 | $0.50 / $3.00 | 한국어 자연스러움 1위, 단가 Sonnet 1/6 |
| Fallback A | Claude Sonnet 4.5 | 79 | — | $3.00 / $15.00 | LogicKor 글쓰기/이해 단독 1위 |
| Fallback B | Qwen3.6 Plus (OC Go) | ~74 | — | OC Go 정액 포함 | 비용 0, 경제 모드 |

---

## 7. 테스트 전략

### 7.1 Unit (bin/ 스크립트)
- `route-task.sh`: 키워드 분류 정확도 (구현/리팩터/요약 샘플 30개)
- `safe-oc.sh`: mocked opencode (stdin/file/perm env 검증)
- `oc-watch.sh`: SSE 이벤트 시퀀스 fixture로 3-tier 판정 검증
- `cmux-spawn.sh`: cmux/tmux 없는 환경 fallback

### 7.2 Integration
- `examples/basic-delegate.md` 실제 실행, exit code 0
- worktree 옵션: 격리 디렉토리에서 diff 확인
- hang 시뮬레이션: SSE 이벤트 90초 멈추는 mock 서버 → abort 호출 검증

### 7.3 Smoke
- session-start hook이 데몬 기동 + health check
- 빈 spec 거부
- API key 누락 시 user-facing 안내

### 7.4 E2E (수동)
- 실제 OpenRouter 키로 단순 리팩터 위임 → diff 자동 캡처 → Opus 리뷰 진행

---

## 8. 마켓플레이스 등록

`.claude-plugin/marketplace.json`의 `plugins` 배열에 추가:

```json
{
  "name": "cc-opencode-cmux",
  "source": "./plugins/cc-opencode-cmux",
  "description": "CC Opus + OpenCode + cmux 3-tool 하이브리드 위임 플러그인. SSE 기반 hang 감지, 작업별 권한 차등.",
  "version": "0.1.0"
}
```

---

## 9. 구현 진입 체크리스트

- [ ] `plugins/cc-opencode-cmux/.claude-plugin/plugin.json` (manifest)
- [ ] `bin/safe-oc.sh` (표준 호출 템플릿)
- [ ] `bin/oc-watch.sh` (SSE 3-tier hang 감지)
- [ ] `bin/oc-serve-start.sh` / `oc-serve-stop.sh`
- [ ] `bin/route-task.sh` (분류 로직)
- [ ] `bin/cmux-spawn.sh` (cmux/tmux fallback)
- [ ] `bin/worktree-dispatch.sh`
- [ ] `config/opencode.json.template`
- [ ] `config/perm-*.json` (4종)
- [ ] `commands/*.md` (5개)
- [ ] `skills/*/SKILL.md` (2개)
- [ ] `agents/oc-implementer.md`
- [ ] `hooks/hooks.json` + 셸 스크립트 2개
- [ ] `templates/CLAUDE.md.snippet` + `AGENTS.md.snippet`
- [ ] `examples/*.md` (2개)
- [ ] `settings/cc-opencode-cmux.local.md.example`
- [ ] `README.md`
- [ ] `marketplace.json` 갱신

---

## 10. 출처

- [OpenCode CLI docs](https://opencode.ai/docs/cli/)
- [OpenCode Server docs](https://opencode.ai/docs/server/) — SSE `/event` 엔드포인트
- [OpenCode permissions](https://opencode.ai/docs/permissions/) — `OPENCODE_PERMISSION` env, allow/deny binary
- [OpenCode MCP per-agent](https://opencode.ai/docs/mcp-servers/#per-agent)
- [OpenCode Go plan](https://opencode.ai/go) — 12종 모델 단가
- [OpenCode Zen pricing](https://opencode.ai/docs/zen/) — Gemini 3 Flash 등
- [opencode-cmux 참고 모델](https://github.com/0xCaso/opencode-cmux) — plugin SDK lifecycle hook
- [Issue #16367 ask hang](https://github.com/anomalyco/opencode/issues/16367)
- [Issue #17516 step loop hang](https://github.com/anomalyco/opencode/issues/17516)
- [Issue #26220 infinite loop](https://github.com/anomalyco/opencode/issues/26220)
- [PR #24762 SSE chunkTimeout](https://github.com/anomalyco/opencode/pull/24762)
- [LMSYS Chatbot Arena Korean](https://allaboutlog.com/한국어-잘하는-ai-모델-순위-top-5/)
- [BenchLM Korean LLM Leaderboard](https://benchlm.ai/leaderboards/korean-llm)
