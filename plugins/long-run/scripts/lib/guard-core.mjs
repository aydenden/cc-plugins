/**
 * 프론티어 가드의 순수 로직 — «이 세션이 지금 멈춰도 되는가» 를 판정한다.
 *
 * 규약은 사람이 지키는 것이 아니라 하네스가 막는 것이다. 맵의 운영 규약이 «묻지 않고 완료조건까지
 * 간다» 라고 적어 두었어도, 티켓 하나를 닫은 자리에서 «다음으로 갈까요?» 로 멈추는 일이 반복됐다.
 * 그래서 Stop hook 이 그 자리를 막는다.
 *
 * ## 판정의 축은 셋이다
 *
 * | 축 | 근거 |
 * |---|---|
 * | 이 세션이 미는 맵이 있는가 | 마커 파일(`claim` 이 쓴다). 없으면 가드는 아무것도 안 한다 |
 * | 컨텍스트가 얼마나 찼는가 | 트랜스크립트의 마지막 `usage` — 추정이 아니라 API 가 센 값이다 |
 * | 프론티어가 남았는가 | `bd list --parent <epic>` 의 열린 자식 |
 *
 * 🚨 **`stop_hook_active` 면 무조건 통과시킨다.** 그 값이 참이라는 것은 이미 이 훅 때문에 한 번
 * 되돌려 보냈다는 뜻이다. 거기서 또 막으면 세션이 영영 안 끝난다. 즉 가드의 힘은 «멈춤 시도마다
 * 한 번 되민다» 이지 «못 멈추게 한다» 가 아니다 — 그 선을 넘으면 사용자가 Ctrl+C 로만 빠져나오게 된다.
 */

/** 컨텍스트가 이만큼 차면 이어가지 말고 넘긴다. 맵 운영 규약의 «50% 에서 session-handoff». */
export const HANDOFF_RATIO = 0.5;

/** 인계를 지시할 때 부를 스킬. 문구를 여기 한 곳에 둬서 스킬 이름이 바뀔 때 갈라지지 않게 한다. */
export const HANDOFF_SKILL = '/long-run:session-handoff';

/** 「멈춰도 되는 자리」 중 승인이 필요한 바깥 쓰기의 예시. */
const EXTERNAL_WRITES = '이슈 트래커·문서·push·외부 시스템';

/**
 * 멈춰도 되는 네 자리. 문구는 헌장의 운영 규약과 **같아야 한다** — 훅이 되밀 때 헌장과 다른 목록을
 * 내밀면 세션이 어느 쪽을 따를지 모른다.
 *
 * 넷째 항이 있는 이유: 목적지를 바꾸는 갈림길에서까지 「묻지 않는다」로 되밀면, 되돌리기 비싼 선택을
 * 에이전트가 혼자 확정하게 된다. 반대로 국소 선택(어느 쪽이어도 완료 조건의 참/거짓이 같은 것)까지
 * 물으면 맵이 굴러가지 않으므로, 그 둘을 가르는 기준은 헌장이 소유한다.
 */
const STOP_PLACES = (pct) =>
  `프론티어가 비었다 · 컨텍스트 ${pct} 초과(그때는 session-handoff) · 승인이 필요한 바깥 쓰기(${EXTERNAL_WRITES}) · ` +
  `목적지·완료조건을 바꾸는 갈림길(A/B). 국소 선택(A.1/A.2)은 묻지 않고 고르고 이유를 close reason 에 남긴다`;

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
 * 멈춰도 되는가.
 *
 * @param {{
 *   marker: {epic: string} | null,
 *   contextTokens: number,
 *   contextLimit: number,
 *   openChildren: {id: string, priority?: number}[],
 *   stopHookActive: boolean,
 *   isStopEvent?: boolean,
 *   handoffRatio?: number,
 * }} input
 * @returns {{block: boolean, reason?: string, clear?: boolean, ratio: number}}
 */
export function decide({ marker, contextTokens, contextLimit, openChildren, stopHookActive, isStopEvent = true, handoffRatio = HANDOFF_RATIO }) {
  const ratio = contextLimit > 0 ? contextTokens / contextLimit : 0;
  const pct = `${Math.round(ratio * 100)}%`;

  // 🚨 Stop 이 아닌 이벤트에서는 아무 말도 하지 않는다. 배선이 `PostToolUse` 로 들어가면 파일을
  // 고칠 때마다 판정이 터져 «작업 중» 을 «멈추려 함» 으로 오해한 잔소리가 된다(실측으로 밟았다).
  if (!isStopEvent) return { block: false, ratio };
  // 🚨 두 번째 막음은 없다(머리말).
  if (stopHookActive) return { block: false, ratio };
  // 가드는 선언한 세션에만 붙는다 — 맵을 밀고 있지 않은 세션까지 막으면 못 쓰는 도구가 된다.
  if (!marker?.epic) return { block: false, ratio };

  const open = openChildren ?? [];
  if (open.length === 0) {
    return { block: false, clear: true, ratio };
  }

  if (ratio >= handoffRatio) {
    return {
      block: true,
      ratio,
      reason:
        `컨텍스트 ${pct} 다(${contextTokens.toLocaleString()} / ${contextLimit.toLocaleString()}). ${marker.epic} 의 프론티어가 ` +
        `${open.length}건 남았지만 이 세션에서 더 밀지 않는다 — **${HANDOFF_SKILL} 로 넘긴다**(\`--bd ${marker.epic}\`). ` +
        `🚨 마커는 지우지 않는다 — worktree 당 파일 하나라 지우면 새 세션이 가드 없이 출발한다. ` +
        `보내는 세션은 지우지 않아도 멈출 수 있다(두 번째 멈춤은 무조건 통과한다). ` +
        `사용자에게 넘길지 묻지 않는다 — 그것이 규약이다.`,
    };
  }

  return {
    block: true,
    ratio,
    reason:
      `${marker.epic} 의 프론티어가 ${open.length}건 남았다(${open.map((c) => c.id).join(', ')}). ` +
      `**곧장 다음 티켓을 \`bd update <id> --claim\` 하고 이어간다 — «다음으로 갈까요?» 라고 묻지 않는다.** ` +
      `컨텍스트는 ${pct} 라 아직 넘길 자리가 아니다. 멈춰도 되는 자리는 넷뿐이다: ` +
      `${STOP_PLACES(`${Math.round(handoffRatio * 100)}%`)}. ` +
      `그 넷이 아니면 보고는 작업 사이가 아니라 세션 끝에 한 번 한다.`,
  };
}
