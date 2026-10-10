/**
 * 프론티어 가드의 순수 로직 — «이 세션이 지금 멈춰도 되는가» 를 판정한다.
 *
 * 규약은 사람이 지키는 것이 아니라 하네스가 막는 것이다. 맵의 운영 규약이 «묻지 않고 완료조건까지
 * 간다» 라고 적어 두었어도, 티켓 하나를 닫은 자리에서 «다음으로 갈까요?» 로 멈추는 일이 반복됐다.
 * 그래서 Stop hook 이 그 자리를 막는다.
 *
 * ## 판정의 축은 넷이다
 *
 * | 축 | 근거 |
 * |---|---|
 * | 이 세션이 미는 맵이 있는가 | 마커 파일(`claim` 이 쓴다). 없으면 가드는 아무것도 안 한다 |
 * | 컨텍스트가 얼마나 찼는가 | 트랜스크립트의 마지막 `usage` — 추정이 아니라 API 가 센 값이다 |
 * | 프론티어에 지금 밀 수 있는 것이 있는가 | 열린 자식(`bd list --parent`)을 `bd ready` 와 `human` 라벨로 가른 것. 못 읽으면 «모름» |
 * | 맵이 닫혔는가 | `bd show <epic>` 의 status — 프론티어가 빈 것만으로는 선언을 지우지 않는다 |
 *
 * 🚨 **`stop_hook_active` 면 무조건 통과시킨다.** 그 값이 참이라는 것은 이미 이 훅 때문에 한 번
 * 되돌려 보냈다는 뜻이다. 거기서 또 막으면 세션이 영영 안 끝난다. 즉 가드의 힘은 «멈춤 시도마다
 * 한 번 되민다» 이지 «못 멈추게 한다» 가 아니다 — 그 선을 넘으면 사용자가 Ctrl+C 로만 빠져나오게 된다.
 */

/** 컨텍스트가 이만큼 차면 이어가지 말고 넘긴다. 맵 운영 규약의 «50% 에서 session-handoff». */
export const HANDOFF_RATIO = 0.5;

/** 인계를 지시할 때 부를 스킬. 문구를 여기 한 곳에 둬서 스킬 이름이 바뀔 때 갈라지지 않게 한다. */
export const HANDOFF_SKILL = '/long-run:session-handoff';

/**
 * mod 가 판정을 맡은 Stop 에 붙이는 필드. mod 는 `next({ ...e, [MOD_FLAG]: true })` 로 넘기고, 그 아래에서
 * 도는 node 훅은 stdin 에서 이 필드를 보고 빠진다. 환경변수가 아니라 이벤트에 싣는 이유: 환경변수는
 * mod 가 꺼진 뒤에도 프로세스에 남아 node 훅까지 입을 다물게 만든다.
 */
export const MOD_FLAG = 'long_run_mod';

/** 이 Stop 을 mod 가 이미 판정했는가. 표지가 없으면 mod 가 안 뜬 환경이므로 node 훅이 판정한다. */
export const isDelegatedToMod = (input) => input?.[MOD_FLAG] === true;

/** 사람의 답을 기다리는 질문 티켓의 라벨. bd 가 `bd human list`·`respond` 로 다루는 바로 그 라벨이다. */
export const QUESTION_LABEL = 'human';

/** 「멈춰도 되는 자리」 중 승인이 필요한 바깥 쓰기의 예시. */
const EXTERNAL_WRITES = '이슈 트래커·문서·push·외부 시스템';

/**
 * 멈춰도 되는 네 자리. 문구는 헌장의 운영 규약과 **같아야 한다** — 훅이 되밀 때 헌장과 다른 목록을
 * 내밀면 세션이 어느 쪽을 따를지 모른다(`test/charter-wording.test.mjs` 가 두 곳을 대조한다).
 *
 * 갈림길이 멈추는 자리가 아닌 이유: 거기서 서면 그 질문과 무관한 티켓까지 함께 선다. 그렇다고
 * 「묻지 않는다」로 되밀면 되돌리기 비싼 선택을 에이전트가 혼자 확정한다. 그래서 질문은 티켓으로
 * 주차하고, 무엇이 그 답을 기다리는지는 문장이 아니라 `bd dep` 으로 적는다 — 가드가 읽을 수 있는
 * 것은 데이터뿐이다. 갈림길과 국소 선택을 가르는 기준은 헌장이 소유한다.
 */
export const STOP_PLACE_LIST = (pct) => [
  `맵을 닫았다`,
  `컨텍스트 ${pct} 초과(그때는 \`${HANDOFF_SKILL}\`)`,
  `승인이 필요한 바깥 쓰기(${EXTERNAL_WRITES})`,
  `주차한 질문에 막혀 밀 수 있는 티켓이 없을 때`,
];

const STOP_PLACES = (pct) => `${STOP_PLACE_LIST(pct).join(' · ')}. ${PARKING_RULE}`;

/** 갈림길에서 하는 일. 헌장의 같은 문단과 낱말까지 맞춘다. */
export const PARKING_RULE =
  `목적지·완료조건을 바꾸는 갈림길(A/B)은 멈추지 않고 주차한다 — 질문을 \`bd create --labels ${QUESTION_LABEL}\` 티켓으로 만들고, ` +
  `그 답이 있어야 하는 티켓마다 \`bd dep add <티켓> <질문>\` 을 건 뒤 나머지를 민다. ` +
  `국소 선택(A.1/A.2)은 묻지 않고 고르고 이유를 close reason 에 남긴다`;

/**
 * 모델 이름에 창 크기가 실려 온다 — `claude-opus-5[1m]`. 없으면 표준 창으로 본다.
 *
 * 🚨 **`message.model` 에는 그 접미사가 없다.** 거기에는 `claude-opus-5` 만 실리고, 창을 말하는 것은
 * 트랜스크립트의 `attachment.identity.modelId` 다(실측: 같은 세션에서 앞은 `claude-opus-5`,
 * 뒤는 `claude-opus-5[1m]`). 앞만 보면 100만 창 세션을 20만으로 재서 **한참 이른 인계**를 시킨다.
 */
export function contextLimitOf(model) {
  if (typeof model === 'string' && /\[1m\]/i.test(model)) return 1_000_000;
  return 200_000;
}

/**
 * 한 턴이 실제로 점유한 컨텍스트. 캐시에서 읽은 토큰도 창을 차지한다 — `cache_read` 를 빼면
 * 긴 세션이 영원히 «비어 있음» 으로 보인다.
 */
export function contextTokensOf(usage) {
  if (!usage) return 0;
  return (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
}

/**
 * 트랜스크립트(jsonl)에서 마지막 `usage` 와 모델을 뽑는다.
 *
 * 줄 하나가 깨져 있어도 멈추지 않는다 — 훅이 죽으면 세션이 못 멈추는 것이 아니라 가드가 조용히
 * 사라지므로, 파싱 실패는 «모름» 으로 떨어뜨린다.
 */
export function readTranscriptTail(text) {
  let usage = null;
  let model = null;
  for (const line of String(text ?? '').split('\n')) {
    if (!line) continue;
    let json;
    try {
      json = JSON.parse(line);
    } catch {
      continue;
    }
    if (json?.message?.usage) usage = json.message.usage;
    // 창을 아는 쪽이 이긴다 — `attachment.identity.modelId` 에만 `[1m]` 이 붙는다(위 함수 주석).
    const identity = json?.attachment?.identity?.modelId;
    if (identity) model = identity;
    else if (json?.message?.model && !model) model = json.message.model;
  }
  return { usage, model };
}

/**
 * 열린 자식을 «지금 밀 수 있는 것» 과 «기다리는 것» 으로 가른다.
 *
 * 열린 자식의 수만 세면 질문 하나에 걸린 티켓과 지금 밀 수 있는 티켓이 같은 한 건으로 보인다.
 * 그러면 가드는 대기뿐인 프론티어에서도 «다음 티켓을 claim 하라» 고 되민다.
 *
 * @param {{children: {id: string, status?: string, labels?: string[] | null}[], readyIds: string[]}} input
 *   `children` 은 `bd list --parent <epic>` 의 닫히지 않은 행, `readyIds` 는 `bd ready --parent <epic>` 의 id.
 * @returns {{pushable: string[], questions: string[], blocked: string[]}}
 */
export function classifyFrontier({ children, readyIds }) {
  const ready = new Set(readyIds);
  const frontier = { pushable: [], questions: [], blocked: [] };
  for (const child of children) {
    if (child.labels?.includes(QUESTION_LABEL)) frontier.questions.push(child.id);
    else if (child.status === 'in_progress' || ready.has(child.id)) frontier.pushable.push(child.id);
    else frontier.blocked.push(child.id);
  }
  return frontier;
}

/**
 * 멈춰도 되는가.
 *
 * @param {{
 *   marker: {epic: string} | null,
 *   contextTokens: number,
 *   contextLimit: number,
 *   frontier: ReturnType<typeof classifyFrontier> | null,
 *   epicOpen?: boolean,
 *   stopHookActive: boolean,
 *   isStopEvent?: boolean,
 *   handoffRatio?: number,
 * }} input `frontier` 가 null 이면 «모름» 이다 — bd 를 못 읽었다는 뜻이지 비었다는 뜻이 아니다.
 * @returns {{block: boolean, reason?: string, clear?: boolean, ratio: number}}
 */
export function decide({ marker, contextTokens, contextLimit, frontier, epicOpen = true, stopHookActive, isStopEvent = true, handoffRatio = HANDOFF_RATIO }) {
  const ratio = contextLimit > 0 ? contextTokens / contextLimit : 0;
  const pct = `${Math.round(ratio * 100)}%`;

  // 🚨 Stop 이 아닌 이벤트에서는 아무 말도 하지 않는다. 배선이 `PostToolUse` 로 들어가면 파일을
  // 고칠 때마다 판정이 터져 «작업 중» 을 «멈추려 함» 으로 오해한 잔소리가 된다(실측으로 밟았다).
  if (!isStopEvent) return { block: false, ratio };
  // 🚨 두 번째 막음은 없다(머리말).
  if (stopHookActive) return { block: false, ratio };
  // 가드는 선언한 세션에만 붙는다 — 맵을 밀고 있지 않은 세션까지 막으면 못 쓰는 도구가 된다.
  if (!marker?.epic) return { block: false, ratio };
  // 모를 때는 통과시키되 선언을 남긴다 — 지우면 bd 가 잠깐 죽은 것만으로 가드가 사라진다.
  if (!frontier) return { block: false, ratio };

  const { pushable, questions, blocked } = frontier;
  if (pushable.length === 0 && questions.length + blocked.length > 0) {
    const asked = questions.length
      ? `답을 기다리는 질문이 ${questions.length}건이다(${questions.join(', ')}).`
      : `질문 티켓은 없는데 열린 티켓이 전부 막혀 있다 — 무엇에 막혔는지 \`bd blocked\` 로 본다.`;
    const held = blocked.length ? ` 거기 막힌 티켓 ${blocked.length}건(${blocked.join(', ')}).` : '';
    return {
      block: true,
      ratio,
      reason:
        `${marker.epic} 에 지금 밀 수 있는 티켓이 없다. ${asked}${held} ` +
        `**기다리는 것을 한 번에 모아 보고하고 멈춘다** — 질문마다 A/B 와 각 선택이 완료 조건에 무엇을 바꾸는지 한 줄씩. ` +
        `답은 \`bd human respond <id>\` 로 받는다(닫히면 막힌 티켓이 풀린다). ` +
        `🚨 마커는 지우지 않는다 — 답이 오면 이 worktree 에서 이어 민다.`,
    };
  }
  const closing = pushable.length === 0;
  // 맵이 닫힌 것을 본 뒤에만 선언을 지운다 — 열린 자식이 0 이라는 것만으로는 «다 했다» 가 아니다.
  if (closing && !epicOpen) return { block: false, clear: true, ratio };

  if (ratio >= handoffRatio) {
    const left = closing
      ? `프론티어는 비었지만 맵을 닫는 일(완료 조건 검증)이 남았고`
      : `프론티어가 ${pushable.length}건 남았지만`;
    return {
      block: true,
      ratio,
      reason:
        `컨텍스트 ${pct} 다(${contextTokens.toLocaleString()} / ${contextLimit.toLocaleString()}). ${marker.epic} 의 ${left} ` +
        `이 세션에서 더 밀지 않는다 — **${HANDOFF_SKILL} 로 넘긴다**(\`--bd ${marker.epic}\`). ` +
        `🚨 마커는 지우지 않는다 — worktree 당 파일 하나라 지우면 새 세션이 가드 없이 출발한다. ` +
        `보내는 세션은 지우지 않아도 멈출 수 있다(두 번째 멈춤은 무조건 통과한다). ` +
        `사용자에게 넘길지 묻지 않는다 — 그것이 규약이다.`,
    };
  }

  if (closing) {
    return {
      block: true,
      ratio,
      reason:
        `${marker.epic} 의 프론티어가 비었다. 그것은 «다 했다» 일 수도, «티켓을 안 만들었다» 일 수도 있다 — 닫기 전에 가른다. ` +
        `**새 컨텍스트의 서브에이전트 하나**에게 헌장(Destination·완료 조건·확정된 결정)과 이 맵의 변경 범위를 주고, ` +
        `완료 조건을 줄마다 실제로 돌려 참/거짓과 그 출력을 받아 온다. 헌장의 「아직 규정 못 한 것」이 비었는지도 본다. ` +
        `거짓인 줄과 남은 안개는 그 자리에서 티켓으로 만든다(그러면 프론티어가 다시 찬다). ` +
        `확정된 결정을 뒤집는 지적은 반영하지 않고 \`bd create --labels ${QUESTION_LABEL}\` 질문으로 주차한다. ` +
        `전부 참이면 \`bd close ${marker.epic} --reason "<줄마다의 관측>"\` 으로 맵을 닫는다 — 닫힌 것을 보고서야 가드가 선언을 지운다. ` +
        `맵을 접는 것이라면 \`frontier-guard.mjs clear\` 로 선언을 직접 지운다.`,
    };
  }

  const waitingParts = [questions.length && `질문 ${questions.length}건`, blocked.length && `막힌 티켓 ${blocked.length}건`].filter(Boolean);
  const parked = waitingParts.length ? `${waitingParts.join('·')}은 답을 기다리므로 건드리지 않는다. ` : '';
  return {
    block: true,
    ratio,
    reason:
      `${marker.epic} 의 프론티어가 ${pushable.length}건 남았다(${pushable.join(', ')}). ${parked}` +
      `**곧장 다음 티켓을 \`bd update <id> --claim\` 하고 이어간다 — «다음으로 갈까요?» 라고 묻지 않는다.** ` +
      `컨텍스트는 ${pct} 라 아직 넘길 자리가 아니다. 멈춰도 되는 자리는 넷뿐이다: ` +
      `${STOP_PLACES(`${Math.round(handoffRatio * 100)}%`)}. ` +
      `그 넷이 아니면 보고는 작업 사이가 아니라 세션 끝에 한 번 한다.`,
  };
}
