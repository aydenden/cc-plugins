import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { envelopeResult } from '../lib/orca-adapter.mjs';
import { startWave } from '../lib/wave-start.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/orca/${name}.json`, import.meta.url), 'utf8'));
const schema = fixture('agent-context');
const runCreated = envelopeResult(fixture('run-create'));
const readyReceipt = (dispatchId, worktreeId) => {
  const base = envelopeResult(fixture('worker-start-ready'));
  return { ...base, dispatchId, effects: base.effects.map((e) => (e.kind === 'worktree' ? { ...e, action: 'created', id: worktreeId } : e)) };
};

/** 부른 순서를 남기는 가짜 I/O. orca 를 안 부르는 경로에서는 `orcaForbidden` 으로 부르는 순간 터진다. */
function fakeDeps({ orcaForbidden = false, epic = 'map-x', waveRun = null, gaps = false, startFails = [] } = {}) {
  const calls = [];
  const orcaCall = (name, fn) => (...args) => {
    calls.push([name, ...args]);
    if (orcaForbidden) throw new Error(`dry-run 이 orca 를 불렀다: ${name}`);
    return fn(...args);
  };
  let started = 0;
  return {
    calls,
    deps: {
      readTicket: (id) => ({ id, title: `제목 ${id}`, description: '본문', status: 'open' }),
      gitHead: () => 'main',
      epic: () => epic,
      pendingWaveRun: () => waveRun,
      orcaVersion: orcaCall('version', () => '1.4.218'),
      orcaSchema: orcaCall('schema', () =>
        gaps ? { ...schema, commands: schema.commands.filter((c) => c.command !== 'worktree rm') } : schema
      ),
      orca: orcaCall('orca', (args) => {
        if (args[1] === 'run-create') return runCreated;
        started += 1;
        const name = args[args.indexOf('--name') + 1];
        if (startFails.includes(started)) throw new Error(`worker-start 실패 ${name}`);
        return readyReceipt(`ctx_${started}`, `repo::C:/base/${name}`);
      }),
      excludeWorktree: (name) => calls.push(['exclude', name]),
      beginWave: (runId, tickets) => calls.push(['beginWave', runId, tickets]),
    },
  };
}

test('🚨 --dry-run 은 orca 를 부르지 않고 마커·exclude 도 건드리지 않은 채 계획을 낸다', () => {
  const { deps, calls } = fakeDeps({ orcaForbidden: true });
  const out = startWave({ ticketIds: ['map-x.1', 'map-x.2'], flags: { 'dry-run': true }, deps });
  assert.equal(out.dryRun, true);
  assert.equal(out.plan.baseBranch, 'main');
  assert.deepEqual(out.plan.workers.map((w) => w.ticket), ['map-x.1', 'map-x.2']);
  assert.deepEqual(calls, []);
});

test('선언된 맵이 없거나 정산 안 된 웨이브가 있으면 시작하지 않는다', () => {
  assert.throws(() => startWave({ ticketIds: ['t'], flags: {}, deps: fakeDeps({ epic: null }).deps }), /claim/);
  assert.throws(() => startWave({ ticketIds: ['t'], flags: {}, deps: fakeDeps({ waveRun: 'run_old' }).deps }), /run_old/);
});

test('🚨 쓰는 orca 서브커맨드가 없으면 설치 버전과 그 이름을 말하며 Run 을 만들기 전에 실패한다', () => {
  const { deps, calls } = fakeDeps({ gaps: true });
  assert.throws(() => startWave({ ticketIds: ['map-x.1'], flags: {}, deps }), /1\.4\.218[\s\S]*worktree rm/);
  assert.ok(!calls.some(([name]) => name === 'orca'));
});

test('Run 을 만들고 티켓마다 exclude 뒤 워커를 띄운 다음, 웨이브를 dispatch·worktree 와 함께 적는다', () => {
  const { deps, calls } = fakeDeps();
  const out = startWave({ ticketIds: ['map-x.1', 'map-x.2'], flags: {}, deps });
  assert.equal(out.ok, true);
  assert.equal(out.runId, 'run_fb4934954c3b');

  const order = calls.filter(([n]) => n !== 'version' && n !== 'schema').map(([n, a]) => (n === 'orca' ? a[1] : n));
  assert.deepEqual(order, ['run-create', 'exclude', 'worker-start', 'exclude', 'worker-start', 'beginWave']);

  const starts = calls.filter(([n, a]) => n === 'orca' && a[1] === 'worker-start').map(([, a]) => a);
  assert.ok(starts.every((a) => a[a.indexOf('--run') + 1] === 'run_fb4934954c3b'));

  const [, runId, tickets] = calls.find(([n]) => n === 'beginWave');
  assert.equal(runId, 'run_fb4934954c3b');
  assert.deepEqual(tickets, [
    { id: 'map-x.1', dispatchId: 'ctx_1', worktreeId: 'repo::C:/base/wave-map-x-1' },
    { id: 'map-x.2', dispatchId: 'ctx_2', worktreeId: 'repo::C:/base/wave-map-x-2' },
  ]);
});

test('--run 을 주면 그 Run 을 쓰고 새로 만들지 않는다', () => {
  const { deps, calls } = fakeDeps();
  const out = startWave({ ticketIds: ['map-x.1'], flags: { run: 'run_given' }, deps });
  assert.equal(out.runId, 'run_given');
  assert.ok(!calls.some(([n, a]) => n === 'orca' && a[1] === 'run-create'));
});

test('🚨 워커 하나가 실패하면 더 띄우지 않고, 이미 뜬 워커만 웨이브에 적고 실패를 보고한다', () => {
  const { deps, calls } = fakeDeps({ startFails: [2] });
  const out = startWave({ ticketIds: ['map-x.1', 'map-x.2', 'map-x.3'], flags: {}, deps });
  assert.equal(out.ok, false);
  assert.deepEqual(out.started.map((s) => s.ticket), ['map-x.1']);
  assert.equal(out.failed.ticket, 'map-x.2');
  assert.deepEqual(out.notStarted, ['map-x.3']);
  const [, , tickets] = calls.find(([n]) => n === 'beginWave');
  assert.deepEqual(tickets.map((t) => t.id), ['map-x.1']);
});

test('첫 워커부터 실패하면 웨이브를 열지 않는다 — 기다릴 워커가 없다', () => {
  const { deps, calls } = fakeDeps({ startFails: [1] });
  const out = startWave({ ticketIds: ['map-x.1'], flags: {}, deps });
  assert.equal(out.ok, false);
  assert.ok(!calls.some(([n]) => n === 'beginWave'));
});
