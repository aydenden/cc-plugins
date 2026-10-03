# beads 실측 제약과 정책

bd 1.2.2를 실제로 돌려 확인한 동작이다. **명령 사용법은 여기 적지 않는다** — beads 스킬과 `bd prime`이 소유한다. 이 문서는 그 둘에 없거나 문서·`--help`와 어긋나는 것, 그리고 이 워크플로우의 정책만 담는다.

## 문서와 다른 것

**`dolt.auto-commit`의 실효값은 `on`이다.** `--help`는 off라고 하지만 `bd config show`는 on을 보여주고, 실제로 bd 쓰기 1회마다 Dolt 커밋이 1개 생긴다. 작업 트리는 항상 clean으로 유지된다. 활발한 작업은 히스토리가 빠르게 늘어나므로 `bd compact`/`gc`가 필요해진다.

**push는 절대 자동으로 일어나지 않는다.** pour·close·update·burn 어떤 쓰기도 `remotes/origin/main`을 움직이지 않는다. 원격 반영은 `bd dolt push`를 명시적으로 실행할 때만이다. `bd mol burn`의 "deletions sync to remotes" 문구는 "다음 push 때 전파된다"는 뜻이다.

**`bd dolt show`의 `Remotes: (none)` 표시는 믿지 않는다.** 원격이 설정돼 있어도 none으로 나온다. 확인은 `bd dolt remote list`로 한다.

**`bd status`의 `Ready to Work` 수치는 `bd ready`와 어긋난다.** 게이트로 막힌 것을 ready로 세는 경우가 있다. 실제 착수 대상은 항상 `bd ready`로 판단한다.

**`bd worktree remove`는 push하지 않은 브랜치를 항상 거부한다.** 커밋이 없는 워크트리도, 병합이 끝난 브랜치도 `unpushed commits`로 막히고, upstream에 전부 올라간 경우에만 통과한다. 아래 커밋 정책(push는 명시적 지시가 있을 때만)을 지키면 매번 걸린다. `--force`는 이 검사만이 아니라 미커밋 변경·stash 검사까지 끄고 미커밋 파일을 함께 지운다. 브랜치는 남는다.

## 게이트

**`bd gate check`는 `human` 게이트를 평가하지 않는다.** `timer`/`gh:run`/`gh:pr`/`bead` 게이트만 평가하고, `human` 게이트는 `bd gate resolve`로만 열린다. 사람 승인이 필요한 지점에서 자동 진행을 기대하지 않는다.

## wisp

**wisp는 Dolt 커밋을 만들지 않고 기본 목록에 보이지 않는다.** 생성·close·gate resolve·burn 어느 것도 커밋을 남기지 않아 히스토리와 작업 큐를 오염시키지 않으므로 반복 운영 절차에 맞다. 대신 다루는 동안에는 `bd ready`/`bd list`에 `--include-ephemeral`을 붙여야 방금 만든 티켓이 보인다.

## formula로 할 수 없는 것

`.beads/formulas/*.formula.json|toml`은 **모양이 고정된 평면 절차**에만 쓴다. 실측으로 확인된 한계:

- **`acceptance`·`design` 키가 없다.** 조용히 무시된다. 수용 기준이 필요하면 pour 이후 `bd update`로 채운다.
- **`children`과 `depends_on`을 섞을 수 없다.** `children`이 있는 스텝은 epic이 되고, beads는 epic↔task 의존을 양방향 모두 거부한다 (`tasks can only block other tasks, not epics`). formula는 평면 DAG로만 쓴다.
- `enum`·`pattern` 제약은 선언해도 검증되지 않는다. `required`만 실제로 강제된다.
- 최상위 이름 키는 `name`이 아니라 **`formula`**다. `name`을 쓰면 `formula: name is required`라는 오해를 부르는 에러가 난다.

개수와 내용이 매번 달라지는 산출물(PRD를 쪼갠 슬라이스 등)은 formula로 찍을 수 없다. `bd create`를 반복 호출한다.

## 커밋 정책

기본은 보수적이다. 작업이 끝나면 `git status`와 제안할 명령을 **보고만** 하고, 실제 commit·push·`bd dolt push`는 사용자가 명시적으로 지시할 때만 실행한다.
