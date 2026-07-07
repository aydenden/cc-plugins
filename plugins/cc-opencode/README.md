# cc-opencode

Claude Code (Opus, orchestrator) → OpenCode (cheap-model implementer) 위임 플러그인.

**v0.11.0 (2026-07-08)**: transport를 REST(`opencode serve` + curl)에서 **ACP(Agent Client Protocol, stdio JSON-RPC)** 로 전환. REST가 구조적으로 불가능했던 **진행 스트리밍·hang 감지(stall watchdog)·비동기 권한 왕복**을 프로토콜 기본기능으로 확보했습니다. 컨트롤러의 무거운 일(세션·프롬프트·스트리밍·워치독)은 번들된 Node 클라이언트 `dist/acp-client.mjs`가 담당하고, `bin/oc-delegate.sh`는 셸 성격의 일(세션 디렉토리·모델 매핑·git diff·7줄 리포트)만 유지합니다. **외부 계약(7줄 리포트 + exit code, delegate-oc/oc-fanout 인터페이스)은 불변** — 의존 플러그인 무영향.

## 진입점 (총 2개, Skill 전용)

| 종류 | 이름 | 호출 |
|---|---|---|
| **Skill** | `cc-opencode:delegate-oc` | 메인 Opus 또는 다른 플러그인이 `Skill(cc-opencode:delegate-oc, args: "<spec>")`로 호출. 사용자가 `/cc-opencode:delegate-oc <spec>` 슬래시로도 호출 가능. |
| **Skill** | `cc-opencode:oc-result-review` | delegation 종료 후 diff 리뷰 워크플로. delegate-oc가 반환한 SESSION_DIR을 args로 전달. |

## 무엇을 하는가

`Skill(cc-opencode:delegate-oc, args)` 한 줄 호출 → 메인 Opus가 컨트롤러 1회 실행:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/oc-delegate.sh" --dir "$PWD" <<'EOF'
<spec body>
EOF
echo "$?"   # 약속된 exit code (0 / 11~13 / 20 / 30 / 31)
```

컨트롤러(`bin/oc-delegate.sh`) 내부에서 다음을 처리:

1. `$CLAUDE_PROJECT_DIR/.claude/oc-sessions/<uuid>/` SESSION_DIR 생성 (실패 시 `/tmp` 폴백)
2. spec을 `prompt.md`로 통합
3. `TASK_TYPE`(+ 스펙의 `MODEL:`/`VARIANT:` override) → opencode 모델 id 매핑
4. `node dist/acp-client.mjs …` 1회 실행 — **ACP 턴 전체를 담당하고 exit code를 소유**
5. `git diff` 스냅샷 + `grep -c` 카운트 (SESSION_DIR 출력 파일은 절대 Read 안 함)
6. 7줄 리포트 stdout 출력 + 클라이언트 exit code 전파

`dist/acp-client.mjs` 내부(ACP 클라이언트):

- `opencode acp --cwd D` **서브프로세스** spawn → stdio를 JSON-RPC Stream으로 래핑
- `initialize` 핸드셰이크 → `session/new(cwd)` → `session/set_model {modelId, variant}` → `session/prompt`
- **3개 확장점 핸들러**:
  - `session/update` 스트림 → 진행 sink(`sse.ndjson` 기록) + **stall watchdog**(update마다 타이머 리셋; N초 무응답 → `session/cancel`)
  - `session/request_permission` → 권한 정책(현재: auto-deny → `aborted-perm`)
  - 인터랙티브 질문(elicitation)은 뒤 단계 예정 — 현재 미등록
- turn 종료 시 stop reason을 exit code 계약으로 분류

메인 Opus 컨텍스트로 들어오는 것은 **7줄 리포트 + exit code 1개**뿐. session/update 델타, OC 텍스트, 툴콜은 전혀 들어오지 않음. 사후 검토는 `oc-result-review` Skill에서 의도적으로 수행.

### Exit code 계약

| Code | Status | 의미 |
|---|---|---|
| 0 | `done` | 정상 완료 (`end_turn` / `max_tokens`) |
| 11 | `error` | spawn / initialize / `session/new` 실패 |
| 12 | `error` | prompt 요청 거부 (transport/protocol) |
| 13 | `error` | agent가 error stop reason(`refusal`)으로 종료 |
| 20 | `aborted-perm` | 권한 요청 auto-deny → turn 취소 |
| 30 | `timeout` | `--timeout` 초과 (turn abort) |
| 31 | `stalled` | stall watchdog 발동: `--stall`초간 진행 없음 (hang 감지, turn 취소) |

> `31 stalled`가 이번 전환의 핵심. REST에서는 "hang"과 "그냥 오래 걸림"이 시간 외엔 구분 불가였으나, ACP는 `session/update` 스트림이 끊기면 hang이 자명해집니다.

## 왜 ACP인가 (REST의 구조적 한계)

| 문제 | REST (구) | ACP (v0.11.0) |
|---|---|---|
| 진행 가시성 / hang 감지 | `/event` SSE가 세션 생성 중 조용 → 불가 | `session/update` 스트리밍 → 무응답 N초 = hang 자명 |
| 권한 / 질문 | 동기 POST가 호출자 블록 | notification 기반 비동기 왕복 |
| 취소 | SIGTERM 해킹 | `session/cancel` 정식 |
| [#6573](https://github.com/sst/opencode/issues/6573) busy 고착 | REST 전용 발생 | 다른 코드 경로 (회피) |
| 우리 코드 | daemon·SSE watcher·sync-POST·SIGTERM (해킹 다수) | 프로토콜 기본기능 |

## 설치

```bash
# 1) opencode CLI 설치 + 핀 (opencode acp 서브커맨드 포함)
brew install opencode-ai/opencode/opencode
opencode upgrade 1.15.5            # 권장 핀

# 2) 인증 (OC Go / OC Zen / BYOK 중 하나)
opencode auth login                # TUI 메뉴

# 3) jq (서브에이전트 재라우팅 hook에 필요)
brew install jq
```

**런타임 의존성은 `node` 하나** — ACP 클라이언트는 단일 번들 `dist/acp-client.mjs`로 커밋되어 있어 사용자측 `npm install`이 없습니다. (개발자만 `bun`으로 재빌드 — 아래 "빌드/개발" 참조.)

세션 시작 시 `hooks/session-start.sh`가:
- opencode 설치·인증, `node` 존재, `dist/acp-client.mjs` 존재 사전 점검 (없으면 경고, 세션은 안 막음)
- 프로젝트의 `.claude/.gitignore`에 `oc-sessions/`가 없으면 자동 추가

> 모델은 `session/set_model {modelId, variant}`로 직접 지정됩니다(agent 인디렉션 없음). `delegate-oc`가 `TASK_TYPE`→모델을 매핑하고 스펙 `MODEL:`로 override, `VARIANT:`로 추론 강도(low|medium|high|max)를 선택합니다.

## 빌드 / 개발

ACP 클라이언트는 TypeScript(`src/acp-client.ts`)로 작성하고, 단일 JS로 번들해 커밋합니다.

```bash
cd plugins/cc-opencode
bun install          # dev 의존성(@agentclientprotocol/sdk, 타입) 설치
bun run build        # src/acp-client.ts → dist/acp-client.mjs (SDK 인라인, ~0.6MB)
bun run typecheck    # tsc --noEmit
```

- `dist/acp-client.mjs`는 **런타임 아티팩트라 반드시 커밋** (전역 `~/.gitignore`가 `dist`를 무시하므로 플러그인 `.gitignore`가 강제 포함).
- `node_modules/`는 dev 전용 — 배포 안 함.
- 소스를 고치면 `bun run build`로 dist를 재생성 후 커밋.

## 서브에이전트 자동 재라우팅 (v0.9.0, opt-in)

`PreToolUse` hook(`hooks/redirect-subagent.sh`)이 네이티브 서브에이전트 스폰(`Agent`/`Task` 툴)을
가로채, 무거운 서브에이전트를 OpenCode 위임으로 되돌립니다. 서브에이전트의 자체 추론 루프가
Max 쿼터를 소모하는 것을 막고, 그 작업을 저비용 OpenCode로 옮기는 것이 목적입니다.

**메커니즘**: hook은 툴 출력을 교체할 수 없으므로 스폰을 `deny`(exit 0 + JSON, 공식 권장 형식)하고,
`permissionDecisionReason`에 "`cc-opencode:delegate-oc` 스킬로 위임하라"는 지시 + 원본 프롬프트를
담아 되먹입니다. Claude가 이 사유를 읽고 스스로 재라우팅합니다.

**opt-in** — 미설정 시 아무 동작 안 함(다른 사용자 안전):

```bash
export CC_OC_REDIRECT_SUBAGENTS=1
```

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `CC_OC_REDIRECT_SUBAGENTS` | (없음) | `1`이면 재라우팅 활성화. 그 외/미설정 = 비활성 |
| `CC_OC_REDIRECT_TYPES` | `general-purpose,Plan` | 재라우팅할 `subagent_type` 목록(쉼표/공백 구분). **기본값은 CC 내장 에이전트만**(모든 사용자에게 존재) — 읽기전용 `Explore`는 의도적으로 제외. 프로젝트/플러그인 고유 에이전트는 이 변수로 환경별 추가 |
| `CC_OC_REDIRECT_MAX_DENY` | `2` | 동일 (세션·타입·description) 요청을 몇 번 deny한 뒤 포기하고 네이티브 실행을 허용할지. 무한 deny↔재시도 루프 방지 |

> **한계**: `deny` 사유를 Claude가 따르지 않을 수 있습니다(순응 의존). `CC_OC_REDIRECT_MAX_DENY`회
> 넛지 후에는 막지 않고 네이티브 실행을 허용합니다.

## opencode 버전 핀 (필수: v1.15.5)

`opencode acp` 서브커맨드가 안정 동작하는 버전으로 핀합니다.

- **v1.15.5** (권장): ACP protocolVersion 1, `session/set_model` 확장 지원, SSE/ask 회귀 픽스 완료.

자동 업데이트 비활성:
```jsonc
// ~/.config/opencode/opencode.json
{ "autoupdate": false, ... }
```

> **권한 주의**: opencode `build` 모드는 기본적으로 파일 쓰기에 permission을 묻지 않습니다(위임엔 바람직 — OC가 실제로 파일을 생성). 즉 `aborted-perm`(20)은 흔하지 않으며, 권한 통제가 필요하면 opencode permission config로 설정하세요.

## 위임 정책 (요약)

`delegate-oc` skill의 본문 정책. 다음이 모두 참이면 위임:

- 작업이 mechanical 또는 패턴 따라가기 (CRUD scaffold, rename, summarization, CJK 문서, structured research, document composition)
- 예상 출력 > 200 LOC 또는 > 5 파일
- 추론 얕음 — 아키텍처 결정 없음
- 사용자가 Opus 품질 명시 요청 안 함

### 토큰 예산 (사이징)

| 출력 유형 | 토큰/줄 | Safe 단일 delegate | Hard wall |
|---|---|---|---|
| 소스코드 | 50–80 | ≤ 1000 LOC | ~1100 |
| Markdown / 한국어 doc | 60–100 | ≤ 800 LOC | ~900 |
| JSONL / CSV fixture | 150–300 | ≤ 250 LOC | ~300 |
| Parquet / DB seed / binary | — | **never** | — |

> 70K 또는 binary → CC 메인이 fixture 먼저 생성, 그 후 fixture를 읽는 코드만 위임.

### Spec variants (TASK_TYPE별 필드)

`research` — 외부 정보 수집:

```
TASK_TYPE: research
TOPIC: <one-line>

KEY QUESTIONS:
- ...

SOURCE GUIDELINES:
- 공식 문서/1st-party/최신 자료 우선

OUTPUT SCHEMA:
- H2 per question, bullets with citations
- 각 fact: 주장 + 출처 URL + 조회일자
OUTPUT_FILE: <absolute path>
```

`--dir`는 writable scratch (예: `/tmp/cc-oc-scratch-<id>`). OC `research` 프로필은 webfetch/websearch 권한 있음.

`compose` — 주어진 research로 문서 렌더:

```
TASK_TYPE: compose
INPUT_RESEARCH: <absolute path to raw research markdown>
OUTPUT_FILE: <absolute path>

FRONTMATTER: <YAML schema>
BODY SECTIONS:
- <section 1>
- <section 2>

CONVENTIONS:
- <project rules>
- Do NOT edit files outside OUTPUT_FILE
```

`--dir`는 vault root 또는 OUTPUT_FILE이 있는 디렉토리. OC edit 권한은 `--dir` 내부에서만.

`analyze` — 읽기 전용 문서 평가:

```
TASK_TYPE: analyze
INPUTS:
- <path or glob 1>

EVALUATION:
- <추출/비교/검증 항목>

OUTPUT: <결과 쓸 경로 또는 "stdout">
```

OC는 read/grep/glob만 허용. edit·web 차단.

### Knowledge pipeline 패턴

research + composition을 묶을 때:

1. Caller(CC)가 로컬 lookup·dedup 체크
2. `delegate-oc` with `research` spec → raw markdown이 OUTPUT_FILE로
3. Caller가 짧게 검토 (sanity, 누락 확인)
4. `delegate-oc` with `compose` spec, raw research 참조 → 최종 문서
5. (선택) `delegate-oc` with `analyze` spec → 컨벤션 검증
6. Caller가 도메인 후처리 (backlinks, index 갱신, 이슈 연결)

caller plugin이 도메인 지식 보유, delegate-oc는 안전하게 위임만 담당.

### Anti-patterns

- ❌ "이 기능 구현해줘" 같은 모호한 spec — OC는 대화 히스토리 없음
- ❌ OC에게 아키텍처 결정 위임 — 임의로 고름
- ❌ `done` 상태에서 `oc-result-review` 건너뜀 — 작은 오류 누적
- ❌ 동일 파일 영역에 병렬 delegation — 순차 또는 격리된 `--dir`
- ❌ 검증 목적으로 SESSION_DIR 파일 Read — 위임 의의 무력화. `oc-result-review`에서만 의도적으로 읽기
- ❌ 컨트롤러를 여러 Bash 호출로 쪼개기 — 단일 호출로 통합한 이유가 토큰 절감

## 병렬 fan-out

≥2개의 독립 spec을 동시에 발사하려면 `bin/oc-fanout.sh`가 각 spec을 `oc-delegate.sh`로 병렬 실행(각기 독립 `opencode acp` 서브프로세스):

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/oc-fanout.sh" --dir "$PWD" --timeout 900 \
  /tmp/spec-1.md /tmp/spec-2.md /tmp/spec-3.md
```

출력: 요약 라인 + ASCII 타임라인 + N×7줄 리포트(`--- [i] <SESSION_DIR> ---` 구분). exit code = 개별 delegate exit의 최댓값. `Bash(run_in_background: true)`로 호출해 Opus 턴을 붙잡지 않도록 하세요.

## 세션 디렉토리

세션마다 `<project>/.claude/oc-sessions/<uuid>/` 아래 다음 파일 생성:

| 파일 | 내용 |
|---|---|
| `prompt.md` | OC에 전송한 spec 본문 (verbatim) |
| `oc_sid` | ACP 세션 ID (`ses_…`) |
| `sse.ndjson` | `session/update` 스트림(진행) + 합성 `permission.asked`/`session.error` 이벤트 (한 줄당 1 JSON) |
| `response.json` | 최종 `PromptResponse` (`stopReason`, usage) |
| `controller.log` | acp-client + delegate 진단 로그 |
| `acp-status.json` | acp-client의 1줄 머신 요약 (`{status, exit, updates}`) |
| `diff.patch` | 종료 시점 `git diff` 스냅샷 |

`.claude/.gitignore`에 `oc-sessions/`가 자동 추가되므로 커밋에 안 들어갑니다. 누적되면 직접 `rm -rf .claude/oc-sessions/<old-uuid>` 정리.

## 환경 변수

| 변수 | 기본 | 효과 |
|---|---|---|
| `CC_OC_WAIT_TIMEOUT` | 300 | 턴 전체 wall-clock 상한(초). 초과 시 `session/cancel` → `timeout`(30) |
| `CC_OC_STALL_SECONDS` | 60 | hang 감지: `session/update` 무응답이 이 시간 초과 시 취소 → `stalled`(31) |
| `CC_OC_ACP_LOG_LEVEL` | ERROR | `opencode acp` 로그 레벨(DEBUG/INFO/WARN/ERROR; stderr → controller.log) |
| `CC_OC_ACP_PURE` | (미설정=on) | 기본적으로 `opencode acp --pure`로 실행 — 외부 플러그인(beads/obsidian/memory-guard 등) 로드를 건너뛰어 부팅을 ~3.9s→~1.3s로 단축. `0`으로 설정 시 플러그인 포함(느림) |
| `CC_OC_REDIRECT_SUBAGENTS` | (없음) | 1이면 네이티브 서브에이전트 → delegate-oc 재라우팅 hook 활성화 |
| `CC_OC_REDIRECT_TYPES` | general-purpose,Plan | 재라우팅할 subagent_type 목록(기본 CC 내장만) |
| `CC_OC_REDIRECT_MAX_DENY` | 2 | 동일 요청 deny 한도(초과 시 네이티브 허용, 루프 방지) |

## 의존성

- `opencode` CLI **v1.15.5** (`opencode acp` 서브커맨드 필요)
- `node` — 번들된 `dist/acp-client.mjs` 실행 (런타임 유일 의존)
- `jq` — 서브에이전트 재라우팅 hook
- `bun` — **dev 전용**, `dist/acp-client.mjs` 재빌드 시에만
