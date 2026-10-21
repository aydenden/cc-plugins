import test from 'node:test';
import assert from 'node:assert/strict';

import { claimHashOf, claimTokenLine, newClaimToken, provesClaim } from '../lib/claim.mjs';

test('claim 토큰은 32자리 hex 다', () => {
  assert.match(newClaimToken(), /^[0-9a-f]{32}$/);
  assert.notEqual(newClaimToken(), newClaimToken());
});

// claim 을 부른 세션의 트랜스크립트에는 도구 결과로 토큰 줄이 남는다 — 그것이 주인의 증거다.
test('지금 마커의 토큰 줄이 있는 트랜스크립트는 claim 을 증명한다', () => {
  const token = newClaimToken();
  const transcript = `{"type":"tool_result","content":"${claimTokenLine(token)}"}\n`;
  assert.equal(provesClaim(transcript, claimHashOf(token)), true);
});

// 앞 주인의 트랜스크립트에도 토큰 줄은 있다. 「줄이 있다」가 아니라 「지금 마커의 토큰이다」를 본다.
test('🚨 옛 claim 의 토큰 줄로는 새 claim 을 증명하지 못한다', () => {
  const old = newClaimToken();
  const current = newClaimToken();
  assert.equal(provesClaim(claimTokenLine(old), claimHashOf(current)), false);
});

test('토큰 줄이 여럿이면 하나라도 맞으면 증명이다 — 같은 세션이 두 번 claim 할 수 있다', () => {
  const first = newClaimToken();
  const second = newClaimToken();
  const transcript = [claimTokenLine(first), 'noise', claimTokenLine(second)].join('\n');
  assert.equal(provesClaim(transcript, claimHashOf(second)), true);
});

test('트랜스크립트나 해시가 없으면 증명이 아니다', () => {
  assert.equal(provesClaim(null, claimHashOf('x')), false);
  assert.equal(provesClaim(claimTokenLine(newClaimToken()), null), false);
});

// 마커에 토큰을 적으면 마커를 읽은 세션도 증거를 갖게 된다.
test('마커에 적는 것은 토큰이 아니라 해시다', () => {
  const token = newClaimToken();
  assert.notEqual(claimHashOf(token), token);
  assert.equal(claimHashOf(token), claimHashOf(token));
});
