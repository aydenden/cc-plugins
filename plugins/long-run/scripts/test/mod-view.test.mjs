import test from 'node:test';
import assert from 'node:assert/strict';

import { HANDOFF_SKILL } from '../lib/guard-core.mjs';
import { parseStatus, statusLine, stopVerdict } from '../lib/mod-view.mjs';

// `frontier-guard.mjs status` 가 내는 꼴 그대로다 — 프론티어는 분류된 id 로 실린다.
const claimed = {
  markerPath: '/home/u/.claude/long-run/frontier-guard/repo-1234abcd.json',
  worktree: '/repo',
  marker: { epic: 'map-abcd' },
  frontier: { pushable: ['map-abcd.9', 'map-abcd.11'], questions: [], blocked: [] },
  epicOpen: true,
};
const unclaimed = { ...claimed, marker: null, frontier: null };
const empty = { pushable: [], questions: [], blocked: [] };
// 되미는 문구의 「멈춰도 되는 자리」도 스킬 이름을 싣는다 — 인계 지시는 이 구절로 가른다.
const HANDING_OFF = new RegExp(`${HANDOFF_SKILL} 로 넘긴다`);
const usageAt = (tokens, window = 1_000_000) => ({ context: { tokens, window, percent: Math.round((tokens / window) * 100) } });

// --- parseStatus ---

test('status 출력은 JSON 으로 읽는다', () => {
  assert.deepEqual(parseStatus(JSON.stringify(claimed, null, 2)), claimed);
});

// CLI 가 죽거나 엉뚱한 것을 내면 «모름» 이다 — 가드는 모를 때 통과시킨다.
test('읽을 수 없는 출력은 null 이다', () => {
  assert.equal(parseStatus(''), null);
  assert.equal(parseStatus('usage: node frontier-guard.mjs'), null);
  assert.equal(parseStatus(undefined), null);
});

// --- statusLine ---

test('선언한 세션은 맵·프론티어·컨텍스트를 한 줄로 본다', () => {
  assert.equal(statusLine(claimed, usageAt(420_000)), 'long-run map-abcd · 프론티어 2 · 컨텍스트 42%');
});

test('선언하지 않은 세션에는 상태줄이 없다', () => {
  assert.equal(statusLine(unclaimed, usageAt(420_000)), undefined);
  assert.equal(statusLine(null, usageAt(420_000)), undefined);
});

// 첫 응답 전이나 compact 직후에는 percent 가 비어 온다 — 0% 로 그리면 거짓말이다.
test('컨텍스트를 아직 모르면 모른다고 쓴다', () => {
  assert.equal(statusLine(claimed, { context: { window: 1_000_000 } }), 'long-run map-abcd · 프론티어 2 · 컨텍스트 측정 전');
  assert.equal(statusLine(claimed, null), 'long-run map-abcd · 프론티어 2 · 컨텍스트 측정 전');
});

test('인계 문턱을 넘으면 그 사실을 붙인다', () => {
  assert.equal(statusLine(claimed, usageAt(500_000)), 'long-run map-abcd · 프론티어 2 · 컨텍스트 50% · 인계할 때');
});

// --- stopVerdict ---

test('프론티어가 남고 컨텍스트가 여유면 다음 티켓으로 되민다', () => {
  const v = stopVerdict({ status: claimed, usage: usageAt(100_000), stopHookActive: false });
  assert.equal(v.block, true);
  assert.match(v.reason, /map-abcd\.9, map-abcd\.11/);
  assert.doesNotMatch(v.reason, HANDING_OFF);
});

// 창 크기를 모델 이름에서 추측하지 않는다 — 세션이 실제 창을 알려준다.
test('창 크기는 세션이 준 값을 쓴다', () => {
  const v = stopVerdict({ status: claimed, usage: usageAt(150_000, 200_000), stopHookActive: false });
  assert.match(v.reason, HANDING_OFF);
});

test('프론티어가 비고 맵이 닫혔으면 통과시키고 선언을 지우라고 한다', () => {
  const v = stopVerdict({ status: { ...claimed, frontier: empty, epicOpen: false }, usage: usageAt(100_000), stopHookActive: false });
  assert.equal(v.block, false);
  assert.equal(v.clear, true);
});

test('프론티어가 비었어도 맵이 열려 있으면 선언을 지우지 않는다', () => {
  const v = stopVerdict({ status: { ...claimed, frontier: empty }, usage: usageAt(100_000), stopHookActive: false });
  assert.equal(v.block, true);
  assert.notEqual(v.clear, true);
});

// status 가 bd 를 못 읽으면 frontier 를 null 로 싣는다 — 빈 프론티어로 읽으면 선언이 사라진다.
test('🚨 프론티어를 모르면 통과시키되 선언은 지우지 않는다', () => {
  const v = stopVerdict({ status: { ...claimed, frontier: null }, usage: usageAt(100_000), stopHookActive: false });
  assert.equal(v.block, false);
  assert.notEqual(v.clear, true);
});

test('두 번째 멈춤은 무조건 통과시킨다', () => {
  assert.equal(stopVerdict({ status: claimed, usage: usageAt(100_000), stopHookActive: true }).block, false);
});

test('선언하지 않았거나 status 를 못 읽었으면 통과시킨다', () => {
  assert.equal(stopVerdict({ status: unclaimed, usage: usageAt(100_000), stopHookActive: false }).block, false);
  assert.equal(stopVerdict({ status: null, usage: usageAt(100_000), stopHookActive: false }).block, false);
});

// 측정 전이면 인계를 지시하지 않는다 — 다음 티켓으로 되미는 쪽이 안전하다.
test('컨텍스트를 모르면 인계가 아니라 다음 티켓으로 되민다', () => {
  const v = stopVerdict({ status: claimed, usage: null, stopHookActive: false });
  assert.equal(v.block, true);
  assert.doesNotMatch(v.reason, HANDING_OFF);
});

// --- 대기 ---

const parked = { ...claimed, frontier: { pushable: ['map-abcd.9'], questions: ['map-abcd.3'], blocked: ['map-abcd.4'] } };

// 주차한 질문은 되미는 자리에서 한 번 보고될 뿐이라, 그 사이에 사람 눈에 띄는 곳은 상태줄뿐이다.
test('답을 기다리는 질문이 있으면 상태줄이 그 수를 말한다', () => {
  assert.equal(statusLine(parked, usageAt(420_000)), 'long-run map-abcd · 프론티어 1 · 질문 대기 1 · 컨텍스트 42%');
});

test('bd 를 못 읽었으면 프론티어를 0 이 아니라 모름으로 그린다', () => {
  assert.equal(statusLine({ ...claimed, frontier: null }, usageAt(420_000)), 'long-run map-abcd · 프론티어 모름 · 컨텍스트 42%');
});
