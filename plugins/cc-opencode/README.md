# cc-opencode

Claude Code (Opus, orchestrator) → OpenCode (cheap-model implementer) 위임 플러그인.

**v0.6.1 (2026-05-21)**: 단일 컨트롤러 스크립트(`bin/oc-delegate.sh`) 도입. 메인 Opus는 컨트롤러 1회 호출 + 약속된 exit code 분기만 수행하므로, 파이프라인 단계 사이 판단에 드는 토큰이 사라졌습니다. v0.6.0에서 도입한 Skill-only 진입점 + HTTP API v2 + AGENTS.md 자동 인식은 그대로 유지.

## 진입점 (총 2개, Skill 전용)

| 종류 | 이름 | 호출 |
|---|---|---|
| **Skill** | `cc-opencode:delegate-oc` | 메인 Opus 또는 다른 플러그인이 `Skill(cc-opencode:delegate-oc, args: "<spec>")`로 호출. 사용자가 `/cc-opencode:delegate-oc <spec>` 슬래시로도 호출 가능. |
| **Skill** | `cc-opencode:oc-result-review` | delegation 종료 후 diff 리뷰 워크플로. delegate-oc가 반환한 SESSION_DIR을 args로 전달. |

v0.5.x의 `Agent({subagent_type:"cc-opencode:oc-implementer"})` 진입점은 **제거**되었습니다. 호출 시 실패합니다 — `delegate-oc` Skill을 사용하세요.

## 무엇을 하는가

`Skill(cc-opencode:delegate-oc, args)` 한 줄 호출 → 메인 Opus가 컨트롤러 1회 실행:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/oc-delegate.sh" --dir "$PWD" <<'EOF'
<spec body>
EOF
echo "$?"   # 약속된 exit code (0/10~13/20/30)
```

컨트롤러(`bin/oc-delegate.sh`) 내부에서 다음을 모두 처리:

1. `$CLAUDE_PROJECT_DIR/.claude/oc-sessions/<uuid>/` SESSION_DIR 생성 (실패 시 `/tmp` 폴백)
2. `oc-daemon.sh ensure` (idempotent)
3. `oc-session.sh create` — OC 세션 생성 (v1 `POST /session`)
4. `oc-sse-watch.sh` 백그라운드 — `permission.asked` 자동 deny + `session.status: idle` 감지 시 `done` 파일 쓰고 exit
5. `oc-prompt.sh` — **HTTP API v2 `POST /api/session/:id/prompt`** (헤더 `x-opencode-directory`로 디렉토리 지정). 메시지 큐잉 후 즉시 리턴.
6. `wait $WATCH_PID` — `--timeout`(기본 900s) 가드 포함
7. `git diff` 캡처 + `grep -c`로 카운트
8. 상태 분류 후 7줄 리포트 stdout으로 출력 + 약속된 exit code로 종료

메인 Opus 컨텍스트로 들어오는 것은 **7줄 리포트 + exit code 1개**뿐. 단계별 raw 출력, NDJSON, OC 텍스트 델타는 전혀 들어오지 않음. 사후 검토는 `oc-result-review` Skill에서 의도적으로 수행.

### Exit code 계약

| Code | Status | 의미 |
|---|---|---|
| 0 | `done` | 정상 완료 |
| 10 | `error` | daemon ensure 실패 |
| 11 | `error` | 세션 생성 실패 |
| 12 | `error` | HTTP POST 실패 |
| 13 | `error` | OC 세션이 `session.error` 발생 |
| 20 | `aborted-perm` | watcher가 권한 요청 auto-deny |
| 30 | `timeout` | wait 타임아웃 (세션 abort 후 보고) |

## v0.6.1 주요 변경

- **신규**: `bin/oc-delegate.sh` 단일 컨트롤러 — 메인이 호출하는 진입점이 1개로 통합. 파이프라인 단계 사이 판단 토큰 제거.
- **Skill 본문 축소**: 8개 step bash 절차 → 호출 한 줄 + exit code 표. 약 40% 짧아짐.
- 호환성: 외부 호출자(`obsidian-knowledge:research-agent` 등)는 `Skill(cc-opencode:delegate-oc, args)` 인터페이스 그대로 사용 — 변경 없음.

## v0.6.0 주요 변경

| 항목 | v0.5.x | v0.6.0 |
|---|---|---|
| 진입점 | Agent + Skill 둘 다 | Skill만 |
| 서브에이전트 | `oc-implementer` (haiku) | 없음 (메인이 직접) |
| 메시지 채널 | `opencode run --attach` CLI | HTTP API v2 (`POST /api/session/:id/prompt`) |
| 작업 디렉토리 전달 | CLI `--dir` | HTTP 헤더 `x-opencode-directory` |
| AGENTS.md | `templates/AGENTS.md.snippet`을 prompt에 cat prepend (hack) | OpenCode가 OC_DIR에서 자동 `findUp` 로딩 (hack 제거) |
| 완료 신호 | `opencode run` 동기 종료 + status polling | SSE `session.status: idle` 단일 신호 |
| 세션 디렉토리 | `/tmp/cc-oc-<uuid>` | `<project>/.claude/oc-sessions/<uuid>` (자동 gitignore) |
| `running-after-detach` 상태 | 있음 (v1.15.x `--attach` 회피) | 없음 (HTTP API는 그런 경계 없음) |
| `timeout` 상태 | 없음 | 추가 (기본 900s, `CC_OC_WAIT_TIMEOUT` 조정 가능) |
| SubagentStop hook | 있음 | 없음 (서브에이전트 자체가 사라짐) |

## 설치

```bash
# 1) opencode CLI 설치 + 핀
brew install opencode-ai/opencode/opencode
opencode upgrade 1.15.5            # 권장 핀

# 2) 인증 (OC Go / OC Zen / BYOK 중 하나)
opencode auth login                # TUI 메뉴

# 3) jq (재라우팅 hook에 필요)
brew install jq
```

세션 시작 시 `hooks/session-start.sh`가:
- opencode 설치·인증·`curl` 사전 점검 (없으면 경고, 세션은 안 막음)
- 프로젝트의 `.claude/.gitignore`에 `oc-sessions/`가 없으면 자동 추가 (없으면 .gitignore 생성)

> 모델은 위임 시 메시지 바디에 `model:{providerID,modelID}`로 직접 지정됩니다(agent 등록 없음). `delegate-oc`가 `TASK_TYPE`→모델을 매핑하고, 스펙의 `MODEL:`로 override합니다.

`CC_OC_AUTOSTART=1`을 설정하면 세션 시작 시 daemon도 미리 기동. 미설정 시 첫 dispatch에서 자동 ensure.

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
| `CC_OC_REDIRECT_TYPES` | `general-purpose,Plan` | 재라우팅할 `subagent_type` 목록(쉼표/공백 구분). **기본값은 CC 내장 에이전트만**(모든 사용자에게 존재) — 읽기전용 `Explore`는 의도적으로 제외. 프로젝트/플러그인 고유 에이전트(`code-reviewer`, `review-agent`, `test-quality-agent` 등)는 이 변수로 환경별 추가 |
| `CC_OC_REDIRECT_MAX_DENY` | `2` | 동일 (세션·타입·description) 요청을 몇 번 deny한 뒤 포기하고 네이티브 실행을 허용할지. 무한 deny↔재시도 루프 방지 |

> **한계**: `deny` 사유를 Claude가 따르지 않을 수 있습니다(순응 의존). `CC_OC_REDIRECT_MAX_DENY`회
> 넛지 후에는 막지 않고 네이티브 실행을 허용합니다. 위임 부적합(아키텍처 판단 등)인 작업은
> delegate-oc의 decide 게이트가 걸러 Claude가 직접 수행하도록 되돌립니다.

## opencode 버전 핀 (필수: v1.15.5)

- **v1.14.48 이하**: `/event` SSE가 `server.connected` 이후 닫힘 — `permission.asked` 같은 부수 이벤트 미수신
- **v1.15.0**: Effect 기반 이벤트 시스템 전환 — 일부 이벤트 누락 가능
- **v1.15.1**: `InstanceRef not provided` 회귀
- **v1.15.2 ~ v1.15.4**: project-scoped bus 라우팅 패치 진행 중
- **v1.15.5** (권장): SSE 구독 레이스 픽스 + `ask` tool 완료 픽스 + InstanceRef 해소 + v2 API의 `/api/session/:id/prompt`, `/wait` 안정화

자동 업데이트 비활성:
```jsonc
// ~/.config/opencode/opencode.json
{ "autoupdate": false, ... }
```

## v0.6.0이 해결한 v0.5.x 한계

- ~~HTTP API의 `directory` 파라미터 무시~~ → `x-opencode-directory` 헤더로 우회 (v1.15.5 공식 지원)
- ~~`opencode run --attach` 조기 detach (running-after-detach)~~ → CLI 자체를 안 씀
- ~~`opencode run --attach`가 SSE로 진행상황 broadcast 안 함~~ → 더 이상 attach 안 함; SSE는 권한·완료 신호 단일 목적
- ~~서브에이전트 mid-flight 토큰 누수 (events.ndjson Read)~~ → 서브에이전트 자체 제거

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

`--dir`는 writable scratch (예: `/tmp/cc-oc-scratch-<id>`). OC `research` agent profile은 webfetch/websearch 권한 있음.

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
- ❌ 컨트롤러를 여러 Bash 호출로 쪼개기 — v0.6.1에서 단일 호출로 통합한 이유가 토큰 절감

## 세션 디렉토리

세션마다 `<project>/.claude/oc-sessions/<uuid>/` 아래 다음 파일 생성:

| 파일 | 내용 |
|---|---|
| `prompt.md` | OC에 전송한 spec 본문 (verbatim) |
| `sse.ndjson` | SSE 사이드채널의 자기 세션 이벤트만 필터링 |
| `done` | 2줄: exit code + reason (예: `0\nsession idle`) |
| `diff.patch` | 종료 시점 `git diff` 스냅샷 |
| `oc_sid` | OpenCode 세션 ID (fork/abort용) |
| `watch.stdout`, `watch.stderr` | SSE watcher 로그 |

v0.5.x의 `events.ndjson`은 사라졌습니다 (`opencode run --attach` 의존이 제거되어 더 이상 생성되지 않음).

`.claude/.gitignore`에 `oc-sessions/`가 자동 추가되므로 커밋에 안 들어갑니다. 누적되면 직접 `rm -rf .claude/oc-sessions/<old-uuid>` 정리.

## 환경 변수

| 변수 | 기본 | 효과 |
|---|---|---|
| `CC_OC_PORT` | 4096 | daemon 포트 |
| `CC_OC_HOST` | 127.0.0.1 | daemon 호스트 |
| `CC_OC_AUTOSTART` | 0 | 1이면 session-start에서 daemon 자동 기동 |
| `CC_OC_PROMPT_TIMEOUT` | 30 | `oc-prompt.sh` POST timeout (초) |
| `CC_OC_WAIT_TIMEOUT` | 900 | SSE watcher `wait` timeout (초) |
| `CC_OC_REDIRECT_SUBAGENTS` | (없음) | 1이면 네이티브 서브에이전트 → delegate-oc 재라우팅 hook 활성화 |
| `CC_OC_REDIRECT_TYPES` | general-purpose,Plan | 재라우팅할 subagent_type 목록(기본 CC 내장만) |
| `CC_OC_REDIRECT_MAX_DENY` | 2 | 동일 요청 deny 한도(초과 시 네이티브 허용, 루프 방지) |
| `OPENCODE_SERVER_PASSWORD` | (자동) | daemon ensure가 발급/저장 |

## 의존성

- `opencode` CLI v1.15.5
- `python3` (3.10+) — JSON 페이로드 합성 + URL encoding
- `jq` — 서브에이전트 재라우팅 hook
- `curl` — HTTP API 호출
- `timeout` (선택; coreutils. macOS는 `brew install coreutils` 또는 폴백 폴링)

## 마이그레이션 (v0.5.x → v0.6.0)

```diff
- Agent({ subagent_type: "cc-opencode:oc-implementer", prompt: "<spec>" })
+ Skill(cc-opencode:delegate-oc, args: "<spec>")
```

반환 보고 형식은 거의 동일하지만 `server:` 필드가 `done:` 필드로 바뀌었고 `running-after-detach`가 사라지고 `timeout` 상태가 추가됨. 외부 플러그인(obsidian-knowledge:research-agent 등)이 이 보고를 파싱한다면 status 분기 갱신 필요.

`templates/AGENTS.md.snippet` 의존이 있다면 — 더 이상 자동 prepend되지 않습니다. OpenCode가 OC_DIR에서 `AGENTS.md`를 자동 `findUp` 로딩하므로, 프로젝트 루트에 `AGENTS.md`를 두면 됩니다.
