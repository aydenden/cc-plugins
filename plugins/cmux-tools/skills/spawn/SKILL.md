---
name: spawn
description: This skill should be used when the user asks to "spawn a new session", "open a new Claude tab", "start a side task", "run this in a new session", "run in parallel", "새 탭 열어줘", "사이드 태스크 시작해줘", "cmux spawn", or wants to launch a parallel Claude Code session in a new cmux terminal tab within the current workspace.
argument-hint: '[optional prompt for the new session]'
---

# Spawn — New Claude Session in cmux Tab

Spawn a new Claude Code session as a terminal tab within the current cmux workspace. Useful for side tasks unrelated to the current conversation.

## Prerequisites Check

Before spawning, verify the cmux environment with a single Bash call:

```bash
[ -S "${CMUX_SOCKET_PATH:-/tmp/cmux.sock}" ] && [ -n "${CMUX_WORKSPACE_ID}" ] && echo "OK" || echo "FAIL"
```

If the check fails, report the error in the user's language and stop:
- No socket → "cmux가 실행 중이 아닙니다. cmux를 먼저 시작하세요."
- No `CMUX_WORKSPACE_ID` → "cmux 워크스페이스 환경이 아닙니다. cmux 터미널에서 실행하세요."

## Execution Flow

The argument string passed to this skill is the prompt for the new session. If no argument is provided, open a blank Claude session.

### Step 1: Create a new terminal tab

```bash
cmux new-surface --type terminal --workspace "$CMUX_WORKSPACE_ID"
```

Capture the surface ID from stdout for use in the next step.

### Step 2: Send the launch command

cmux `send` interprets `\\n` as a newline (Enter key). Use this to submit the command.

**Without prompt:**

```bash
cmux send --surface "<surface-id>" "cd $PWD && claude\\n"
```

**With prompt:**

Escape single quotes in the user's prompt as `'\\''` before interpolation:

```bash
cmux send --surface "<surface-id>" "cd $PWD && claude --prompt '<escaped-prompt>'\\n"
```

## Argument Parsing

The full argument string is treated as the prompt. No flags in v0.1.

Future versions may support flags like `--split`, `--model`, `--workspace` — parse these before the prompt string when added.

## Output

After successful spawn, report:
- 새 탭이 생성되었음을 확인
- surface ID 표시
- 프롬프트가 전달되었으면 해당 내용 언급

## Error Handling

- `cmux new-surface` 실패 시: cmux 에러 메시지를 그대로 전달
- `cmux send` 실패 시: 탭은 생성되었으나 명령어 전송에 실패했음을 알리고, 직접 입력을 안내
