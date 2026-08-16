# memory-guard

CC auto memory(`~/.claude/projects/<proj>/memory/`)가 **비대해지고 stale 항목이 쌓이는 것**을 막는 hook 플러그인.

## 문제

CC auto memory는 `MEMORY.md`(인덱스) + 토픽 `.md` 파일로 구성된다. 그런데:

- **인덱스가 계속 커진다** — CC는 `MEMORY.md`의 첫 ~24.4KB/200줄만 세션 시작에 로드한다. 한도를 넘으면 **조용히 잘라서 로드**(에러·경고 없음) → 매 세션 거대 텍스트 주입(오염) + 일부 누락(정보 손실).
- **지워야 할 과거 내용이 남는다** — CC는 메모리 파일을 자동 정리/압축/삭제하지 **않는다**. 토픽 파일도 마찬가지로 방치되어 깨진 링크·노후 항목이 쌓인다.

근본 원인은 **강제 장치의 부재**다. 규칙(한 항목 한 줄, detail은 토픽으로)은 텍스트 지침일 뿐, write를 검사하는 메커니즘이 없어 전적으로 에이전트 자율 준수에 의존한다.

## 해결: 2개의 hook

### ① `index-guard.sh` — 인덱스 write 차단 (PreToolUse)

`Write|Edit`가 어떤 프로젝트의 `*/memory/MEMORY.md`를 **키우는 방향**으로 한도를 넘기면 `exit 2`로 차단하고, 진단(현재/예상 크기, 한도, 가장 긴 항목 top5)을 피드백한다.

- **차단 기준은 "결과 상태"** — 파일을 키우면서 한도 초과/긴 항목 추가일 때만 차단.
- **줄이는(정리) write는 항상 통과** → 막혔다가 푸는 루프가 데드락 없이 돈다. 차단당하면 detail을 토픽 파일로 옮기고 인덱스를 줄여서 재시도하면 통과한다.
- Edit는 바이트 델타(`old - len(old_string) + len(new_string)`)로 결과 크기를 정확히 계산한다.

기본 한도: **24000 B / 190줄 / 항목당 250자**(한글 포함 정확한 문자 수, `wc -m`).

### ② `memory-check.sh` — 하루 1회 stale·비대 점검 (SessionStart, asyncRewake)

새 세션(`source=startup`) 시작 시, 그 세션 프로젝트의 메모리를 **결정적으로**(무료, LLM 없이) 점검한다.

- 검출: 깨진 내부 링크(`](x.md)`, `[[wiki]]`), 인덱스 초과, 노후(본문 최신 날짜 90일 경과).
- 후보가 있으면 `exit 2` → `asyncRewake`가 결과를 **메인 세션에 system reminder로 주입** → 에이전트가 의미 판단 후 처리. 후보가 없으면 조용히 종료.
- **자동 삭제하지 않는다** — `archive/`로 이동하거나 마킹하고 사용자에게 확인. 코드/문서 링크의 의미 검증은 에이전트(구독 세션)가 수행하므로 별도 API 과금이 없다.

#### 동시성 / 하루 1회

`$CLAUDE_PLUGIN_DATA/done-<project>-<date>` 디렉토리를 `mkdir`(원자적 연산)로 만든다. 같은 날 여러 세션이 동시에 떠도 **정확히 하나의 세션만** 락을 잡아 점검을 실행한다(중복 0).

## 메모리 경로 자동 인식

설정이 필요 없다. hook이 런타임에 현재 세션의 프로젝트 메모리를 찾는다:

- write 차단: `tool_input.file_path`가 이미 절대경로 → `*/memory/MEMORY.md` 패턴만 매칭.
- stale 점검: `transcript_path` → `dirname` → `/memory/` (CC가 결정한 경로를 그대로 사용).

플러그인을 한 번 설치하면 **모든 프로젝트에서 각자의 메모리에 자동 적용**된다.

> 엣지케이스: `autoMemoryDirectory`로 메모리 위치를 커스텀한 프로젝트는 기본 경로 가정이 어긋날 수 있다.

## 설치

```bash
/plugin marketplace add aydenden/cc-plugins
/plugin install memory-guard
```

또는 로컬 테스트:

```bash
claude --plugin-dir ./plugins/memory-guard
```

> hook은 세션 시작 시 로드된다. 설정 변경 후에는 CC를 재시작해야 적용된다.
>
> stale 점검(②)의 `asyncRewake`는 비교적 최신 CC hook 기능이다. 미지원 버전에서는 조용히 무시되거나 동기 실행될 수 있다(인덱스 차단 hook ①은 영향 없음). 최신 Claude Code 사용을 권장한다.

## OpenCode 지원

`opencode-claude-memory` 플러그인과 같은 CC auto memory 경로(`~/.claude/projects/<encoded>/memory/`)를 공유한다. OpenCode에서 `memory_save` 도구로 memory를 저장할 때 동일한 한도·점검 로직이 적용된다.

### 구조 (하이브리드)

```
plugins/memory-guard/
├── .claude-plugin/plugin.json     # CC 플러그인 메타데이터
├── hooks/                         # CC hook (shell 스크립트)
│   ├── hooks.json
│   └── scripts/
│       ├── index-guard.sh         # CC: PreToolUse → MEMORY.md write 차단
│       └── memory-check.sh        # CC: SessionStart → 하루 1회 stale 점검
├── package.json                   # OC 플러그인 메타데이터 (비배포)
├── src/
│   └── index.ts                   # OC Plugin 엔트리 (TypeScript)
└── README.md
```

### OpenCode 동작 방식

| CC hook | OpenCode Plugin API | 설명 |
|---|---|---|
| `PreToolUse` (Write\|Edit) → `index-guard.sh` | `tool.execute.before` | `memory_save` 도구 실행 전 MEMORY.md 인덱스 크기 가드 (TypeScript) |
| `SessionStart` → `memory-check.sh` | `experimental.chat.system.transform` | 하루 1회 stale·깨진 링크 점검 (TypeScript, system prompt에 결과 주입) |
| `${CLAUDE_PLUGIN_ROOT}` | `import.meta.dir` / `worktree` | 플러그인 루트 경로 참조 |

### OpenCode 설치

npm 배포는 하지 않는다. `opencode.json`에 GitHub repo 또는 로컬 경로로 직접 지정한다:

```jsonc
{
  "plugin": ["opencode-claude-memory", "github:aydenden/cc-plugins"]
}
```

> `opencode-claude-memory`가 먼저 로드되어 `memory_save` 도구를 등록해야 한다. memory-guard는 이 도구의 실행을 가로채서 가드한다.

### 경로 계산

CC와 동일한 로직으로 memory 경로를 계산한다:
1. `worktree` → `git rev-parse --git-common-dir` → canonical git root
2. 경로의 `/`를 `-`로 sanitize
3. `~/.claude/projects/<sanitized>/memory/`

`CLAUDE_CONFIG_DIR` 환경변수로 CC config 디렉토리를 오버라이드할 수 있다.

## 의존성

### CC

`jq`, coreutils(`wc`, `grep`, `sed`, `awk`, `sort`, `date`). macOS/Linux의 `date`·`wc -m`(UTF-8) 모두 대응.

### OpenCode

`@opencode-ai/plugin` SDK, `git` (경로 계산용). Bun 런타임이 TypeScript를 직접 실행하므로 빌드 단계가 없다.
