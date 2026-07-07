# ACP 마이그레이션 인수인계 (임시 문서)

> **작성 2026-07-08.** 이 문서는 **신규 세션이 ACP 전환을 이어서 진행**하도록 남긴 핸드오프다.
> 현재 세션 컨텍스트 한계로 여기서 조사·설계만 마치고 구현은 넘긴다. 전환 완료 후 이 문서는 삭제.

## 0. 한 줄 요약

REST(`opencode serve` + curl) 기반 위임은 **hang 감지·인터랙티브 질문·진행 가시성**이 구조적으로 불가능하다. **ACP(Agent Client Protocol, stdio JSON-RPC)** 는 이 셋을 프로토콜 기본기능으로 해결한다. → 컨트롤러를 ACP 클라이언트로 재작성한다 (목표 v0.11.0). **delegate-oc 스킬의 외부 계약(7줄 리포트 + exit code)은 유지** — transport만 교체.

## 1. 왜 REST로는 안 되는가 (이번 세션 실측)

| 발견 | 근거 |
|---|---|
| `POST /session/:id/message`는 **동기**라 완료까지 블록 → CC(호출자)도 블록 | 코드/실측 |
| 생성 중 `/event` SSE는 **조용함**(server.connected + heartbeat만, 세션 이벤트 0개) → **진행/hang 감지 불가** | 11초 생성 중 SID 이벤트 0개 실측 |
| 세션은 stateless·격리, 위임마다 새 세션. provider 초기화는 **데몬 전역**(1회) — 모델별 콜드 없음(전부 2.5~3s) | `/session` + 모델별 실측 |
| **REST 전용 hang 버그**: OC가 `task` 툴로 서브에이전트 스폰 시 REST 경로가 세션을 "busy"로 영구 고착 | [sst/opencode#6573](https://github.com/sst/opencode/issues/6573) |
| `question` 툴 = 인터랙티브 질문 → headless에서 답 못 해 hang | [OpenAPI /question 엔드포인트 존재](https://opencode.ai/docs/server/) |

→ hang과 "그냥 오래 걸림"이 **시간 외엔 구분 불가**. 백그라운드 위임이 한없이 대기하는 근본 원인.

## 2. 이번 세션의 임시 방어 (REST에 남겨둔 것 — ACP 전까지 유효)

`bin/oc-prompt.sh`에 이미 반영·커밋됨:
- **툴 비활성**: 메시지 바디 `tools:{task:false, task_status:false, cancel_task:false, question:false}` (env `CC_OC_DISABLE_TOOLS`로 조정, 빈 문자열=해제). #6573과 question-hang을 **원천 차단**.
- **timeout 백스톱**: `oc-delegate.sh` 기본 900→**300s**. 잔여 hang을 15분→5분으로 제한.

이건 미봉책이다. ACP가 정답.

## 3. REST vs ACP 비교

| 문제 | REST (현재) | ACP |
|---|---|---|
| 진행 가시성 / hang 감지 | 스트림 조용 → 불가 | **`session/update` 스트리밍** → 무응답 N초=hang 자명 |
| question / permission | 동기 POST가 CC 블록 | **turn이 notification 기반, non-blocking**. 에이전트가 `session/request_permission`·입력요청 → 클라이언트 비동기 응답 → **에이전트 그대로 이어감** |
| 진행 보존 (인터랙티브 후 재개) | 세션 재실행 필요 | `session/load` + turn 안 끊김 → **기본 보존** |
| 취소 | SIGTERM 해킹 | **`session/cancel`** 정식 |
| #6573 hang | REST 전용 발생 | 다른 코드 경로 → 회피 가능성 (PoC로 확인) |
| 우리 코드 | SSE watcher·permission auto-deny·sync-POST·SIGTERM (해킹 다수) | 프로토콜 기본기능으로 대체 |

## 4. 권장 구현 — 확장성 있게

### 스택
- **Python 공식 SDK [`agent-client-protocol`](https://pypi.org/project/agent-client-protocol/)** (asyncio + pydantic). python3는 이미 플러그인 의존성 → **새 런타임 불필요, JSON-RPC 프레이밍 직접 안 짬**. (TS 대안: [`@agentclientprotocol/sdk`](https://www.npmjs.com/package/@agentclientprotocol/sdk) — 방금 지운 workflow가 Node였던 걸 감안하면 Python이 나음)
- opencode를 `opencode acp` **서브프로세스**로 띄우고 stdio JSON-RPC.

### 아키텍처 (확장 포인트 중심)
```
delegate-oc 스킬  (외부 계약 불변: spec in → 7줄 리포트 + exit code out)
        │
   oc-delegate (얇은 오케스트레이터)
        │
   acp-client.py  ← 신규 핵심. 재사용 가능한 ACP 클라이언트
     ├─ 연결: opencode acp 스폰 → initialize 핸드셰이크 → session/new(cwd) → 모델 설정 → session/prompt
     └─ 핸들러(전부 pluggable 확장점):
         ├─ on_session_update(update)   → ① 진행 sink(로그/diff) ② **stall watchdog**(업데이트마다 타이머 리셋; N초 무응답 → session/cancel = hang 감지) ③ 토큰/파일 카운트
         ├─ on_request_permission(req)  → 권한 정책(auto-deny / allow-list / CC 에스컬레이트)
         └─ on_request_input(question)  → **인터랙티브 질문 핸들러**: (a)자동응답 (b)CC로 표면화 (c)사용자에게 되묻기 → 답 주고 이어감
```
- **핵심 원칙**: 위 3개 핸들러가 **확장점**이다. 지금은 최소 구현(permission auto-deny, stall→cancel, question 자동/표면화)만, 나중에 "CC가 질문 받고 사용자에게 되묻기"를 이 핸들러만 갈아끼워 확장.
- **계약 유지**: `delegate-oc` 스킬 인터페이스(spec 형식, 7줄 리포트, exit code 0/10-13/20/30), `oc-fanout.sh`, 재라우팅 hook, `oc-result-review`는 **그대로**. ACP는 내부 transport 교체일 뿐 → 의존 플러그인(obsidian-knowledge, cc-deep-tutor) 무영향.

### 프로토콜 참조 (JSON-RPC over stdio, 실측 예시)
```jsonc
// 1) 핸드셰이크
{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":1,
  "clientCapabilities":{"fs":{"readTextFile":true,"writeTextFile":true},"terminal":true},
  "clientInfo":{"name":"cc-opencode","version":"0.11.0"}}}
// 2) 세션 생성
{"jsonrpc":"2.0","id":1,"method":"session/new","params":{"cwd":"/abs/dir","mcpServers":[]}}
// 3) 모델 설정 — opencode ACP는 SetSessionModelRequest 지원(ACPSessionManager.setModel). 정확한 method명 PoC로 확정
// 4) 프롬프트 (스트리밍 turn 시작)
{"jsonrpc":"2.0","id":2,"method":"session/prompt","params":{"sessionId":"sess_xyz",
  "prompt":[{"type":"text","text":"<spec 본문>"}]}}
// → 에이전트가 session/update 알림 다수 + 필요시 session/request_permission 요청, 완료 시 session/prompt 응답(stop reason)
```
- 흐름: `initialize → session/new → (set model) → session/prompt` / 도중 `session/update`(진행) + `session/request_permission`(권한) / `session/cancel`(취소) / `session/load`(재개). 출처: [ACP Overview](https://agentclientprotocol.com/protocol/overview), [opencode ACP](https://opencode.ai/docs/acp/), [DeepWiki ACP](https://deepwiki.com/sst/opencode/7.4-agent-client-protocol-(acp)).

## 5. 마이그레이션 단계 (신규 세션이 실행)

1. **PoC (리스크 먼저 태움)**: Python `agent-client-protocol`로 `opencode acp` 스폰 → initialize → session/new → **모델 지정** → session/prompt 1발. 확인: ① 모델 지정 method명·동작 ② session/update 스트리밍 수신 ③ permission 왕복 ④ **#6573이 ACP에서 재현 안 되는지**(task 툴 켜고 서브에이전트 유도).
2. **acp-client.py** 작성: 위 3개 pluggable 핸들러 + 연결 lifecycle. (per-위임 서브프로세스 vs persistent 재사용 — PoC에서 결정. persistent면 warmup도 자연 해결)
3. **oc-delegate 재배선**: 내부 파이프라인을 acp-client 호출로 교체, **7줄 리포트·exit code 계약 유지**. TASK_TYPE→model 매핑은 그대로(모델을 session에 설정).
4. **stall watchdog**: on_session_update에 무응답 타이머 → hang 시 session/cancel + `status: stalled`(신규 exit code). 이게 이번 세션 핵심 목표(백그라운드 무한대기 제거)를 진짜로 해결.
5. **인터랙티브 question**(선택, 뒤 단계): on_request_input를 "CC 표면화 → 사용자 되묻기 → 답 주입 → 이어감"으로 확장.
6. **REST 은퇴**: ACP 패리티 도달 후 `oc-prompt/sse-watch/permission/daemon/session.sh` 정리(또는 fallback 유지). 테스트·버전 v0.11.0.

## 6. PoC에서 반드시 확정할 미확인 사항

- opencode ACP의 **모델 지정 정확한 method/params** (SetSessionModelRequest 실제 형태).
- `opencode acp` 프로세스 **lifecycle**: 위임마다 새로 vs persistent 1개 재사용.
- ACP에서 **cwd/디렉토리 컨텍스트** 전달 방식(REST의 x-opencode-directory 대응).
- **#6573 재현 여부** (ACP 경로 안전성).
- SDK 버전 호환: opencode v1.15.5의 ACP protocolVersion과 SDK 버전.

## 7. 참고 링크 (전부)

- ACP 프로토콜: https://agentclientprotocol.com/protocol/overview
- ACP TypeScript SDK: https://www.npmjs.com/package/@agentclientprotocol/sdk , 레퍼런스 https://agentclientprotocol.github.io/typescript-sdk
- ACP Python SDK: https://pypi.org/project/agent-client-protocol/
- ACP 예제(양측 구현): https://github.com/zed-industries/agent-client-protocol/tree/main/typescript/examples
- opencode ACP 문서: https://opencode.ai/docs/acp/
- opencode ACP 내부(DeepWiki): https://deepwiki.com/sst/opencode/7.4-agent-client-protocol-(acp)
- opencode 서버/세션: https://opencode.ai/docs/server/ , https://deepwiki.com/sst/opencode/2.1-session-management
- **#6573 REST hang 버그**: https://github.com/sst/opencode/issues/6573
- opencode 툴 목록: https://opencode.ai/docs/tools/ (실측 tool ids: invalid question bash read glob grep edit write task task_status webfetch todowrite websearch skill apply_patch cancel_task ast_grep_search ast_grep_replace memory_*)
- 참고 구현(ACP로 opencode 제어): opencode-acp-control (clawhub/termo skills)
