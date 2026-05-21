# cc-opencode-cmux

Claude Code (Opus, orchestrator) → OpenCode (cheap-model implementer) 위임 플러그인.

**v0.6.0 (2026-05-21)**: 서브에이전트 경유 제거. 메인 Opus가 `delegate-oc` Skill의 절차를 따라 **직접** OpenCode HTTP API v2를 호출합니다. 중간 haiku 에이전트가 사라져 토큰 누수 위험이 구조적으로 제거되고, `opencode run --attach` CLI 의존성도 함께 제거되어 v1.15.x의 `--attach` 조기 detach 이슈에서 자유로워졌습니다.

## 진입점 (총 2개, Skill 전용)

| 종류 | 이름 | 호출 |
|---|---|---|
| **Skill** | `cc-opencode-cmux:delegate-oc` | 메인 Opus 또는 다른 플러그인이 `Skill(cc-opencode-cmux:delegate-oc, args: "<spec>")`로 호출. 사용자가 `/cc-opencode-cmux:delegate-oc <spec>` 슬래시로도 호출 가능. |
| **Skill** | `cc-opencode-cmux:oc-result-review` | delegation 종료 후 diff 리뷰 워크플로. delegate-oc가 반환한 SESSION_DIR을 args로 전달. |

v0.5.x의 `Agent({subagent_type:"cc-opencode-cmux:oc-implementer"})` 진입점은 **제거**되었습니다. 호출 시 실패합니다 — `delegate-oc` Skill을 사용하세요.

## 무엇을 하는가

`Skill(cc-opencode-cmux:delegate-oc, args)` 한 줄 호출 → 메인 Opus가 절차를 따라 직접 실행:

1. `opencode serve` daemon 확인·기동 (`oc-daemon.sh ensure`, idempotent)
2. `$CLAUDE_PROJECT_DIR/.claude/oc-sessions/<uuid>/` SESSION_DIR 생성 (실패 시 `/tmp` 폴백)
3. `oc-session.sh create`로 OC 세션 생성 (v1 `POST /session`)
4. `oc-sse-watch.sh` 백그라운드 시작 — `permission.asked` 자동 deny + `session.status: idle` 감지 시 `done` 파일 쓰고 exit
5. `oc-prompt.sh`로 **HTTP API v2 `POST /api/session/:id/prompt`** 호출 (헤더 `x-opencode-directory`로 작업 디렉토리 지정 — `--dir` 완전 대체). 메시지가 큐에 들어가면 즉시 리턴.
6. SSE watcher 프로세스를 `wait` — `session.status: idle` 감지 시 자동 종료 → 메인 unblock
7. `git diff` 캡처 후 `grep -c`로 카운트만 산출
8. 7줄 구조화 보고 반환

메인 Opus 컨텍스트에는 raw tool output, NDJSON, OC의 텍스트 델타가 들어오지 않습니다. 보고만 들어옵니다. 사후 검토는 `oc-result-review` Skill에서 의도적으로 수행.

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

# 3) jq (agent 정의 자동 등록에 필요)
brew install jq
```

세션 시작 시 `hooks/session-start.sh`가:
- `bin/install-agents.sh`를 호출해 7개 OC agent 정의(`oc-implement`/`oc-refactor`/`oc-summarize`/`oc-cjk-doc`/`oc-research`/`oc-compose`/`oc-analyze`)를 사용자 `~/.config/opencode/opencode.json`에 jq deep merge
- 프로젝트의 `.claude/.gitignore`에 `oc-sessions/`가 없으면 자동 추가 (없으면 .gitignore 생성)

`CC_OC_AUTOSTART=1`을 설정하면 세션 시작 시 daemon도 미리 기동. 미설정 시 첫 dispatch에서 자동 ensure.

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

토큰 예산:

| 출력 유형 | 토큰/줄 | Safe 단일 delegate | Hard wall |
|---|---|---|---|
| 소스코드 | 50–80 | ≤ 1000 LOC | ~1100 |
| Markdown / 한국어 doc | 60–100 | ≤ 800 LOC | ~900 |
| JSONL / CSV fixture | 150–300 | ≤ 250 LOC | ~300 |
| Parquet / DB seed / binary | — | **never** | — |

> 70K 또는 binary → CC 메인이 fixture 먼저 생성, 그 후 fixture를 읽는 코드만 위임.

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
| `OPENCODE_SERVER_PASSWORD` | (자동) | daemon ensure가 발급/저장 |

## 의존성

- `opencode` CLI v1.15.5
- `python3` (3.10+) — JSON 페이로드 합성 + URL encoding
- `jq` — agent 정의 등록
- `curl` — HTTP API 호출
- `timeout` (선택; coreutils. macOS는 `brew install coreutils` 또는 폴백 폴링)

## 마이그레이션 (v0.5.x → v0.6.0)

```diff
- Agent({ subagent_type: "cc-opencode-cmux:oc-implementer", prompt: "<spec>" })
+ Skill(cc-opencode-cmux:delegate-oc, args: "<spec>")
```

반환 보고 형식은 거의 동일하지만 `server:` 필드가 `done:` 필드로 바뀌었고 `running-after-detach`가 사라지고 `timeout` 상태가 추가됨. 외부 플러그인(obsidian-knowledge:research-agent 등)이 이 보고를 파싱한다면 status 분기 갱신 필요.

`templates/AGENTS.md.snippet` 의존이 있다면 — 더 이상 자동 prepend되지 않습니다. OpenCode가 OC_DIR에서 `AGENTS.md`를 자동 `findUp` 로딩하므로, 프로젝트 루트에 `AGENTS.md`를 두면 됩니다.
