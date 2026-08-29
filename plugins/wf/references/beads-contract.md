# beads 호출 규약과 실측 제약

bd 1.2.2를 실제로 돌려 확인한 동작이다. 문서나 `--help`와 어긋나는 항목이 있으니 그대로 따른다.

## 이슈 조작

```bash
bd create --title= --description= --type=task|bug|feature --priority=0..4 \
          --acceptance="..." --design="..." --notes="..." [--parent=<id>]
bd dep add <이슈> <선행이슈>          # 선행이 이슈를 블록한다
bd ready                              # 블로커 없는 것만
bd update <id> --claim                # 착수
bd close <id> --suggest-next          # 닫고 해금된 것 노출
bd human <id>                         # 사람 판단 필요 표시
bd list --format dot                  # DAG 시각화
```

우선순위는 `0`~`4` 또는 `P0`~`P4`다. `high`/`medium`/`low`는 거부된다.

`bd edit`은 `$EDITOR`를 띄워 에이전트를 멈추게 한다. 필드 수정은 `bd update --title/--description/--notes/--design`으로 한다.

## 실측 제약 — 문서와 다른 것

**`dolt.auto-commit`의 실효값은 `on`이다.** `--help`는 off라고 하지만 `bd config show`는 on을 보여주고, 실제로 bd 쓰기 1회마다 Dolt 커밋이 1개 생긴다. 작업 트리는 항상 clean으로 유지된다. 활발한 작업은 히스토리가 빠르게 늘어나므로 `bd compact`/`gc`가 필요해진다.

**push는 절대 자동으로 일어나지 않는다.** pour·close·update·burn 어떤 쓰기도 `remotes/origin/main`을 움직이지 않는다. 원격 반영은 `bd dolt push`를 명시적으로 실행할 때만이다. `bd mol burn`의 "deletions sync to remotes" 문구는 "다음 push 때 전파된다"는 뜻이다.

**`bd dolt show`의 `Remotes: (none)` 표시는 믿지 않는다.** 원격이 설정돼 있어도 none으로 나온다. 확인은 `bd dolt remote list`로 한다.

**`bd status`의 `Ready to Work` 수치는 `bd ready`와 어긋난다.** 게이트로 막힌 것을 ready로 세는 경우가 있다. 실제 착수 대상은 항상 `bd ready`로 판단한다.

## 게이트

게이트는 `type: gate`인 **독립 이슈**로 만들어져 대상 스텝을 블록한다.

```bash
bd gate list            # 열린 게이트
bd gate check           # 자동 판정 가능한 것만 평가
bd gate resolve <id>    # 수동 해제
```

`bd gate check`는 `timer`/`gh:run`/`gh:pr`/`bead` 게이트만 평가한다. **`human` 게이트는 검사 대상이 아니며 `bd gate resolve`로만 열린다.** 사람 승인이 필요한 지점에서 자동 진행을 기대하지 않는다.

## wisp와 mol

| | wisp (vapor) | mol (liquid) |
|---|---|---|
| `bd ready`/`bd list` 기본 노출 | 안 됨 — `--include-ephemeral` 필요 | 바로 보임 |
| Dolt 커밋 | 전혀 생기지 않음 | 쓰기마다 1개 |
| ID | `<prefix>-wisp-xxx` | `<prefix>-mol-xxx` |

wisp의 전 생애(생성·close·gate resolve·burn)가 Dolt 커밋을 하나도 만들지 않는다. 히스토리와 작업 큐를 오염시키지 않으므로 반복 운영 절차에 적합하다. 다만 **wisp를 다루는 동안에는 `bd ready`/`bd list`에 `--include-ephemeral`을 붙여야 한다.** 안 붙이면 방금 만든 티켓이 보이지 않는다.

정리는 `bd mol burn <root> --force`다. `--dry-run`으로 삭제 대상을 먼저 확인한다.

## formula로 할 수 없는 것

`.beads/formulas/*.formula.json|toml`은 **모양이 고정된 평면 절차**에만 쓴다. 실측으로 확인된 한계:

- **`acceptance`·`design` 키가 없다.** 조용히 무시된다. 수용 기준이 필요하면 pour 이후 `bd update`로 채운다.
- **`children`과 `depends_on`을 섞을 수 없다.** `children`이 있는 스텝은 epic이 되고, beads는 epic↔task 의존을 양방향 모두 거부한다 (`tasks can only block other tasks, not epics`). formula는 평면 DAG로만 쓴다.
- `enum`·`pattern` 제약은 선언해도 검증되지 않는다. `required`만 실제로 강제된다.
- 최상위 이름 키는 `name`이 아니라 **`formula`**다. `name`을 쓰면 `formula: name is required`라는 오해를 부르는 에러가 난다.

개수와 내용이 매번 달라지는 산출물(PRD를 쪼갠 슬라이스 등)은 formula로 찍을 수 없다. `bd create`를 반복 호출한다.

## 커밋 정책

기본은 보수적이다. 작업이 끝나면 `git status`와 제안할 명령을 **보고만** 하고, 실제 commit·push·`bd dolt push`는 사용자가 명시적으로 지시할 때만 실행한다.
