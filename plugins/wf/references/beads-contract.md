# beads 실측 제약과 정책

bd 1.3.1(Homebrew, embedded 모드)을 실제로 돌려 확인한 동작이다(2026-10-12 측정. 1.2.2 에서 2026-08-29 에 처음 쟀고, 그때와 달라진 항목은 그 자리에 적었다). **다른 버전·server 모드에서는 재지 않았다.** 아래 항목이 실제 출력과 어긋나면 출력을 믿고 이 문서를 고친다. **명령 사용법은 여기 적지 않는다** — beads 스킬과 `bd prime`이 소유한다. 이 문서는 그 둘에 없거나 문서·`--help`와 어긋나는 것, 그리고 이 워크플로우의 정책만 담는다.

## 문서와 다른 것

**`dolt.auto-commit`의 기본값은 `on`이다.** `bd config show`가 on을 보여주고, 실제로 bd 쓰기 1회(create·update·close·pour)마다 Dolt 커밋이 1개 생긴다. (1.2.2 의 `--help`는 off라고 적었다. 1.3.1 은 `Default: on`이라고 적는다.) 작업 트리는 항상 clean으로 유지된다. 활발한 작업은 히스토리가 빠르게 늘어나므로 `bd compact`/`gc`가 필요해진다.

**push는 절대 자동으로 일어나지 않는다.** pour·close·update·burn 어떤 쓰기도 `remotes/origin/main`을 움직이지 않는다. 원격 반영은 `bd dolt push`를 명시적으로 실행할 때만이다. `bd mol burn`의 "deletions sync to remotes" 문구는 "다음 push 때 전파된다"는 뜻이다.

**`bd status`의 `Ready to Work` 수치는 `bd ready`와 어긋난다.** 게이트로 막힌 것을 ready로 세는 경우가 있다. 실제 착수 대상은 항상 `bd ready`로 판단한다.

**`bd worktree remove`는 upstream이 없는 브랜치를 그대로는 거부한다.** 커밋이 없는 워크트리도, 병합이 끝난 브랜치도 `cannot verify unpushed commits`로 막힌다. 통과하는 길은 둘이다 — 브랜치가 upstream에 전부 올라가 있거나, `--merged-into <ref>`로 HEAD가 들어 있는 ref를 댄다(1.2.2 에는 없던 플래그다). 아래 커밋 정책(push는 명시적 지시가 있을 때만)을 지키면 병합한 뒤 `--merged-into`를 쓰게 된다. `--force`는 이 검사만이 아니라 미커밋 변경 검사까지 끄고 미커밋 파일을 함께 지운다. `--force`와 `--merged-into`는 함께 쓸 수 없다. 어느 길로 지워도 브랜치는 남는다.

## 게이트

**`bd gate check`는 `human` 게이트를 평가하지 않는다.** `timer`/`gh:run`/`gh:pr`/`bead` 게이트만 평가하고, `human` 게이트는 사람이 `bd gate resolve`(또는 게이트 이슈에 `bd close`)를 실행해야 열린다. 사람 승인이 필요한 지점에서 자동 진행을 기대하지 않는다.

## wisp

**wisp는 Dolt 커밋을 만들지 않고 기본 목록에 보이지 않는다.** 생성·close·(formula 스텝의 게이트에 대한) gate resolve·burn 어느 것도 커밋을 남기지 않아 히스토리와 작업 큐를 오염시키지 않으므로 반복 운영 절차에 맞다. 대신 다루는 동안에는 `bd ready`/`bd list`에 `--include-ephemeral`을 붙여야 방금 만든 티켓이 보인다. wisp에 `bd gate create`로 따로 붙인 게이트는 wisp가 아니라서 커밋을 만든다.

## formula로 할 수 없는 것

`.beads/formulas/*.formula.json|toml`은 **모양이 고정된 절차**에만 쓴다. 실측으로 확인된 한계:

- **`acceptance`·`acceptance_criteria`·`design` 키가 없다.** 조용히 무시된다. 수용 기준이 필요하면 pour 이후 `bd update`로 채운다.
- 최상위 이름 키는 `name`이 아니라 **`formula`**다. `name`을 쓰면 `formula: name is required`라는 오해를 부르는 에러가 난다.

1.2.2 에서 한계였다가 1.3.1 에서 풀린 것 — 더 낮은 버전에서 돌 생성물이면 여전히 피한다:

- `children`이 있는 스텝(epic이 된다)과 `depends_on`을 섞을 수 있다. 1.2.2 는 epic↔task 의존을 `tasks can only block other tasks, not epics`로 거부했다.
- 변수의 `enum`·`pattern`이 pour 때 검증된다(어긋나면 exit 1, 아무것도 만들지 않는다). 1.2.2 는 `required`만 강제했다.

개수와 내용이 매번 달라지는 산출물(스펙을 쪼갠 슬라이스 등)은 formula로 찍을 수 없다. `bd create`를 반복 호출한다.

## 커밋 정책

기본은 보수적이다. 작업이 끝나면 `git status`와 제안할 명령을 **보고만** 하고, 실제 commit·push·`bd dolt push`는 사용자가 명시적으로 지시할 때만 실행한다.
