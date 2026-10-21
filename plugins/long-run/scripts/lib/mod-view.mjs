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

import { HANDOFF_RATIO, HANDOFF_SKILL, contextLimitOf, decide } from './guard-core.mjs';

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

/** 세션 측정값에서 판정 입력의 컨텍스트. 측정 전이면 «못 쟀다» 로 싣는다 — 0 을 여유로 읽히게 두지 않는다. */
function contextOf(usage) {
  const context = usage?.context;
  return {
    contextTokens: context?.tokens ?? 0,
    contextLimit: context?.window > 0 ? context.window : contextLimitOf(null),
    measured: typeof context?.tokens === 'number',
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
  if (status.owner === false) return `long-run ${epic} · 다른 세션이 주인`;
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
 * `status.owner` 가 null(아무도 주인이 아님)이면 주인이 아닌 것으로 본다 — Stop 에서는 node 훅이 먼저
 * 돌아 claim 을 증명한 세션을 주인으로 적으므로, 그 뒤에도 null 이면 이 세션은 claim 하지 않았다.
 * 칸이 없으면(`--session` 없이 물은 status) 주인 자리에서 본 것이다.
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
    owner: status?.owner === undefined || status.owner === true,
    closedSinceSession: status?.closedSinceSession ?? null,
    stopHookActive,
  });
}

/**
 * 맵을 미는 세션이 압축될 때 요약 지시와 압축 뒤 대화에 남길 말. 그 세션의 맵이 아니면 undefined.
 *
 * 압축된 세션은 맵의 운영 규약을 잃는다. 그렇다고 압축을 막으면 창이 넘칠 때 막다른 길이 된다 —
 * 그래서 막지 않고, 하던 티켓까지만 가서 넘기라고 남긴다. 주인이 아직 정해지지 않은(null) 맵은 이
 * 세션이 claim 한 직후일 수 있어 지시를 남긴다.
 *
 * @param {ReturnType<typeof parseStatus>} status
 * @returns {string | undefined}
 */
export function compactNote(status) {
  const epic = status?.marker?.epic;
  if (!epic || status.owner === false) return undefined;
  return (
    `이 세션은 맵 ${epic} 을 밀고 있었고 방금 대화가 압축됐다. 맵 id 와 지금 claim 한 티켓 id 는 요약에 남긴다. ` +
    `압축된 세션은 맵의 운영 규약을 잃으므로 새 티켓을 잡지 않는다 — 하던 티켓을 닫을 수 있는 자리까지만 가고 ` +
    `${HANDOFF_SKILL} --bd ${epic} 으로 넘긴다.`
  );
}
