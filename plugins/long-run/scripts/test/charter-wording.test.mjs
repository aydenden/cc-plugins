import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { HANDOFF_RATIO, PARKING_RULE, STOP_PLACE_LIST } from '../lib/guard-core.mjs';

// 헌장은 맵마다 epic 본문으로 복사되고, 가드는 되밀 때 같은 규칙을 다시 말한다. 두 문구가 갈라지면
// 세션은 어느 쪽을 따를지 모른다 — 주석의 «같아야 한다» 로는 갈라지는 것을 막지 못했다.
const charter = readFileSync(new URL('../../skills/map-run/assets/map-charter.md', import.meta.url), 'utf8')
  .replace(/\s+/g, ' ');
const pct = `${Math.round(HANDOFF_RATIO * 100)}%`;

test('헌장의 멈춰도 되는 자리 넷은 가드가 되밀 때 말하는 넷과 낱말까지 같다', () => {
  const places = STOP_PLACE_LIST(pct);
  assert.equal(places.length, 4);
  for (const place of places) assert.ok(charter.includes(place), `헌장에 없다: ${place}`);
});

test('헌장의 갈림길 주차 규칙은 가드의 것과 낱말까지 같다', () => {
  assert.ok(charter.includes(PARKING_RULE), `헌장에 없다: ${PARKING_RULE}`);
});
