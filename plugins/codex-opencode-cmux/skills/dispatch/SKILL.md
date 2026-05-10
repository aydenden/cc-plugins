---
name: dispatch
description: codex 세션에서 opencode를 서브에이전트(crew)로 cmux split을 통해 호출하는 메인 진입 스킬. 사용자가 "opencode에게 X 시켜줘", "crew에게 위임", "구현은 opencode로", 또는 `/codex-opencode-cmux:dispatch <task>` 명시 호출 시 트리거. cmux split + wait-for signal 패턴(B')으로 비동기 실행하고 결과를 codex에 자동 피드백한다. cmux 미설치 시 패턴 A(bash subprocess)로 자동 폴백.
argument-hint: <자연어 task 설명>
allowed-tools: Bash, Read, Write
---

# dispatch — codex captain → opencode crew 위임

## 역할

이 스킬은 사용자의 요청을 받아 다음 흐름을 자동 실행한다:

1. 환경 검증 (codex / opencode / cmux 검출, opencode 인증, 크레딧 체크)
2. 작업 유형 분류 → 모델 라우팅
3. 패턴 분기 (cmux 있음 → B' / 없음 → A)
4. opencode crew 실행 + 결과 capture
5. codex로 리뷰 피드백

## 트리거 조건

다음 중 하나로 활성화한다.

**자연어 트리거**:
- "opencode에게 / opencode로 / opencode가"
- "crew에게 / crew가 / 위임"
- "서브에이전트에게 / 서브로 / sub-agent"
- "cmux split / 분할해서 / 다른 pane에서"

**명시 호출**: `/codex-opencode-cmux:dispatch <task>`

## 실행 절차 (Claude가 따라야 할 단계)

### Step 1: 환경 검증

다음을 순서대로 확인한다.

```bash
# codex CLI
command -v codex >/dev/null || { echo "codex CLI 미설치"; exit 1; }

# opencode CLI
command -v opencode >/dev/null || { echo "opencode CLI 미설치"; exit 1; }

# opencode 인증 (Go plan)
[ -f "$HOME/.local/share/opencode/auth.json" ] || {
  echo "opencode 미인증. 다음 명령 실행: opencode auth login"
  exit 1
}

# cmux (선택)
bash ${CLAUDE_PLUGIN_ROOT}/bin/cmux-detect.sh
# exit 0 = cmux 사용 가능, exit 1 = 패턴 A 폴백
```

### Step 2: 사용자 설정 로드

`.claude/codex-opencode-cmux.local.md` 가 프로젝트에 있으면 frontmatter 파싱.
없으면 기본값 사용:

```yaml
default_model: opencode-go/deepseek-v4-pro
small_model: opencode-go/deepseek-v4-flash
routing:
  implement: opencode-go/deepseek-v4-pro
  boilerplate: opencode-go/minimax-m2.7
  review: opencode-go/deepseek-v4-pro
  refactor: opencode-go/kimi-k2.6
  bulk: opencode-go/deepseek-v4-flash
escalation:
  enabled: true
  primary: opencode-go/deepseek-v4-flash
  fallback: opencode-go/kimi-k2.6
  max_iterations: 3
```

### Step 3: Budget preflight (선택, 1회)

```bash
bash ${CLAUDE_PLUGIN_ROOT}/bin/budget-check.sh
# 80% 초과 시 stderr 경고만, 실행 계속
```

### Step 4: 작업 라우팅

`bin/route-task.sh "<task description>"` 호출하면 stdout으로 모델 ID 반환.

```bash
MODEL=$(bash ${CLAUDE_PLUGIN_ROOT}/bin/route-task.sh "$TASK")
echo "Selected model: $MODEL"
```

키워드 매칭 규칙은 `opencode-runner` 스킬 참고.

### Step 5: 패턴 실행

#### 패턴 B' (cmux 있음, 권장)

```bash
bash ${CLAUDE_PLUGIN_ROOT}/bin/co-dispatch.sh \
  --task "$TASK" \
  --model "$MODEL" \
  --mode cmux
```

내부 동작:
1. codex가 `/tmp/codex-plan-<id>.md` 작성
2. `cmux new-split right` → surface 획득
3. `cmux send` 로 opencode 명령 주입 + `wait-for --signal oc-done`
4. 부모는 `cmux wait-for oc-done --timeout 600` (block, polling 없음)
5. `bin/oc-summary.sh` 로 jq 요약 추출
6. `cmux set-status` / `set-progress` / `log` 사이드바 시각화

#### 패턴 A (cmux 없음, 자동 폴백)

```bash
bash ${CLAUDE_PLUGIN_ROOT}/bin/co-dispatch.sh \
  --task "$TASK" \
  --model "$MODEL" \
  --mode bash
```

내부 동작:
1. codex가 plan 작성 (stdout)
2. `opencode run --model "$MODEL" --format json "$(cat plan.md)" > impl.json`
3. jq로 요약 추출
4. codex에게 결과 stdin으로 전달

### Step 6: 결과 리뷰

`review-loop` 스킬을 호출해 codex가 결과를 검증하고 refinement가 필요하면 최대 3회 재실행.

## 출력 형식

사용자에게 다음 형식으로 보고한다:

```
✅ Dispatch 완료
- Task: <요약>
- Model: opencode-go/deepseek-v4-pro
- Pattern: B' (cmux split + wait-for)
- Iterations: 1
- Result: /tmp/oc-impl-<id>.json
- Summary: <2-3줄>
```

또는 실패 시:

```
❌ Dispatch 실패
- 단계: <검증/실행/리뷰 중 어느 단계>
- 사유: <에러 메시지>
- 다음 행동: <권장 조치>
```

## 참고 스킬

- `cmux-bridge` — cmux 소켓/split 헬퍼 (Step 5 cmux 분기에서 자동 호출)
- `opencode-runner` — 라우팅 + escalation 로직 (Step 4-5에서 자동 호출)
- `review-loop` — 결과 리뷰 + 최대 3회 refinement (Step 6에서 자동 호출)

## 주의사항

- opencode `/status` 한도 80% 초과 시 사용자에게 경고만 띄우고 실행은 진행 (auto_block=false)
- 토큰 폭증 회피: opencode 출력 전체를 codex에 넘기지 않고 jq로 마지막 텍스트만 추출
- cmux signal timeout 600초 기본, 작업 복잡도에 따라 조정 가능 (settings의 `dispatch_timeout`)
- `CMUX_SOCKET_MODE=allowAll` 미설정 시 외부 프로세스에서 소켓 호출 실패 가능 → SessionStart hook이 검출
