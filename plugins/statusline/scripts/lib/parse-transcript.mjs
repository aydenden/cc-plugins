/**
 * 세션 트랜스크립트(JSONL)와 usage API 응답을 읽는 순수 함수들.
 *
 * 트랜스크립트는 세션을 재개했을 때 «이전까지의 합계» 를 되찾는 곳이다. 이후의 턴은 hooks module 이
 * `turn.complete` 에서 더한다.
 */

const EMPTY_USAGE = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

/**
 * API 가 준 usage 를 네 값으로.
 *
 * @param {object | undefined} usage `input_tokens` 등 API 철자의 usage
 * @returns {{input: number, output: number, cacheRead: number, cacheWrite: number}}
 */
export function usageOf(usage) {
  return {
    input: usage?.input_tokens ?? 0,
    output: usage?.output_tokens ?? 0,
    cacheRead: usage?.cache_read_input_tokens ?? 0,
    cacheWrite: usage?.cache_creation_input_tokens ?? 0,
  };
}

/**
 * 두 usage 의 합.
 *
 * @param {ReturnType<typeof usageOf>} a
 * @param {ReturnType<typeof usageOf>} b
 * @returns {ReturnType<typeof usageOf>}
 */
export function addUsage(a, b) {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

/**
 * 트랜스크립트 전체에서 세션 이름·토큰 합계·압축 횟수·마지막 노력 수준을 읽는다.
 *
 * 한 응답은 내용 블록마다 줄이 따로 실리고 줄마다 같은 usage 가 붙는다. 요청 id 로 한 번만 센다.
 * 서브에이전트(sidechain) 줄은 메인 대화의 합계에 넣지 않는다. 깨진 줄은 건너뛴다 — 쓰는 도중의
 * 마지막 줄이 그럴 수 있다.
 *
 * @param {string} text
 * @returns {{customTitle: string | null, aiTitle: string | null, effort: string | null, compactions: number,
 *   lastResponseAt: number | null, total: ReturnType<typeof usageOf>, last: ReturnType<typeof usageOf> | null}}
 */
export function summarizeTranscript(text) {
  const summary = { customTitle: null, aiTitle: null, effort: null, compactions: 0, lastResponseAt: null, total: EMPTY_USAGE, last: null };
  const byRequest = new Map();
  for (const line of text.split('\n')) {
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type === 'custom-title' && typeof entry.customTitle === 'string' && entry.customTitle) {
      summary.customTitle = entry.customTitle;
    } else if (entry.type === 'ai-title' && typeof entry.aiTitle === 'string' && entry.aiTitle) {
      summary.aiTitle = entry.aiTitle;
    } else if (entry.type === 'system' && entry.subtype === 'compact_boundary' && entry.isSidechain !== true) {
      summary.compactions += 1;
    } else if (entry.type === 'assistant' && entry.isSidechain !== true && entry.message?.usage) {
      const usage = usageOf(entry.message.usage);
      byRequest.set(entry.requestId ?? entry.message.id ?? entry.uuid, usage);
      summary.last = usage;
      if (typeof entry.effort === 'string') summary.effort = entry.effort;
      const at = Date.parse(entry.timestamp ?? '');
      if (!Number.isNaN(at)) summary.lastResponseAt = at;
    }
  }
  for (const usage of byRequest.values()) summary.total = addUsage(summary.total, usage);
  return summary;
}

/**
 * 세션 루트에서 트랜스크립트 폴더 이름. Claude Code 는 경로의 영숫자가 아닌 글자를 `-` 로 바꾼다.
 *
 * @param {string} root
 * @returns {string}
 */
export function projectSlug(root) {
  return root.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * `/api/oauth/usage` 응답에서 모델별 주간 사용량과 추가 사용량. 금액은 응답의 `decimal_places`
 * (없으면 2) 만큼 내려 통화 단위로 돌려준다.
 *
 * @param {unknown} json
 * @returns {{perModel: Record<string, {percent: number, resetsAt: string | null}>,
 *   extra: {enabled: boolean, limit: number | null, used: number | null, utilization: number | null, currency: string} | null}}
 */
export function parseUsageApi(json) {
  const result = { perModel: {}, extra: null };
  if (json === null || typeof json !== 'object') return result;

  for (const limit of Array.isArray(json.limits) ? json.limits : []) {
    const name = limit?.scope?.model?.display_name;
    if (limit?.kind !== 'weekly_scoped' || typeof name !== 'string' || typeof limit.percent !== 'number') continue;
    const key = ['sonnet', 'opus', 'fable'].find((model) => name.toLowerCase().includes(model));
    if (key) result.perModel[key] = { percent: limit.percent, resetsAt: limit.resets_at ?? null };
  }
  // limits[] 로 옮겨 가기 전의 평평한 키. 새 꼴이 있으면 그쪽이 맞다.
  for (const [key, bucket] of [['sonnet', json.seven_day_sonnet], ['opus', json.seven_day_opus]]) {
    if (!result.perModel[key] && bucket && typeof bucket.utilization === 'number') {
      result.perModel[key] = { percent: bucket.utilization, resetsAt: bucket.resets_at ?? null };
    }
  }

  const extra = json.extra_usage;
  if (extra && typeof extra === 'object') {
    const scale = 10 ** (typeof extra.decimal_places === 'number' ? extra.decimal_places : 2);
    const amount = (value) => (typeof value === 'number' ? value / scale : null);
    result.extra = {
      enabled: extra.is_enabled === true,
      limit: amount(extra.monthly_limit),
      used: amount(extra.used_credits),
      utilization: typeof extra.utilization === 'number' ? extra.utilization : null,
      currency: typeof extra.currency === 'string' ? extra.currency : 'USD',
    };
  }
  return result;
}
