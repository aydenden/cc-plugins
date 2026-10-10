/**
 * mod(`hooks/register.mjs`)의 순수 로직 — `frontier-guard.mjs status` 출력과 세션의 컨텍스트 측정값을
 * 상태줄 문구와 Stop 판정으로 바꾼다.
 *
 * 마커 경로·프론티어는 CLI 가 계속 소유한다. mod 는 `node:` 모듈을 못 쓰므로 키 계산을 다시 짜면
 * 같은 규칙이 두 벌이 된다. mod 가 새로 가져오는 것은 컨텍스트뿐이다 — 세션이 실제 창 크기와 점유를
 * 알려주므로 트랜스크립트를 파싱하거나 모델 이름에서 창을 추측할 필요가 없다.
 *
 * `node:` import 를 두지 않는다. 이 파일은 hooks module 이 import 하므로 mod 의 실행 환경에서 돌아야 한다.
 */

import { HANDOFF_RATIO, contextLimitOf, decide } from './guard-core.mjs';

/**
 * `frontier-guard.mjs status` 의 stdout 을 읽는다. 못 읽으면 null(«모름»)이고, 가드는 모를 때 통과시킨다.
 *
 * @param {string | undefined} stdout
 * @returns {{
 *   markerPath: string,
 *   marker: {epic: string} | null,
 *   frontier: {pushable: string[], questions: string[], blocked: string[]} | null,
 *   epicOpen?: boolean,
 * } | null} `frontier` 가 null 이면 CLI 가 bd 를 못 읽은 것이다.
 */
export function parseStatus(stdout) {
  try {
    const json = JSON.parse(stdout);
    return json && typeof json === 'object' ? json : null;
  } catch {
    return null;
  }
}

/** 세션 측정값에서 판정 입력의 컨텍스트 두 값. 측정 전이면 점유 0 — 인계가 아니라 다음 티켓으로 되민다. */
function contextOf(usage) {
  const context = usage?.context;
  return {
    contextTokens: context?.tokens ?? 0,
    contextLimit: context?.window > 0 ? context.window : contextLimitOf(null),
  };
}

/**
 * 상태줄 한 줄. 선언하지 않은 세션이면 undefined(상태줄을 지운다).
 *
 * @param {ReturnType<typeof parseStatus>} status
 * @param {{context?: {tokens?: number, window: number, percent?: number}} | null} usage
 * @returns {string | undefined}
 */
export function statusLine(status, usage) {
  const epic = status?.marker?.epic;
  if (!epic) return undefined;
  const parts = [`long-run ${epic}`, `프론티어 ${status.frontier ? status.frontier.pushable.length : '모름'}`];
  const asked = status.frontier?.questions.length ?? 0;
  if (asked > 0) parts.push(`질문 대기 ${asked}`);
  const percent = usage?.context?.percent;
  if (typeof percent !== 'number') {
    parts.push('컨텍스트 측정 전');
  } else {
    parts.push(`컨텍스트 ${percent}%`);
    if (percent >= HANDOFF_RATIO * 100) parts.push('인계할 때');
  }
  return parts.join(' · ');
}

/**
 * Stop 판정. 판정 규칙은 `decide()` 그대로고, 입력만 status 출력과 세션 측정값에서 만든다.
 *
 * @param {{status: ReturnType<typeof parseStatus>, usage: object | null, stopHookActive: boolean}} input
 * @returns {{block: boolean, reason?: string, clear?: boolean, ratio: number}}
 */
export function stopVerdict({ status, usage, stopHookActive }) {
  return decide({
    marker: status?.marker ?? null,
    ...contextOf(usage),
    frontier: status?.frontier ?? null,
    epicOpen: status?.epicOpen !== false,
    stopHookActive,
  });
}
