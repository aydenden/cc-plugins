# codex-opencode-cmux

> codex captain + opencode crew + cmux IPC 3-tool orchestration 플러그인

codex CLI 안에서 opencode를 cmux split을 통해 서브에이전트(crew)처럼 호출한다.
패턴 B' (`cmux new-split` + `wait-for` signal)로 polling-free 동기화하고,
미설치 환경에선 패턴 A (bash subprocess)로 자동 폴백한다.

## 핵심 기능

- **codex captain → opencode crew 자동 위임**: `dispatch` 스킬 자연어 트리거
- **모델 라우팅**: 작업 키워드 → opencode-go 14개 모델 매칭
- **Escalation**: V4 Flash stuck → K2.6 자동 승격
- **Refinement loop**: codex 리뷰로 미완료 시 최대 3회 재실행
- **cmux 사이드바 시각화**: `set-status` / `set-progress` / `log`

## 사전 요구사항

| 도구 | 용도 | 설치 |
|---|---|---|
| **codex** | captain | `brew install openai/codex/codex` |
| **opencode** | crew | `brew install opencode-ai/tap/opencode` |
| **opencode Go plan** | crew 모델 | $10/월 ($60 크레딧). [opencode.ai/go](https://opencode.ai/go) 가입 |
| **jq** | JSON 요약 | `brew install jq` |
| **cmux** (옵션) | split UI | macOS, [cmux.com](https://cmux.com) |

### 인증 (1회)

```bash
opencode auth login
# /connect → OpenCode Zen → Go plan 선택 → 브라우저 OAuth
# 토큰: ~/.local/share/opencode/auth.json
```

이 토큰은 모든 opencode 프로세스(`run`/`serve`/`acp`/TUI)가 공유한다.
즉 headless `opencode run --model opencode-go/...` 도 동일 자격으로 동작.

## 설치

```bash
# 마켓플레이스에 등록되어 있다면
/plugin marketplace add aydenden/cc-plugins
/plugin install codex-opencode-cmux

# 또는 로컬 테스트
claude --plugin-dir /path/to/cc-plugins/plugins/codex-opencode-cmux
```

## 사용

### 자연어 트리거

codex 또는 CC 세션에서:
```
"auth 모듈 JWT 구현은 opencode에게 시켜줘"
"이 30개 엔드포인트 CRUD 자동 생성, crew에게 위임"
"리팩터링 작업을 다른 pane에서 실행"
```

### 명시 호출

```bash
/codex-opencode-cmux:dispatch <task description>
```

### 스크립트 직접 호출

```bash
${CLAUDE_PLUGIN_ROOT}/bin/co-dispatch.sh \
  --task "auth 모듈 JWT 구현" \
  --mode auto \
  --max-iterations 3
```

## 모델 라우팅 매트릭스

| 키워드 | 라우팅 키 | 모델 | 비고 |
|---|---|---|---|
| `bulk`, `대량`, `다수`, `migration` | bulk | `opencode-go/deepseek-v4-flash` | 최저 크레딧 |
| `refactor`, `리팩터`, `재구성` | refactor | `opencode-go/kimi-k2.6` | 13h 자율 검증 |
| `boilerplate`, `보일러`, `반복`, `crud` | boilerplate | `opencode-go/minimax-m2.7` | 저비용 단순 |
| `review`, `리뷰`, `검토`, `audit` | review | `opencode-go/deepseek-v4-pro` | Tier A |
| `implement`, `구현`, `작성`, `build` | implement | `opencode-go/deepseek-v4-pro` | 기본 |
| (매칭 없음) | default | `opencode-go/deepseek-v4-pro` | default_model |

> **GLM-5.1 자동 선택 안 함** — 크레딧 23배 빠르게 소진 (약 $0.20~0.40/task).

## 컴포넌트

```
codex-opencode-cmux/
├── .claude-plugin/plugin.json
├── README.md
├── skills/
│   ├── dispatch/SKILL.md           # 메인 진입점 (자동 트리거)
│   ├── cmux-bridge/SKILL.md        # cmux 소켓/split 헬퍼
│   ├── opencode-runner/SKILL.md    # 라우팅 + escalation
│   └── review-loop/SKILL.md        # codex 리뷰 + refinement
├── agents/
│   └── crew-dispatcher.md          # 자율 dispatcher (sonnet)
├── hooks/
│   ├── hooks.json                  # SessionStart 검증
│   └── session-start.sh
├── bin/
│   ├── co-dispatch.sh              # 메인 orchestrator
│   ├── cmux-detect.sh              # 소켓 헬스체크
│   ├── route-task.sh               # 키워드 → 모델 매핑
│   ├── budget-check.sh             # weekly 80% 경고
│   └── oc-summary.sh               # jq 요약 추출
├── examples/
│   ├── basic-dispatch.md
│   ├── escalation-flow.md
│   └── refinement-loop.md
└── settings/
    └── codex-opencode-cmux.local.md.example
```

## 사용자 설정

`settings/codex-opencode-cmux.local.md.example` 를 프로젝트의
`.claude/codex-opencode-cmux.local.md` 로 복사 후 편집.

`.gitignore`에 추가 권장:
```
.claude/*.local.md
```

## 패턴 비교

### 패턴 B' (cmux 사용 가능, 권장)

```
codex (좌측) ──[plan.md]──→ ┐
                             │
        cmux new-split right │
                             ▼
            opencode (우측) ──[oc-impl.json]──→
                             │
            && wait-for --signal oc-done
                             │
codex 부모 ──── wait-for oc-done (block) ←──┘
        ──[summary]──→ codex review
```

### 패턴 A (cmux 미설치, 자동 폴백)

```
codex ──[plan.md]──→ opencode subprocess
                       │
                       ▼
                  oc-impl.json
                       │
codex ←──[summary]─────┘
codex review
```

## 알려진 제약

- opencode `/status` 헤드리스 API 부재 → budget-check.sh는 휴리스틱
- cmux는 macOS 전용 → Linux/Windows는 패턴 A만
- opencode는 MCP server 미지원 → MCP 통합 경로 없음
- codex `spawn_agent`는 codex 내부 인스턴스 전용 → opencode 직접 호출 불가
- GLM-5.1 라우팅 매트릭스에 미포함 (크레딧 폭증 위험)

## 참고

- [opencode CLI docs](https://opencode.ai/docs/cli/)
- [opencode Go plan](https://opencode.ai/docs/go/)
- [cmux docs](https://cmux.com/docs)
- [codex subagents](https://developers.openai.com/codex/subagents)

## 라이선스

MIT
