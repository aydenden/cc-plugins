---
name: cmux-bridge
description: cmux 소켓 검출, new-split 생성, wait-for signal 동기화, 사이드바 메타데이터(set-status/set-progress/log) 등 cmux 제어 헬퍼. dispatch 스킬이 패턴 B' 실행 시 자동 호출. 사용자가 직접 호출할 필요는 없으나 "cmux 상태 / cmux split 만들어줘 / 소켓 확인" 등으로도 트리거 가능.
allowed-tools: Bash, Read
---

# cmux-bridge — cmux 제어 헬퍼

## 역할

cmux와의 모든 상호작용을 캡슐화한다. 직접 `cmux` 명령을 호출하는 대신 이 스킬의 절차를 따라 검증·로깅·에러 처리를 일관되게 적용한다.

## 검증 절차

### 1. 소켓 검출

```bash
bash ${CLAUDE_PLUGIN_ROOT}/bin/cmux-detect.sh
```

내부 로직:
```bash
SOCK="${CMUX_SOCKET_PATH:-$HOME/Library/Application Support/cmux/cmux.sock}"
[ -S "$SOCK" ] || exit 1
command -v cmux >/dev/null || exit 1
cmux ping >/dev/null 2>&1 || exit 1
exit 0
```

### 2. 접근 모드 확인

외부 프로세스(codex)에서 cmux 소켓에 접근하려면 다음 중 하나가 필요하다:
- 호출자가 cmux 내부 프로세스 (기본 허용)
- `CMUX_SOCKET_MODE=allowAll` (사용자 설정)

검출 스크립트가 ping 실패하면 사용자에게 다음 안내:
```
cmux 소켓 접근 거부됨. 다음 중 하나를 적용:
1. 환경변수: export CMUX_SOCKET_MODE=allowAll
2. cmux 안에서 codex 실행
```

## 핵심 동작

### Split 생성

```bash
SPLIT_OUT=$(cmux new-split right 2>&1)
SURFACE=$(echo "$SPLIT_OUT" | grep -oE 'surface:[0-9]+' | head -1)
[ -n "$SURFACE" ] || { echo "split 생성 실패"; exit 1; }
echo "$SURFACE"
```

방향 옵션: `right` (기본), `down`, `left`, `up`.

### 명령 주입

```bash
cmux send --surface "$SURFACE" "<command>\n"
```

주의:
- 줄 끝 `\n` 포함 (Enter 키 효과)
- 텍스트 내 따옴표는 `\"` 이스케이프
- 긴 명령은 `${CLAUDE_PLUGIN_ROOT}/bin/co-dispatch.sh` 같은 스크립트로 wrapping 권장

### Signal 동기화 (★ 핵심)

부모 측 (block until signaled):
```bash
cmux wait-for <signal-name> --timeout <seconds>
```

자식 측 (signal 발신):
```bash
<command> && cmux wait-for --signal <signal-name>
```

Signal 명은 작업별로 고유하게 (예: `oc-done-$$` PID 포함).

### 사이드바 시각화

```bash
# 진행 상태 라벨
cmux set-status orchestrator "<text>" --color "#1e3a5f"

# 진행률 (0.0 ~ 1.0)
cmux set-progress 0.5 --label "opencode running..."

# 로그 (level: info|success|warn|error)
cmux log --level success -- "<message>"

# 데스크톱 알림
cmux notify --title "<title>" --body "<body>"

# 정리
cmux clear-progress
cmux clear-status orchestrator
```

## 표준 패턴 B' 시퀀스

`co-dispatch.sh` 가 실행하는 정확한 시퀀스:

```bash
SIGNAL="oc-done-$$"
PLAN_FILE="/tmp/codex-plan-$$.md"
IMPL_FILE="/tmp/oc-impl-$$.json"

# 1. split + 명령 주입
SURFACE=$(cmux new-split right | grep -oE 'surface:[0-9]+')
cmux send --surface "$SURFACE" \
  "opencode run --model $MODEL --format json \"\$(cat $PLAN_FILE)\" > $IMPL_FILE && cmux wait-for --signal $SIGNAL\n"

# 2. 사이드바 업데이트
cmux set-status orchestrator "waiting opencode" --color "#ff9500"
cmux set-progress 0.5 --label "opencode running..."

# 3. signal 대기 (★ polling 없음)
cmux wait-for "$SIGNAL" --timeout "${TIMEOUT:-600}"

# 4. 완료 처리
cmux set-progress 1.0 --label "done"
cmux log --level success -- "opencode crew complete: $IMPL_FILE"
cmux clear-progress
cmux clear-status orchestrator
```

## 에러 핸들링

| 증상 | 원인 | 대응 |
|---|---|---|
| `socket not found` | cmux 미실행 | 패턴 A로 폴백 |
| `permission denied` | 접근 모드 문제 | `CMUX_SOCKET_MODE=allowAll` 안내 |
| `wait-for timeout` | opencode 작업 지연 | timeout 연장 또는 escalation 트리거 |
| `surface:N` 파싱 실패 | cmux 출력 포맷 변경 | `cmux list-pane-surfaces` 로 fallback 조회 |

## 참고

- 소켓 경로: `~/Library/Application Support/cmux/cmux.sock`
- env override: `CMUX_SOCKET_PATH`
- CLI 미설치 시: `sudo ln -sf "/Applications/cmux.app/Contents/Resources/bin/cmux" /usr/local/bin/cmux`
