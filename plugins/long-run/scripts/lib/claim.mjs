/**
 * claim 토큰 — 「이 세션이 그 맵을 claim 했다」의 증거.
 *
 * 같은 worktree 에서 판정되는 것은 claim 을 부른 주인 세션 하나다(`guard-core.mjs` 의 `ownership`).
 * 그 세션을 가르는 표지가 일회용 토큰이다: `claim` 이 토큰 줄을 출력하면 그 줄이 부른 세션의
 * 트랜스크립트에 도구 결과로 남고, 마커에는 해시만 적는다 — 토큰을 적으면 마커를 읽은 세션도 증거를
 * 갖게 된다.
 *
 * `guard-core.mjs` 와 갈라 둔 이유: 그쪽은 mod 가 import 하므로 `node:` 모듈을 쓸 수 없다.
 */

import { createHash, randomBytes } from 'node:crypto';

/** 새 claim 토큰. 32자리 hex. */
export const newClaimToken = () => randomBytes(16).toString('hex');

/** 마커에 적는 토큰의 해시. */
export const claimHashOf = (token) => createHash('sha256').update(String(token)).digest('hex');

/** claim 이 출력하는 토큰 줄. */
export const claimTokenLine = (token) => `[frontier-guard] claim-token=${token}`;

const CLAIM_TOKEN_PATTERN = /claim-token=([0-9a-f]{32})/g;

/**
 * 이 트랜스크립트가 그 claim 을 했다는 증거를 갖는가. 토큰 줄을 모두 뽑아 해시로 맞춘다 — 앞 주인의
 * 트랜스크립트에도 토큰 줄은 있으므로, 「줄이 있다」가 아니라 「지금 마커의 토큰이다」를 봐야 한다.
 *
 * @param {string | null} transcriptText
 * @param {string | null} claimHash
 * @returns {boolean}
 */
export function provesClaim(transcriptText, claimHash) {
  if (typeof transcriptText !== 'string' || !claimHash) return false;
  for (const [, token] of transcriptText.matchAll(CLAIM_TOKEN_PATTERN)) {
    if (claimHashOf(token) === claimHash) return true;
  }
  return false;
}
