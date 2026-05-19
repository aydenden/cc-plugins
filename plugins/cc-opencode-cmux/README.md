# cc-opencode-cmux

Claude Code (Opus, orchestrator) → OpenCode (cheap-model implementer) 위임 플러그인.

메인 Opus 컨텍스트가 한 줄 호출만 하고, 격리된 서브에이전트(`oc-implementer`, haiku)가 daemon 관리·세션 생성·dispatch·cmux 시각화·diff 캡처를 모두 처리합니다. 메인은 8줄짜리 구조화된 보고만 받습니다.

## 진입점 (총 3개)

| 종류 | 이름 | 호출 |
|---|---|---|
| **Agent** | `cc-opencode-cmux:oc-implementer` | 메인 Opus가 `Agent({ subagent_type: "cc-opencode-cmux:oc-implementer", prompt: "<spec>" })`로 직접 호출 |
| **Skill** | `cc-opencode-cmux:delegate-oc` | 사용자가 `/cc-opencode-cmux:delegate-oc <spec>` 슬래시로 호출하거나, Claude가 description 자동 트리거. 다른 플러그인(obsidian-knowledge, cc-deep-tutor 등)이 `Skill(cc-opencode-cmux:delegate-oc, args: "<spec>")`로 호출 |
| **Skill** | `cc-opencode-cmux:oc-result-review` | delegation 종료 후 diff 리뷰 워크플로. SubagentStop hook이 자동 안내, 또는 사용자 명시 호출 |

슬래시 명령은 별도로 두지 않습니다. skill이 슬래시 호출도 지원하므로 단일 인터페이스로 통합되어 있습니다.

## 무엇을 하는가

`Agent` 또는 `Skill` 한 줄 호출 → 격리 서브에이전트가:

1. `opencode serve` daemon 확인·기동 (`oc-daemon.sh ensure`, idempotent)
2. OC 세션 미리 생성
3. cmux 우측 split 띄움 — events.ndjson을 `oc-stream-format.py`로 가공해 사람이 읽을 progress 라이브 표시. 작업 끝나면 5초 grace 후 자동 close (`CC_OC_KEEP_SURFACE=1`로 유지 가능)
4. SSE `/event` watcher 백그라운드 시작 (`permission.asked` 자동 deny)
5. `opencode run --attach --dir <workdir> -s <sid>` 동기 dispatch (HTTP API의 `directory` 무시 버그를 CLI `--dir`로 우회)
6. git diff 캡처
7. 구조화 8줄 보고 반환

메인 Opus 컨텍스트에는 raw tool output, NDJSON, 진행상황이 들어오지 않습니다. 보고만 들어옵니다.

## 설치

```bash
# 1) opencode CLI 설치 + 핀
brew install opencode-ai/opencode/opencode
opencode upgrade 1.15.5            # 권장 핀. v1.15.5 미만은 SSE/instance 회귀

# 2) 인증 (OC Go / OC Zen / BYOK 중 하나)
opencode auth login                 # TUI 메뉴에서 선택

# 3) jq (agent 정의 자동 등록에 필요)
brew install jq

# 4) (선택) project AGENTS.md에 conventions 스니펫 추가
cat ${CLAUDE_PLUGIN_ROOT}/templates/AGENTS.md.snippet >> AGENTS.md
```

세션 시작 시 `hooks/session-start.sh`가 `bin/install-agents.sh`를 호출해 `config/opencode.json.template`의 7개 OC agent 정의(`oc-implement`/`oc-refactor`/`oc-summarize`/`oc-cjk-doc`/`oc-research`/`oc-compose`/`oc-analyze`)를 사용자 `~/.config/opencode/opencode.json`에 jq deep merge 합니다 (idempotent, marker-gated, 백업 자동).

`CC_OC_AUTOSTART=1`을 설정하면 세션 시작 시 daemon도 미리 기동합니다. 미설정 시 첫 dispatch에서 자동 ensure.

## opencode 버전 핀 (필수: v1.15.5)

- **v1.14.48 이하**: `/event` SSE가 `server.connected` 이후 닫힘 — `permission.asked` 같은 부수 이벤트 미수신
- **v1.15.0**: Effect 기반 이벤트 시스템 전환 — 일부 이벤트 누락 가능
- **v1.15.1**: `InstanceRef not provided` 회귀 — 모든 `opencode run` 깨짐
- **v1.15.2 ~ v1.15.4**: project-scoped bus 라우팅 패치 진행 중
- **v1.15.5** (권장): SSE 구독 레이스 픽스 + `ask` tool 완료 픽스 + InstanceRef 해소

자동 업데이트 비활성:
```jsonc
// ~/.config/opencode/opencode.json
{ "autoupdate": false, ... }
```

## 알려진 한계 (v1.15.5 기준)

- **HTTP API의 `directory` 파라미터 무시**: `POST /session`에 `{directory:<path>}`를 보내도 daemon이 자기 cwd를 강제. 우회: `opencode run --attach --dir <path>` CLI 경로 사용 (이 플러그인이 그렇게 함)
- **`opencode run --attach`는 SSE `/event`로 진행 이벤트를 broadcast하지 않음**: tool/step/text 이벤트는 CLI stdout NDJSON으로만 흐름. 그래서 cmux split 표시는 events.ndjson을 직접 follow (SSE가 아니라). SSE는 `permission.asked` 등 부수 이벤트에만 사용

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

## 환경 변수

| 변수 | 기본 | 효과 |
|---|---|---|
| `CC_OC_PORT` | 4096 | daemon 포트 |
| `CC_OC_HOST` | 127.0.0.1 | daemon 호스트 |
| `CC_OC_AUTOSTART` | 0 | 1이면 session-start에서 daemon 자동 기동 |
| `CC_OC_KEEP_SURFACE` | 0 | 1이면 작업 끝나도 cmux split 자동 close 안 함 |
| `OPENCODE_SERVER_PASSWORD` | (자동) | daemon ensure가 발급/저장 |

## 의존성

- macOS (cmux v0.64.x 기반 — Linux/Windows 미지원)
- `opencode` CLI v1.15.5
- `python3` (3.10+)
- `jq` (agent 정의 등록에 사용)
- `cmux` (선택 — 미설치 시 split 없이 헤드리스 동작)
