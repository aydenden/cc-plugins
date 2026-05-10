# Basic Dispatch — 단일 작업 위임

## 시나리오
사용자가 codex 세션에서 "auth 모듈 JWT 구현은 opencode에게 시켜줘" 요청.

## 흐름

```
[codex captain]                      [opencode crew]            [cmux IPC]
     │                                    │                          │
     │── 환경 검증                        │                          │
     │── 라우팅: "구현" → V4 Pro         │                          │
     │── plan.md 작성 ──────────────────────────────────────────→  /tmp/codex-plan-XX.md
     │                                    │                          │
     │── new-split right ─────────────────────────────────────────→ surface:2 생성
     │── send "opencode run --model ... && wait-for oc-done" ────→ surface:2에서 실행
     │                                    │                          │
     │                                    │── opencode 작업 ──────→ /tmp/oc-impl-XX.json
     │                                    │── wait-for --signal ──→ signal:oc-done 발신
     │                                    │                          │
     │── wait-for oc-done (block) ←─────────────────────────────── unblock
     │── jq 요약 추출                     │                          │
     │── codex review                     │                          │
     │                                    │                          │
     ▼ 사용자 보고
```

## 실제 호출

자연어:
```
사용자: "auth 모듈 JWT 토큰 발급/검증 구현, opencode에게 맡겨"
→ Claude가 dispatch skill 자동 트리거
→ co-dispatch.sh --task "auth JWT 토큰 발급/검증 구현" 실행
```

명시:
```bash
/codex-opencode-cmux:dispatch auth 모듈 JWT 토큰 발급/검증 구현
```

스크립트 직접:
```bash
${CLAUDE_PLUGIN_ROOT}/bin/co-dispatch.sh \
  --task "auth 모듈 JWT 토큰 발급/검증 구현" \
  --mode auto
```

## 예상 결과

```
[dispatch] mode=cmux
[dispatch] model=opencode-go/deepseek-v4-pro
[dispatch] budget=42%
[dispatch] codex planning...
[dispatch] opencode (cmux mode) running...
✅ Dispatch complete
- Task: auth 모듈 JWT 토큰 발급/검증 구현
- Model: opencode-go/deepseek-v4-pro
- Pattern: cmux
- Iterations: 1/3
- Plan: /tmp/codex-plan-12345-1715342400.md
- Result: /tmp/oc-impl-12345-1715342400.json
- Summary: /tmp/oc-summary-12345-1715342400.txt

--- Summary ---
src/auth/jwt.ts 생성. JWT_SECRET 환경변수 사용.
- issueToken(userId): JWT 발급, exp 24h
- verifyToken(token): 검증, 만료/위조 검사
- refreshToken(token): 만료 30분 전 자동 갱신
unit test 4개 작성 (src/auth/jwt.test.ts).
```

## cmux 사이드바 시각화

```
[orchestrator] spawning opencode    🟪 #4a1a6b
[orchestrator] waiting opencode     🟧 #ff9500   progress: 50%
[orchestrator] (cleared)            ✅ done       progress: 100%
log: crew complete: /tmp/oc-impl-XX.json
notify: "Crew dispatch complete"
```
