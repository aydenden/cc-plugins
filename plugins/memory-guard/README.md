# memory-guard

CC auto memory(`~/.claude/projects/<proj>/memory/`)가 **비대해지고 stale 항목이 쌓이는 것**을 막는 hook 플러그인.

## 문제

CC auto memory는 `MEMORY.md`(인덱스) + 토픽 `.md` 파일로 구성된다. 그런데:

- **인덱스가 계속 커진다** — CC는 `MEMORY.md`의 앞부분(25,000B / 200줄)만 세션 시작에 로드한다. 한도를 넘으면 **조용히 잘라서 로드**(에러·경고 없음) → 매 세션 거대 텍스트 주입(오염) + 뒷부분 누락(그 세션에 존재하지 않는 지식이 된다).
- **지워야 할 과거 내용이 남는다** — CC는 메모리 파일을 자동 정리/압축/삭제하지 **않는다**. 토픽 파일도 방치되어 깨진 링크·노후 항목·아무도 안 가리키는 파일이 쌓인다.

근본 원인은 **강제 장치의 부재**다. 규칙(한 항목 한 줄, detail은 토픽으로)은 텍스트 지침일 뿐, write를 검사하는 메커니즘이 없어 전적으로 에이전트 자율 준수에 의존한다.

## 설계: 불변과 관례를 가른다

이 플러그인은 어떤 프로젝트의 메모리에도 붙는다. 그래서 **어디서나 참인 것만 코드에 두고, 프로젝트마다 다른 것은 설정으로 받는다**.

| | 판정 근거 | 어디에 |
|---|---|---|
| **불변** | 하드캡(claude 실행파일에 박힌 상수), 인덱스만 매 세션 로드된다는 비용 구조, 깨진 링크·고아 토픽·노후 | 코드 |
| **관례** | 섹션 크기, 토픽 선행 작성 강제 | `.memory-guard.json` |

한도도 절대 상수가 아니라 **하드캡에서 유도**한다. 캡만이 사실이고 예산은 그로부터 남긴 여유다.

```
예산      = 하드캡 × headroom(기본 0.9)  →  22,500B / 180줄
항목 상한 = (예산 바이트 ÷ 예산 줄) × entrySlack(기본 1.4)  →  175B
```

항목 상한의 축이 **문자가 아니라 바이트**인 이유: 한글은 UTF-8에서 3바이트라 "250자" 같은 문자 상한은 최대 750B를 허용한다. 줄당 평균 허용치의 6배인데도 크기 캡이 항상 먼저 걸려 **한 번도 구속하지 않는 죽은 규칙**이 된다.

구조 판정은 헤더 포맷을 가정하지 않는다. `## topic.md — desc` 같은 관례를 요구하면 그 관례를 안 쓰는 인덱스에서 전 토픽이 오탐된다. 대신 **링크와 문자열 언급**으로 본다 — 찾으려는 것은 "어디에도 안 적힌 파일"이므로 언급이면 참조로 충분하다.

## 2개의 hook

### ① `hooks/index-guard.mjs` — 인덱스 write 차단 (PreToolUse)

`Write|Edit`가 메모리 인덱스를 **키우는 방향**으로 한도를 넘기면 `exit 2`로 차단하고, 진단(현재/예상 크기, 한도, 이 인덱스의 항목 평균, 가장 긴 항목 top5)을 피드백한다.

- **차단 기준은 "결과 상태"** — 파일을 키우면서 한도 초과/긴 항목 추가일 때만 차단.
- **줄이는(정리) write는 항상 통과** → 막혔다가 푸는 루프가 데드락 없이 돈다.
- **같은 크기로 갈아끼우는 write도 통과** → 예산에 닿은 뒤에는 "하나를 빼야 하나를 넣는다"가 별도 규칙 없이 성립한다.
- Edit는 바이트 델타(`old - len(old_string) + len(new_string)`)로 결과 크기를 정확히 계산한다.

### ② `hooks/memory-check.mjs` — 하루 1회 stale·비대 점검 (SessionStart, asyncRewake)

새 세션(`source=startup`) 시작 시, 그 세션 프로젝트의 메모리를 **결정적으로**(무료, LLM 없이) 점검한다.

- 검출: 예산·하드캡 초과, 깨진 내부 링크(`](x.md)`, `[[wiki]]`), **고아 토픽**(인덱스가 어디서도 언급하지 않는 파일), 노후(본문 최신 날짜 90일 경과).
- 후보가 있으면 `exit 2` → `asyncRewake`가 결과를 **메인 세션에 system reminder로 주입** → 에이전트가 의미 판단 후 처리. 후보가 없으면 조용히 종료.
- **자동 삭제하지 않는다** — `archive/`로 이동하거나 마킹하고 사용자에게 확인.

#### 왜 여기는 차단이 아니라 알림인가

링크·고아·섹션 판정은 인덱스 포맷을 추론해서 내리므로 오판 가능성이 남는다. **오판한 알림은 무시하면 그만이지만 오판한 차단은 데드락이다.** 차단은 하드캡에 직결된 것(크기·줄 수·항목 길이)만 한다.

#### 동시성 / 하루 1회

`$CLAUDE_PLUGIN_DATA/done-<memory-dir>-<date>` 디렉토리를 `mkdir`(원자적 연산)로 만든다. 같은 날 여러 세션이 동시에 떠도 **정확히 하나의 세션만** 락을 잡아 점검을 실행한다(중복 0). 7일 지난 락은 정리한다.

## 메모리 경로 자동 인식

설정이 필요 없다. hook이 런타임에 현재 세션의 메모리를 찾는다:

- write 차단: `tool_input.file_path`의 basename이 `MEMORY.md`이고, 부모 디렉터리가 `memory`이거나 옆에 `.memory-guard.json`이 있을 때.
- stale 점검: `transcript_path` → `dirname` → `/memory/`. 없으면 cwd의 `.claude/settings{,.local}.json`에서 **`autoMemoryDirectory`**를 읽는다.

즉 메모리를 프로젝트 안(`<repo>/memory/`)으로 옮긴 배치도 그대로 지원한다.

## 설정 (선택)

메모리 디렉터리 안에 `.memory-guard.json`을 두면 관례를 선언할 수 있다. 없으면 전부 기본값이고, 값이 범위를 벗어나거나 파일이 깨져 있으면 조용히 기본값으로 되돌린다 — 설정 오타 하나로 모든 write가 막히면 안 되기 때문이다.

```jsonc
{
  "headroom": 0.9,          // 하드캡 대비 예산 비율 (0.3–1)
  "entrySlack": 1.4,        // 평균 허용 줄 대비 항목 상한 배수 (1–10)
  "staleDays": 90,
  "section": { "min": 3, "max": 8 },  // 생략하면 섹션 크기 검사 자체가 꺼진다
  "requireTopicFirst": false,          // 토픽 파일이 없는 인덱스 줄 추가를 차단
  "exclude": ["scratch*.md"]           // 고아·노후 검사에서 뺄 파일 (기본 제외에 더해진다)
}
```

기본 제외: `MEMORY.md`, `README.md`, `_*`, `.*`, `*.draft.md`. 하위 디렉터리(`archive/` 등)는 애초에 스캔하지 않으므로 그리로 옮긴 파일은 조용해진다.

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
> stale 점검(②)의 `asyncRewake`는 비교적 최신 CC hook 기능이다. 미지원 버전에서는 조용히 무시되거나 동기 실행될 수 있다(인덱스 차단 hook ①은 영향 없음).

## OpenCode 지원

`opencode-claude-memory` 플러그인과 같은 CC auto memory 경로(`~/.claude/projects/<encoded>/memory/`)를 공유한다. OpenCode에서 `memory_save` 도구로 memory를 저장할 때 **같은 코어를 통과**하므로 한도가 갈라지지 않는다.

### 구조

```
plugins/memory-guard/
├── .claude-plugin/plugin.json     # CC 플러그인 메타데이터
├── hooks/
│   ├── hooks.json
│   ├── index-guard.mjs            # CC: PreToolUse → MEMORY.md write 차단
│   └── memory-check.mjs           # CC: SessionStart → 하루 1회 점검
├── src/
│   ├── core.mjs                   # 순수 판정 로직 — 상수·한도의 정본
│   ├── core.test.mjs
│   ├── fs-adapter.mjs             # 경로 해석·설정 로드·락 (I/O)
│   └── index.ts                   # OpenCode Plugin 엔트리
├── package.json                   # OC 플러그인 메타데이터 (비배포)
└── README.md
```

| CC hook | OpenCode Plugin API |
|---|---|
| `PreToolUse` (Write\|Edit) → `index-guard.mjs` | `tool.execute.before` — `memory_save` 실행 전 가드 |
| `SessionStart` → `memory-check.mjs` | `experimental.chat.system.transform` — system prompt에 점검 결과 주입 |
| `${CLAUDE_PLUGIN_ROOT}` | `import.meta.dir` / `worktree` |

### OpenCode 설치

npm 배포는 하지 않는다. `opencode.json`에 GitHub repo 또는 로컬 경로로 직접 지정한다:

```jsonc
{
  "plugin": ["opencode-claude-memory", "github:aydenden/cc-plugins"]
}
```

> `opencode-claude-memory`가 먼저 로드되어 `memory_save` 도구를 등록해야 한다. memory-guard는 이 도구의 실행을 가로채서 가드한다.

### 경로 계산 (OpenCode)

CC와 동일한 로직으로 memory 경로를 계산한다:
1. `worktree` → `git rev-parse --git-common-dir` → canonical git root
2. 경로의 `/`를 `-`로 sanitize
3. `~/.claude/projects/<sanitized>/memory/`

`CLAUDE_CONFIG_DIR` 환경변수로 CC config 디렉토리를 오버라이드할 수 있다.

## 테스트

```bash
node --test plugins/memory-guard/src/core.test.mjs
```

판정 로직은 파일시스템을 만지지 않으므로 인덱스 본문과 파일 목록을 문자열/배열로 스텁한다.

## 의존성

`node`(CC 자체가 node로 돈다). 외부 패키지 없음. OpenCode 쪽은 `@opencode-ai/plugin` SDK와 `git`(경로 계산용)이 추가로 필요하고, Bun이 TypeScript를 직접 실행하므로 빌드 단계가 없다.
