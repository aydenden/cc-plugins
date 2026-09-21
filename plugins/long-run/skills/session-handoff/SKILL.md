---
name: session-handoff
description: "Hand the current session's work over to a fresh claude session in a new Orca tab — allocate the doc path, delegate the write-up to the `handoff` skill, boot the new session on it, and step out. Ownership transfer, not orchestration: the sending session does not supervise or wait. Triggers: '컨텍스트 꽉 찼어', '새 세션에 넘겨줘', '인계해줘', '핸드오프 문서 써줘', '/session-handoff'; when the remaining work will not fit in a single session. A coordinator that delegates a child task and waits for its reply is a different thing and does not belong here."
---

# Session Handoff — 세션을 갈아끼우고 작업을 이어간다

컨텍스트가 포화된 세션은 조용히 나빠진다. 규약이 빠지고, 확정했던 사실을 다시 추정하고, 스킬을 부르는
대신 "대충 아는" 요약으로 대신한다. 그래서 **세션을 갈아끼우되 작업은 이어간다** — 새 Orca 탭에
claude 를 띄우고, 인계 문서 하나로 소유권을 넘긴 뒤, 이 세션은 빠진다.

**오케스트레이션이 아니다.** 보내는 세션은 감시하지 않고, 기다리지 않고, 답신을 받지 않는다. 감시하면
코디네이터가 되고, 컨텍스트를 비우려던 목적이 그대로 사라진다.

| | 이 스킬 | 코디네이터 위임 |
|---|---|---|
| 관계 | 소유권 이전 (바통 터치) | 분업 (코디네이터 ↔ 워커) |
| 보내는 세션 | 인계 후 끝난다 | 남아서 완료 통보를 기다린다 |
| 단위 | 지금 하던 일 전부 | 자식 작업 하나 |

워커로 떠 있던 세션이 이 스킬로 갈아타면 완료 통보를 보낼 주체가 바뀐다. 그 명령 전문을 인계 문서
§7 에 실어 넘긴다 — 빠뜨리면 코디네이터가 올 리 없는 통보를 기다린다.

## 언제

사용자가 부르면 그때가 그때다. 사용자가 먼저 말하지 않아도 아래에서는 **제안**한다 — 판단은 사용자가 한다.

- 컨텍스트가 압박되기 시작했고 남은 작업이 아직 여러 단계다
- 한 단계가 끝나 다음 단계로 넘어가는 경계다
- 긴 조사로 컨텍스트가 채워졌는데, 결론은 몇 줄이고 그다음 작업은 별개다

반대로 **남은 일이 한두 턴이면 넘기지 않는다.** 인계 문서 작성·검증 비용이 남은 작업보다 크다.

## 전제

`orca` 가 PATH 에 있어야 한다. `--close-self` 는 이 세션이 Orca 터미널에서 돌고 있을 때만 동작한다
(`ORCA_TERMINAL_HANDLE`). bd 를 쓰는 작업이면 `--bd` 로 진행 정본을 가리킨다.

본문 합성을 위임할 `handoff` 스킬이 있어야 한다. 없으면 사용자에게 `/setup-matt-pocock-skills` 를
알리고, 그 세션에서는 템플릿만으로 쓴 뒤 **그 사실을 보고한다** — 대화 압축·비밀 삭제 판단이 빠진
문서라고 적는다.

## 절차

### 1. 상태를 확정한다 (문서보다 먼저)

기억이 아니라 지금 상태를 읽는다. 인계 문서의 신뢰도는 여기서 결정된다.

```bash
bd children <부모id>      # 진행 정본 — 열린 자식이 곧 '아직 안 된 것'
git status --short && git log --oneline -5
```

dev 서버·브라우저 세션·백그라운드 작업이 떠 있으면 그 사실도 확인한다(문서 §5 에 들어간다).

### 2. 인계 문서를 쓴다

**본문 합성은 `handoff` 스킬에 위임한다.** 대화를 압축해 다음 에이전트가 읽을 문서로 만드는 판단은
그 스킬이 소유한다 — 여기서 그것을 다시 쓰면 지시문만 한 겹 늘고 원본의 품질이 희석된다. 이 스킬이
소유하는 것은 **그 문서가 놓이는 자리와 형식 계약**뿐이다.

먼저 경로를 받는다 — 손으로 조립하지 않는다.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/handoff.mjs" allocate --slug {슬러그}
# → <HANDOFF_ROOT 또는 ~/.claude/handoff>/<worktree 키>/<슬러그>/handoff-NN.md
# 폴더를 직접 정하려면: allocate {디렉터리 절대경로}
```

번호를 올려 쌓고 덮어쓰지 않는다 — 정돈이 아니라 **인계 사슬을 남기기 위해서다.** 3차 인계 세션이
1차에서 뭘 확정했는지 되짚을 수 있어야 한다.

그다음 `handoff` 스킬을 호출하고, 그것이 합성한 본문에 `references/handoff-doc.md` 의 계약을 씌워 위
경로에 Write 한다. 두 가지를 **덮어써야 한다**:

- 🚨 **저장 위치.** `handoff` 는 OS 임시 디렉터리에 쓴다. 여기서는 위에서 받은 경로다 — 임시 디렉터리는
  청소되고 번호도 안 붙어서 인계 사슬이 남지 않는다.
- **절 구성.** 스크립트가 읽는 머리 줄(`- **worktree**:`)과 §0·§5·§7 은 이 플러그인의 계약이다.

**템플릿을 읽지 않고 쓰지 않는다** — 어느 절이 왜 필요하고, 쓴 뒤 무엇을 자문해야 하는지가 거기 있다.

### 3. 넘기고 빠진다

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/handoff.mjs" send \
  --doc <문서 절대경로> --close-self \
  [--bd <부모id>] [--worktree <selector>] [--title <탭 제목>] [--close-delay <초>] [--submit-wait <초>]
```

`--worktree` 를 생략하면 **지금 셸의 cwd** 를 담는 worktree 에 탭이 뜬다. 주려면 orca 의 전체
셀렉터여야 한다(`<repoId>::<경로>`) — 폴더명 같은 짧은 이름은 `selector_not_found` 로 죽는다.
`orca worktree list --json` 에서 얻는다.

🚨 **cwd 조회는 틀려도 실패하지 않는다.** 셸이 작업 worktree 가 아닌 다른 등록된 worktree 에 서 있으면
조회가 조용히 성공해 **엉뚱한 탭**이 뜬다(실측으로 밟았다 — 새 세션이 작업 저장소 밖에서 깨어나
프로젝트 지침조차 못 읽었다). 그래서 스크립트가 문서 머리의 `- **worktree**:` 줄과 대상을 대조해 다르면
exit 2 로 막는다. 막히면 **문서의 worktree 에서 다시 보내거나** 셀렉터를 명시한다.
`--force-worktree` 는 의도한 이동일 때만 쓴다.

**제출은 추측하지 않고 orca 에게 묻는다.** 스크립트는 TUI 가 입력을 받을 상태가 됐는지
(`terminal wait --for tui-idle` 의 `satisfied`) 확인한 뒤 프롬프트를 보내고, 수령증의 단계가
`turn_started` 에 닿았는지 본다. 증거가 없으면 **보내지 않았거나 시작되지 않은 것으로 보고 exit 6**
으로 죽는다 — 재전송은 하지 않는다. 출력의 `submission` 절이 그 판정이다.

보낸 뒤 이 세션이 하는 일은 **사용자에게 한 줄 보고하고 끝내는 것**뿐이다. 새 탭을 읽지 않고, 추가
지시를 보내지 않는다.

### 자기 탭 정리 — `--close-self`

**기본으로 붙인다.** 빠진 세션의 탭은 claude 프로세스를 문 채로 남고, 쌓이면 pty 와 메모리를 계속
먹는다(실측: 살아 있는 orca 터미널 17개 중 6개가 claude 가 이미 끝난 빈 셸이었다). 그 탭에 사람이 남아
결과를 더 보겠다고 하면 그때만 뺀다.

제출이 확인된 뒤 기본 30초를 세고 분리된 프로세스가 이 탭을 닫는다. 그 지연은 대기가 아니라 **죽는
순서** 때문이다 — 그 안에 보고 출력이 화면에 닿고 Stop hook 이 돈다. 그래서 send 가 돌아온 뒤
**도구를 더 부르지 않고 바로 보고하고 턴을 끝낸다.** 늦게 끝나면 보고가 그대로 사라진다. 오래 걸릴 일이
남았으면 `--close-delay <초>` 로 늘린다(최소 10).

orca 밖에서 돌리면 예약을 건너뛰고 인계는 그대로 성공한다. 닫기 실패는 탭이 남아 있는 것으로만
드러나므로 이유는 `<LONG_RUN_STATE_ROOT 또는 ~/.claude/long-run>/session-handoff/close-tab.log` 에 적힌다.

## 함정

- **새 탭은 같은 worktree 를 쓴다.** dev 서버·포트·브라우저 세션이 공유되므로, 문서 §5 를 채워 새
  세션이 중복 기동하지 않게 한다.
- **진행 정본은 문서가 아니라 bd 다.** 문서는 쓰는 순간 낡기 시작한다. 둘이 어긋나면 bd 가 이긴다 —
  프롬프트에도 그렇게 실려 나간다.
- **손으로 `terminal send` 하지 않는다.** 프롬프트는 한 줄이어야 하고(raw 바이트라 개행에서 제출된다),
  `--enter` 없이 `--text` 만 주면 입력창에 얹히기만 한다. 스크립트가 둘 다 지키고 있다.
- **침묵을 유실로 읽고 다시 보내지 않는다.** 같은 지시를 두 번 받은 세션은 같은 일을 두 번 한다. 애매한
  전송 실패는 수령증의 `requestId` 로 `orca terminal send --retry-request <id>` — 그 ID 는 프롬프트와
  프로세스 incarnation 에 묶여 있어 중복 실행이 되지 않는다.
- **권한 모드는 뜰 때 정해진다.** 실행 중인 claude 세션의 모드는 밖에서 못 바꾼다(바꾸려면 재시작).
  기본 `auto` 로 뜨며, 다르게 하려면 `--permission-mode <모드>` 를 **보내기 전에** 정한다.
- **자기 탭을 닫는 것은 보낸 세션뿐이다.** 받은 세션에게 이전 탭을 닫으라고 시키지 않는다 — 닫기가
  인계 성공에 걸려 있어야 하는데, 받은 쪽에 맡기면 그 지시를 건너뛰어도 아무도 모른다.
- **탭을 닫는 순간 그 세션의 스크롤백은 사라진다.** 보고 화면에만 적고 문서에 안 적은 사실은 닫히는
  즉시 유실이다.
- **문서 없이 탭부터 띄우지 않는다.** 스크립트가 `--doc` 실재를 확인해 막는다(exit 2). 빈 세션에
  "이어서 해줘"만 보내면 그 세션은 아무것도 모른 채 헤맨다.

## Improvement rule

인계하며 발견한 마찰은 소유한 곳에 **그 자리에서** 반영한다 — 문서 형식·작성 규칙·검증 질문은
`references/handoff-doc.md`, 탭 기동과 제출 판정은 `scripts/lib/cli.mjs`, 문서 경로 규약은
`scripts/lib/handoff-path.mjs`. 절차 자체가 바뀌면 사용자와 합의한 뒤 이 SKILL.md 를 고친다.
