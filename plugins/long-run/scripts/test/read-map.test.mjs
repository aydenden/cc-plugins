import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import { BD_TIMEOUT_MS, openChildrenOf, readMap } from '../lib/read-map.mjs';

const EPIC = 'map-abcd';
const ROWS = {
  show: [{ id: EPIC, status: 'open', title: '목적지' }],
  ready: [{ id: 'map-abcd.1', status: 'open' }],
  list: [
    { id: 'map-abcd.1', status: 'open' },
    { id: 'map-abcd.2', status: 'in_progress', title: '잡은 것' },
    { id: 'map-abcd.3', status: 'closed', closed_at: '2026-10-29T05:00:00Z' },
  ],
};

/** 부른 bd 명령마다 응답을 직접 풀어 주는 러너 — 몇 개가 동시에 떠 있는지 잰다. */
function gatedRunner(answer = (args) => ROWS[args[0]]) {
  const pending = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const run = (args) =>
    new Promise((resolve, reject) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      pending.push({ args, settle: () => {
        inFlight -= 1;
        const rows = answer(args);
        rows instanceof Error ? reject(rows) : resolve(rows);
      } });
    });
  return { run, pending, maxInFlight: () => maxInFlight };
}

const settleAll = async (runner) => {
  await Promise.resolve();
  for (const call of runner.pending) call.settle();
};

test('bd 조회는 하나가 끝나기를 기다리지 않고 한꺼번에 뜬다', async () => {
  const runner = gatedRunner();
  const reading = readMap(EPIC, runner.run);
  await Promise.resolve();
  assert.equal(runner.pending.length, runner.maxInFlight(), '응답 전에 모든 조회가 떠 있어야 한다');
  assert.ok(runner.maxInFlight() >= 3);
  await settleAll(runner);
  await reading;
});

test('상태별 목록은 한 번 받아 가른다 — 닫힌 자식은 프론티어가 아니라 닫은 수의 재료다', async () => {
  const runner = gatedRunner();
  const reading = readMap(EPIC, runner.run);
  await settleAll(runner);
  const read = await reading;
  assert.deepEqual(read.frontier, { pushable: ['map-abcd.1', 'map-abcd.2'], questions: [], blocked: [] });
  assert.equal(read.epicOpen, true);
  assert.equal(read.epicTitle, '목적지');
  assert.deepEqual(read.claimed, [{ id: 'map-abcd.2', title: '잡은 것' }]);
  assert.equal(read.children.length, 3);
  const list = runner.pending.find((c) => c.args[0] === 'list').args;
  assert.ok(list.includes('--all') && list.includes('0'), '닫힌 것까지, 자르지 않고 받는다');
});

test('조회 하나라도 실패하면 프론티어는 «모름» 이다 — 빈 프론티어가 아니다', async () => {
  for (const failing of ['show', 'ready', 'list']) {
    const runner = gatedRunner((args) => (args[0] === failing ? new Error('bd timeout') : ROWS[args[0]]));
    const reading = readMap(EPIC, runner.run);
    await settleAll(runner);
    const read = await reading;
    assert.equal(read.frontier, null, `${failing} 실패`);
    assert.equal(read.epicOpen, true, `${failing} 실패 — 닫혔다고 읽으면 선언이 지워진다`);
  }
});

test('목록이 오면 맵 조회가 실패해도 닫은 수의 재료는 남는다', async () => {
  const runner = gatedRunner((args) => (args[0] === 'show' ? new Error('bd timeout') : ROWS[args[0]]));
  const reading = readMap(EPIC, runner.run);
  await settleAll(runner);
  assert.equal((await reading).children.length, 3);
});

test('없는 맵은 «모름» 이다 — bd list --parent 는 없는 맵에도 빈 배열을 낸다', async () => {
  const runner = gatedRunner((args) => (args[0] === 'show' ? [] : []));
  const reading = readMap(EPIC, runner.run);
  await settleAll(runner);
  assert.equal((await reading).frontier, null);
});

test('닫힌 맵은 epicOpen 이 거짓이다', async () => {
  const runner = gatedRunner((args) => (args[0] === 'show' ? [{ id: EPIC, status: 'closed' }] : ROWS[args[0]]));
  const reading = readMap(EPIC, runner.run);
  await settleAll(runner);
  assert.equal((await reading).epicOpen, false);
});

test('bd 조회 시한은 Stop 훅 예산을 거의 다 쓰되 넘지 않는다 — 동시 조회는 서로를 늦춘다', () => {
  const hooks = JSON.parse(readFileSync(new URL('../../hooks/hooks.json', import.meta.url), 'utf8'));
  const budgetMs = hooks.hooks.Stop[0].hooks[0].timeout * 1000;
  assert.ok(BD_TIMEOUT_MS <= budgetMs - 2000, '시한 뒤에도 판정·출력할 여유가 남아야 한다');
  assert.ok(BD_TIMEOUT_MS >= budgetMs * 0.75, '동시 조회 한 판이 13초를 넘는 bd 에서 시한이 판정을 먼저 죽인다');
});

test('열린 자식은 닫힌 것만 뺀다 — bd list 의 기본 필터와 같은 범위다', () => {
  assert.deepEqual(
    openChildrenOf([{ status: 'open' }, { status: 'closed' }, { status: 'blocked' }, { status: 'deferred' }]).map((r) => r.status),
    ['open', 'blocked', 'deferred']
  );
  assert.equal(openChildrenOf(null), null);
});
