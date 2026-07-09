# cc-opencode 환경변수 설정 가이드

플러그인 동작은 **환경변수**로 조정합니다. bin/ 스크립트와 번들 `dist/acp-client.mjs`는
`process.env` / 셸 env를 직접 읽습니다 — **별도 설정 파일을 로딩하지 않습니다.**
따라서 값은 아래 두 채널 중 하나로 주입하세요.

## 주입 채널

| 채널 | 위치 | 스코프 |
|---|---|---|
| Claude Code settings (권장) | `~/.claude/settings.json` → `"env"` | 전역 상시 (모든 세션의 Bash 툴에 상속) |
| 프로젝트 settings | `<project>/.claude/settings.json` → `"env"` | 해당 repo만 |
| 셸 프로파일 | `~/.zshrc` 등 `export CC_OC_...` | 전역 상시 |
| 1회성 | delegate 호출 커맨드라인 `CC_OC_PERMISSION=allow-all bash …/oc-delegate.sh …` | 그 호출만 |
| **위임마다 (권장)** | **delegate spec의 `PERMISSION:` / `ALLOW_WRITE:` 필드** | 그 위임만, 재시작 불필요 |

> **settings.json env vs spec 필드**: settings.json은 CC 시작 시 1회 로드라 바꾸면 재시작이 필요합니다 → **상시 기본값**에만 쓰세요. 위임마다 정책을 바꾸려면 spec에 필드를 넣으세요(아래). `oc-delegate.sh`가 파싱해 그 위임에만 적용하며 ambient env보다 우선합니다:
>
> ```
> TASK_TYPE: research
> PERMISSION: allow-all          # scoped | allow-all | deny-all
> ALLOW_WRITE: /tmp/scratch      # 추가 허용 루트, 콜론 구분
> OUTPUT_FILE: /tmp/out/r.md     # 이 디렉토리는 자동 허용
> ```
>
> 네이티브 서브에이전트(Agent/Task) 재라우팅을 특정 호출만 우회하려면 env가 아니라 **prompt에 `[cc-only]` 마커**를 넣으세요(툴에 env를 못 붙이므로).

`~/.claude/settings.json` 예시:

```jsonc
{
  "env": {
    // 네이티브 서브에이전트(Agent/Task) 스폰을 delegate-oc 위임으로 재라우팅 (opt-in)
    "CC_OC_REDIRECT_SUBAGENTS": "1",

    // 권한 정책: scoped(기본) | allow-all | deny-all
    // scoped = 툴이 쓰는 경로가 모두 허용 루트(--dir/SESSION_DIR/CC_OC_ALLOW_WRITE) 하위일 때만 allow
    "CC_OC_PERMISSION": "scoped",

    // scoped에서 추가로 허용할 쓰기 경로 (콜론 구분). 예: /tmp 전역 허용.
    // (spec에 OUTPUT_FILE:을 쓰면 그 디렉토리는 oc-delegate.sh가 자동 허용하므로 보통 불필요)
    "CC_OC_ALLOW_WRITE": "/tmp"
  }
}
```

## 전체 환경변수

### 위임 컨트롤러 (bin/oc-delegate.sh, dist/acp-client.mjs)

| 변수 | 기본 | 의미 |
|---|---|---|
| `CC_OC_PERMISSION` | `scoped` | 권한 정책: `scoped` / `allow-all` / `deny-all` (`src/permission.ts`) |
| `CC_OC_ALLOW_WRITE` | (없음) | scoped에서 추가 허용 쓰기 루트, 콜론 구분. `OUTPUT_FILE:`은 자동 주입됨 |
| `CC_OC_WAIT_TIMEOUT` | `300` | 턴 전체 wall-clock 상한(초). `--timeout`이 우선 |
| `CC_OC_STALL_SECONDS` | `60` | 무응답 hang 감지(초). `--stall`이 우선 |
| `CC_OC_ACP_PURE` | `1` | `opencode acp --pure`(플러그인 미로딩, 빠른 부팅). `0`이면 플러그인 로딩 |
| `CC_OC_ACP_LOG_LEVEL` | `ERROR` | `opencode acp --log-level` |

### 서브에이전트 재라우팅 hook (hooks/redirect-subagent.sh)

| 변수 | 기본 | 의미 |
|---|---|---|
| `CC_OC_REDIRECT_SUBAGENTS` | (off) | `1`이어야 hook 활성. 아니면 네이티브 그대로 |
| `CC_OC_REDIRECT_TYPES` | (unset=전부) | 재라우팅할 subagent_type 화이트리스트. unset이면 전부(-EXCLUDE) |
| `CC_OC_REDIRECT_EXCLUDE` | `statusline-setup` | 절대 재라우팅 안 할 타입 |
| `CC_OC_REDIRECT_SKIP_MARKER` | `[cc-only]` | prompt/description에 이 마커가 있으면 재라우팅 skip(네이티브 실행). 정밀 분석을 CC로 남길 때 |
| `CC_OC_REDIRECT_MAX_DENY` | `2` | 같은 요청 연속 거부 N회 후 포기하고 네이티브 허용(무한루프 방지) |

## 인증 (Authentication)

OC Zen과 OC Go는 **별개 구독**입니다. 둘 다 `opencode auth login` TUI 메뉴에서 선택합니다.

### OpenCode Go ($10/월 정액, 14 모델)

```bash
opencode auth login   # menu: choose "OpenCode Go"
```

`opencode-go/<id>`로 접근 (delegate-oc가 `TASK_TYPE`→model 매핑; spec의 `MODEL:`이 override):

- DeepSeek V4 Flash (31,650 req/5h, ctx 1M — Go 최대 quota)
- Qwen 3.6 Plus (3,300 req/5h, ctx 256K — Go 내 한국어 최적)
- DeepSeek V4 Pro (3,450 req/5h, ctx 1M)
- Kimi K2.6 (1,150 req/5h, ctx 256K — SWE-Bench Pro 리더)

### OpenCode Zen (종량제, 프리미엄)

`opencode/<id>`로 접근: `opencode/claude-sonnet-4-5`, `opencode/gpt-5.1`, `opencode/gemini-3.1-pro` 등.

### BYOK (선택 폴백)

OC 게이트웨이 우회: `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`.

### 인증 확인

```bash
opencode auth list   # 하나라도 provider가 뜨면 OK
```
