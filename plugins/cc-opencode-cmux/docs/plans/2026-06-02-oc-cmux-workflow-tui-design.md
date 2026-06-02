# OC cmux Workflow TUI — 설계 문서

- 작성일: 2026-06-02
- 대상 플러그인: `cc-opencode-cmux`
- 상태: 설계 합의 완료 (구현 대기)

## 1. 목적

CC 네이티브 Dynamic Workflow의 **동작 모델**(phase·동시성 큐·라이브 agent view·완료 통지)을
외부 TUI 프로그램으로 재현하되, **워커만 Claude `agent()` 대신 OpenCode(OC)로 치환**한다.

핵심 가치:
- **오케스트레이션은 CC(A)가** 직접 — 중간 CC 래퍼 서브에이전트 0개.
- **노동(긴 출력 생성)은 OC가** — 토큰 절감 유지.
- A는 시작/끝 두 번만 관여(**모드 1**: 개입 최소). 중간 진행은 B의 TUI가 시각화.

> 네이티브 Dynamic Workflow도 "메인 Claude가 스크립트 생성 → 별도 runtime이 백그라운드 실행 →
> 메인은 독립 진행하다 완료 통지/`/workflows` 모니터"였다. 본 설계는 그 runtime을 직접 구현하고
> 워커 spawn만 `oc-delegate.sh`로 바꾼 것이다.

## 2. 합의된 결정

| # | 항목 | 결정 |
|---|---|---|
| P0-1 | phase 모델 | **배리어**(phase 전부 완료 → 다음 phase). 배리어 내부에 **동시 실행 cap** |
| P0-1b | 동시성 | 큐 모델 — 큐에 N개, 동시 실행 **기본 3개**, done 시 큐에서 슬롯 충원 |
| P0-2 | TUI 스택 | **Node** |
| P0-3 | A→B 파라미터 | 디렉토리 규약 + `manifest.json` |
| P1-4 | 워커 spawn | B(TUI)가 `oc-delegate.sh`를 내부 호출, SSE done으로 완료 추적 |
| P1-5 | 동시 실행 수 | 3 |
| P1-6 | 실패 처리 | 나머지 계속 진행, 실패만 기록 → 전체 종료 후 A에 **실패분만 전달** |
| P2-7 | 완료 통지 | 기본 `Bash(run_in_background)` + `cmux wait-for`(완료 1회). 선택적 `Monitor`(phase별 다회) |
| P2-8 | 진입점 | `delegate-oc` 스킬에 `--workflow` **옵션** (CC가 작업량 보고 선택) |
| P2-9 | 결과 구조 | 분석 친화 — `result.json`/`failures.json` 요약 + phase별 산출 분리 |
| P2-10 | cmux 미존재 | **즉시 실패 처리**(fallback 없음) |

## 3. 아키텍처

```
A (메인 CC, Opus)                    B (cmux 패널 = Node TUI)         워커
─────────────────                    ──────────────────────         ────
delegate-oc --workflow 호출
  ├ phase별 spec + manifest 작성
  ├ oc-cmux-panel.sh open ──split──▶ 우측 패널 생성 (surface)
  ├ node oc-workflow-tui.js ───────▶ TUI 기동
  │   --manifest M --signal done-S      │ phase 루프 (배리어, 순차)
  └ Bash(bg): cmux wait-for done-S      │   phase N: 큐(동시 cap=3)
        ⋯ 토큰0 대기 ⋯                   │     └ oc-delegate.sh ──HTTP──▶ OC 세션
                                         │     └ SSE done 추적 → TUI 갱신
                                         │     실패→failures[] 기록, 계속
                                         │   전 phase 완료
  A 깸 ◀──wait-for -S done-S──────────── │ result.json + failures.json 기록
  └ 결과 폴더 분석 (성공물 + 실패만)        │ wait-for -S 발신
```

- **A (메인 CC)**: 오케스트레이션 두뇌. spec/manifest 작성, 패널 기동, 완료 대기, 결과 분석.
- **B (Node TUI)**: runtime. manifest 해석 → phase 배리어 루프 → 큐 스케줄 → OC spawn → 렌더 → 집계.
- **워커**: OC daemon 세션 (`oc-delegate.sh` 경유, 시각적 패널 아님 — TUI가 진행을 대리 렌더).

## 4. 컴포넌트

| 컴포넌트 | 신규/재사용 | 역할 |
|---|---|---|
| `bin/oc-workflow-tui.js` | **신규 (Node)** | 핵심 runtime. manifest→phase 배리어→큐(cap 3)→oc-delegate spawn→SSE 추적→TUI 렌더→집계→신호 |
| `bin/oc-cmux-panel.sh` | **신규** (`cmux-panel.sh` 차용) | open / run / wait / close. cmux 부재 시 즉시 exit 실패 |
| `bin/oc-delegate.sh` | 재사용 | 단일 OC 워커 실행 (B가 워커마다 호출) |
| `bin/oc-sse-watch.sh` | 재사용 | OC 세션 완료(SSE done) 추적원 |
| `bin/oc-daemon.sh` | 재사용 | OC daemon ensure |
| `skills/delegate-oc/SKILL.md` | **수정** | `--workflow` 모드 분기 + 선택 기준 문구 추가 |
| manifest / result 스키마 | **신규** | A↔B 계약 |

> 참고: `oc-sse-watch.sh` 주석상 이전 버전에 "cmux surface feeding"이 있었다가 v0.6.0에서 제거됨.
> 본 설계는 그 기능을 TUI 워크플로 형태로 재설계해 부활시키는 것에 해당한다.

## 5. 큐 모델 (배리어 + 동시성 cap)

phase별로 **대기 큐 + 동시 실행 슬롯 N(기본 3)**:

- 큐에 해당 phase의 spec 전부 적재.
- 항상 ≤N개만 OC daemon에 떠 있음. 한 워커 done → 큐에서 다음을 슬롯에 투입.
- phase 큐가 비고 실행 슬롯이 0 → **배리어 통과** → 다음 phase.
- 측정 근거(fanout): N=3 ~91%, N=5 ~97%, N=8 ~84% 효율. 기본 3은 안전한 출발점.

TUI 렌더 예: `phase-1  ███░░░░░░░  3 running · 7 queued · 0 done · 0 failed`

## 6. 데이터 흐름

1. A: phase별 spec 작성 → `<workdir>/manifest.json` + spec 본문.
2. A: `oc-cmux-panel.sh open <cwd>` → surface uuid.
3. A: 패널에서 `node oc-workflow-tui.js --manifest <M> --signal done-<surf>` 실행.
4. A: `Bash(run_in_background)`로 `cmux wait-for done-<surf>` (또는 manifest `notify: per-phase` 시 Monitor).
5. B: phase 루프(배리어). 각 phase 큐(cap 3) → spec마다 `oc-delegate.sh`.
6. B: 각 OC 완료(SSE done) → TUI 갱신, 산출물 수집.
7. B: 워커 실패(exit 10~30) → `failures[]` 기록 후 계속.
8. B: 전 phase 완료 → `result.json` + `failures.json` 작성 → `cmux wait-for -S done-<surf>` 발신.
9. A: 깸 → `result.json` 읽고 분석, `failures.json`으로 실패분만 재처리.

## 7. manifest 스키마 (입력, A→B)

```json
{
  "workdir": "<absolute path>",
  "concurrency": 3,
  "notify": "on-complete",          // "on-complete" | "per-phase"
  "phases": [
    {
      "id": "research",
      "specs": [
        { "id": "s1", "task_type": "research", "prompt_file": "<abs>", "dir": "<abs>" },
        { "id": "s2", "task_type": "research", "prompt_file": "<abs>", "dir": "<abs>" }
      ]
    },
    {
      "id": "compose",
      "specs": [ { "id": "c1", "task_type": "compose", "prompt_file": "<abs>", "dir": "<abs>" } ]
    }
  ]
}
```

- phase 순서 = 배열 순서 (배리어).
- `concurrency`는 전역 기본; phase별 override 허용(`phase.concurrency`).

## 8. 결과 폴더 구조 (출력, 분석 친화)

```
<workdir>/
├── manifest.json          # 입력 계약
├── result.json            # ★ 출력 요약 (A가 가장 먼저 읽음)
├── failures.json          # ★ 실패만 추림 (실패분만 전달)
├── phase-research/
│   ├── s1/  { report.txt, diff.patch, output.md, status, oc_sid }
│   └── s2/  ...
├── phase-compose/
│   └── c1/  ...
└── tui.log                # B narrator 진행 로그 (사후 추적)
```

`result.json` 형태:

```json
{
  "status": "completed_with_failures",   // "completed" | "completed_with_failures" | "aborted"
  "phases": [
    { "id": "research", "total": 2, "done": 2, "failed": 0 },
    { "id": "compose",  "total": 1, "done": 0, "failed": 1 }
  ],
  "failures": [
    { "phase": "compose", "spec": "c1", "exit_code": 13, "session_dir": "<abs>" }
  ]
}
```

A는 `result.json` 하나로 전체 파악 → `failures.json`으로 실패만 재처리 → 성공물은
`phase-*/＊/output*` 경로로 접근. 성공/실패가 파일 레벨에서 분리되어 "실패분만 전달"이 자연 충족.

## 9. 진입점 (delegate-oc --workflow)

```bash
# 기존 (단일/소량)
oc-delegate.sh --dir "$PWD" <<EOF ... EOF      # 또는 oc-fanout.sh (평면 N개)

# 신규 workflow 모드 (다단계·대량)
oc-delegate.sh --workflow --manifest <M> --dir "$PWD"
#   → 내부에서 oc-cmux-panel.sh + oc-workflow-tui.js 경로로 분기
```

스킬 선택 기준(본문 추가): **phase ≥ 2 또는 총 워커 ≥ 6 이면 `--workflow`, 아니면 기존 fanout.**

## 10. 완료 통지 모델

| 방식 | 통지 | 사용 |
|---|---|---|
| `Bash(run_in_background)` + `cmux wait-for done-<surf>` | 완료 1회 | **기본** (모드1, 토큰0 대기) |
| `Monitor`(B가 phase 경계마다 stdout 1줄 emit) | phase별 다회 | manifest `notify: per-phase` 일 때만 |

## 11. 에러 / 경계 처리

- **워커 실패**: phase 진행 중단하지 않음. `failures[]`에 누적, 전체 종료 후 A에 전달.
- **cmux 부재**: `oc-cmux-panel.sh`가 즉시 비정상 종료(실행 자체 거부). fallback 없음.
- **OC daemon 실패**: 기존 `oc-delegate.sh` exit code 계약(10~13) 그대로 워커 단위 실패로 기록.
- **timeout**: 워커별 `--timeout` 유지. phase/전체 상한은 manifest 확장 여지.

## 12. 범위 밖 (추후)

- **스트리밍(pipeline) phase 모델**: item별 독립 stage 통과. 본 v1은 배리어만. v2 후보.
- **동적 확장**(loop-until-dry, budget scaling): 본 v1은 정적 manifest. 추후 manifest 확장.
- **A 실행 중 개입(모드2)**: 본 v1은 모드1 전용.

## 13. §13 미해결 항목 — 조사 후 해소 (2026-06-02)

### 13-1. TUI 스택 → **ink (React 기반 Node TUI)** 확정

- 환경: node **v26.0.0**, npm 11.12.1, npx 존재. **ink 6.4.11 + ink-spinner + ink-gradient 이미 글로벌 설치됨.**
- B의 TUI는 **입력을 받지 않음**(A는 `wait-for`+파일로 통신, 사용자는 보기만) → ink의 선언적 상태→자동 리렌더가
  phase/워커 진행 렌더에 최적. Ghostty/`xterm-256color` 완전 지원.
- 대안(자체 ANSI)은 의존성 0이지만 라이브 상태 관리를 수작업. ink가 이미 있으므로 ink 우위.
- **남은 실무 결정**: 플러그인 배포 시 ink 의존성 처리 — `bin/`에 `package.json` + `node_modules` 번들 vs
  글로벌 의존 가정. (설계엔 영향 없음, 패키징 단계 결정)

### 13-2. 완료 감지 채널 → **oc-delegate.sh child의 exit code + stdout** (SSE 멀티플렉싱 불필요)

- 핵심 발견: `oc-prompt.sh` POST가 **동기적**(OC 루프 완료까지 블로킹). `oc-delegate.sh`는 워커당 SSE watcher를
  내부 캡슐화하고 **완료까지 블로킹 후 exit code(0 / 10~13 / 20 / 30) + 7줄 stdout 리포트**를 반환한다.
- 따라서 B는 **각 워커를 `oc-delegate.sh` child_process로 spawn → child exit = 완료 신호, stdout = 리포트**만
  관리하면 된다. 단일 SSE 멀티플렉싱·done 파일 폴링 **불필요**. (fanout.sh가 이미 이 프로세스 모델)
- B는 child stdout 7줄(`status/session/oc_sid/files/diff/done/notes`)을 파싱해 `result.json`의 워커 항목을 채운다.

### 13-3. SESSION_DIR 격리 → **`--session-dir <workdir>/phase-<pid>/<sid>` 규약**

- `oc-delegate.sh`가 `--session-dir DIR` 플래그를 이미 지원. fanout의 `s$i` 패턴을 phase 인지형으로 확장.
- 각 워커가 독립 SESSION_DIR → 충돌 없음. oc-delegate가 그 디렉토리에 다음을 생성하므로 §8 결과 폴더와 자연 정합:
  `controller.log`, `prompt.md`, `sse.ndjson`, `done`, `oc_sid`, `response.json`, `diff.patch`.
  여기에 B가 child **stdout을 `report.txt`로 리다이렉트**하면 워커 디렉토리가 완성된다(fanout과 동일 방식).

### 결론: 아키텍처 단순화

§13-2 덕분에 B(ink TUI)는 "SSE 파서"가 아니라 **"`oc-delegate.sh` child_process 풀 매니저 + 렌더러"**가 된다:

```
B(ink): phase 루프(배리어)
  └ phase마다: 큐(N specs) + 동시 슬롯 cap=3
       └ 슬롯마다 spawn: oc-delegate.sh --session-dir <workdir>/phase-<pid>/<sid>
                                        --prompt-file <spec> --dir <dir>
       └ child.on('exit', code => { 슬롯 반환 → 큐 다음 투입; result 누적; 리렌더 })
  └ 전 phase 완료 → result.json/failures.json 기록 → cmux wait-for -S 발신
```

이 모델은 기존 자산(`oc-delegate.sh`)을 **수정 없이** 워커로 재사용하며, B의 신규 코드는 순수하게
"큐 스케줄링 + ink 렌더 + 결과 집계"로 한정된다.
```
