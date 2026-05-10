---
name: opencode-runner
description: opencode CLI 호출 + 모델 라우팅 + escalation 헬퍼. dispatch 스킬이 자동 호출. 작업 키워드 분석 → opencode-go/<id> 모델 선택, 결과 jq 요약 추출, stuck 감지 시 K2.6 fallback. 사용자가 "어떤 모델 쓸지" / "라우팅 / escalation" 등으로도 트리거.
allowed-tools: Bash, Read
---

# opencode-runner — opencode 호출 + 라우팅 + escalation

## 역할

opencode CLI 호출 절차를 캡슐화한다. 직접 `opencode run`을 호출하는 대신 이 스킬의 절차를 따라 모델 선택·요약·escalation을 일관되게 적용한다.

## 인증 전제

opencode Go plan 인증이 1회 완료되어 있어야 한다.

```bash
opencode auth login
# /connect → OpenCode Zen → Go plan 선택
# 인증 토큰: ~/.local/share/opencode/auth.json
```

이 토큰은 모든 opencode 프로세스(`run`/`serve`/`acp`/TUI)가 공유하므로 headless `opencode run`도 동일 자격으로 동작한다.

## 작업 라우팅

### 키워드 매칭 규칙

`bin/route-task.sh "<task>"` 가 다음 순서로 평가:

| 우선순위 | 키워드 (대소문자 무관) | 모델 |
|---|---|---|
| 1 | `bulk`, `대량`, `다수`, `migration`, `100+`, `수십개` | `opencode-go/deepseek-v4-flash` |
| 2 | `refactor`, `리팩터`, `재구성`, `restructure` | `opencode-go/kimi-k2.6` |
| 3 | `boilerplate`, `보일러`, `반복`, `crud`, `simple` | `opencode-go/minimax-m2.7` |
| 4 | `review`, `리뷰`, `검토`, `audit`, `점검` | `opencode-go/deepseek-v4-pro` |
| 5 | `implement`, `구현`, `작성`, `build`, `develop` | `opencode-go/deepseek-v4-pro` |
| default | 위 어느 것도 매칭 안 되면 | `opencode-go/deepseek-v4-pro` (default_model) |

### 사용자 override

`.claude/codex-opencode-cmux.local.md` frontmatter에서 `routing.<key>` 값을 변경하면 우선 적용된다.

CLI 1회성 override:
```bash
bash ${CLAUDE_PLUGIN_ROOT}/bin/co-dispatch.sh --task "..." --model opencode-go/kimi-k2.6
```

## 호출 패턴

### 표준 호출

```bash
opencode run --model "$MODEL" --format json "<prompt>" > "$IMPL_FILE"
```

옵션 설명:
- `--model opencode-go/<id>` — Go plan 모델 명시
- `--format json` — JSONL 이벤트 스트림 (text / tool_use / step / reasoning / error)
- 출력 redirect 필수 (stdout 직접 codex로 넘기면 토큰 폭증)

### 파일 컨텍스트 첨부

```bash
opencode run --model "$MODEL" --file path/to/spec.md --format json "<prompt>" > "$IMPL_FILE"
```

### 세션 재사용 (refinement 루프)

```bash
opencode run --continue --model "$MODEL" --format json "<refinement prompt>" > "$IMPL_FILE_2"
```

`--continue` 는 마지막 세션을, `--session <id>` 는 특정 세션을 이어받는다.

## 결과 요약 (토큰 폭증 회피)

opencode JSONL 출력 전체를 codex에 넘기면 안 된다. `bin/oc-summary.sh`로 마지막 텍스트 응답만 추출:

```bash
cat "$IMPL_FILE" | jq -r 'select(.type=="text") | .part.text' | tail -c 4000 > "$IMPL_FILE.summary"
```

또는 더 정교하게:

```bash
jq -r '
  select(.type=="text") | .part.text,
  select(.type=="tool_use") | "[tool] " + .part.tool + ": " + (.part.args | tostring | .[0:200])
' "$IMPL_FILE"
```

요약 크기를 4KB 이하로 제한해 codex 컨텍스트를 보호한다.

## Escalation 로직

설정 (default):
```yaml
escalation:
  enabled: true
  primary: opencode-go/deepseek-v4-flash
  fallback: opencode-go/kimi-k2.6
  max_iterations: 3
```

### 트리거 조건

`bulk` 라우팅으로 V4 Flash 사용 중이고 다음 중 하나라도 해당:
1. opencode 프로세스가 비정상 종료 (exit code != 0)
2. 결과 파일에 `"type":"error"` 이벤트 포함
3. 같은 prompt로 3회 이터레이션 후 review-loop가 미완료 판정

### 승격 동작

```bash
echo "[escalation] V4 Flash stuck, retrying with K2.6"
cmux set-status escalation "K2.6 fallback" --color "#ff9500"  # cmux 있을 때만
opencode run --continue --model opencode-go/kimi-k2.6 --format json \
  "<original prompt + 'Previous attempt was stuck. Try a different approach.'>" \
  > "$IMPL_FILE.escalated"
```

승격 이벤트는 `cmux log` 와 stderr에 기록한다.

## Budget 체크 (preflight)

`bin/budget-check.sh` 가 dispatch 시작 전 1회 실행:

```bash
# opencode CLI는 헤드리스용 /status API가 없으므로 간접 추정:
# ~/.local/share/opencode/usage.json (또는 동급 파일) 파싱
# 또는 opencode TUI에서 /status로 확인 후 환경변수로 주입
USAGE_PCT=$(bash ${CLAUDE_PLUGIN_ROOT}/bin/budget-check.sh)
if [ "${USAGE_PCT:-0}" -ge 80 ]; then
  echo "⚠️  weekly 한도 ${USAGE_PCT}% 도달. 실행은 계속하나 곧 차단될 수 있음" >&2
fi
```

자동 차단은 하지 않는다 (auto_block: false 정책).

## 모델 카탈로그 참조

| Model ID | SWE-Pro | 크레딧 소비 | 용도 |
|---|---|---|---|
| `opencode-go/deepseek-v4-pro` | Tier A | 중간 | 기본 구현/리뷰 (default) |
| `opencode-go/kimi-k2.6` | 58.6% | 높음 | 장시간 자율, multi-step refactor |
| `opencode-go/deepseek-v4-flash` | 중상 | 매우 낮음 | 대량 작업 (bulk) |
| `opencode-go/minimax-m2.7` | 41 | 낮음 | 단순 boilerplate |
| `opencode-go/qwen3.6-plus` | 중 | 낮음 | CRUD |
| `opencode-go/glm-5.1` | 중 | **매우 높음** | 짧은 추론만 (사용 자제) |

## 참고

- opencode 공식 문서: https://opencode.ai/docs/cli/
- Go plan 모델 카탈로그: https://opencode.ai/docs/go/
- Config schema: https://opencode.ai/config.json
