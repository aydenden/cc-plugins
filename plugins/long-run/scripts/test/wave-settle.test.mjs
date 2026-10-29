import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { envelopeResult } from '../lib/orca-adapter.mjs';
import { baseDirtyReason, settleTicket, settleVerdict, workerStateOf } from '../lib/wave-settle.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/orca/${name}.json`, import.meta.url), 'utf8'));
const shown = envelopeResult(fixture('worker-show-succeeded'));

/** 실측 영수증을 하위 worktree 워커의 것으로 옮긴다 — 실측은 base 에서 돈 워커였다. */
const childShow = ({ outcome = 'succeeded', released = false } = {}) => ({
  ...shown,
  projection: {
    ...shown.projection,
    outcome,
    resource: { ...shown.projection.resource, releaseState: released ? 'released' : 'pending' },
  },
  terminal: { ...shown.terminal, worktreePath: 'C:/dev/cc-plugins/wave-map-x-1', branch: 'refs/heads/wave-map-x-1' },
});

const entry = { id: 'map-x.1', dispatchId: 'ctx_e669745663fb', worktreeId: 'repo::C:/dev/cc-plugins/wave-map-x-1' };
const worker = { dispatchId: 'ctx_e669745663fb', settled: true, outcome: 'succeeded', branch: 'wave-map-x-1', worktreePath: 'C:/dev/cc-plugins/wave-map-x-1', released: false };
const basePath = 'C:\\dev\\cc-plugins';

test('worker-show 영수증에서 결과·브랜치·worktree·release 여부를 읽는다', () => {
  assert.deepEqual(workerStateOf(shown), {
    dispatchId: 'ctx_e669745663fb',
    settled: true,
    outcome: 'succeeded',
    branch: 'main',
    worktreePath: 'C:/dev/cc-plugins',
    worktreeId: 'a11de280-7955-44a0-a6aa-0dc4628ab0b8::C:/dev/cc-plugins',
    released: true,
  });
  assert.equal(workerStateOf({ ...shown, projection: { ...shown.projection, outcome: null } }).settled, false);
});

test('정산 판정: 끝난 성공 워커가 커밋을 갖고 시험 병합이 깨끗하면 병합한다', () => {
  assert.equal(settleVerdict({ entry, worker, basePath, ahead: 2, trialClean: true }).action, 'merge');
});

test('🚨 dispatch 가 기대와 다르면 거부한다 — 다른 시도의 결과를 합치지 않는다', () => {
  const v = settleVerdict({ entry, worker: { ...worker, dispatchId: 'ctx_other' }, basePath, ahead: 1, trialClean: true });
  assert.equal(v.action, 'refuse');
  assert.match(v.reason, /ctx_other/);
});

test('🚨 워커가 base 자체에서 일했거나 브랜치를 모르면 거부한다 — 합칠 브랜치가 없다', () => {
  assert.equal(settleVerdict({ entry, worker: { ...worker, worktreePath: 'c:/dev/cc-plugins/' }, basePath, ahead: 1, trialClean: true }).action, 'refuse');
  assert.equal(settleVerdict({ entry, worker: { ...worker, branch: null }, basePath, ahead: 1, trialClean: true }).action, 'refuse');
});

test('아직 정산되지 않은 워커는 기다린다', () => {
  assert.equal(settleVerdict({ entry, worker: { ...worker, settled: false }, basePath }).action, 'wait');
});

test('실패 보고·빈 브랜치·충돌·코디네이터 판단은 병합하지 않고 주차한다', () => {
  assert.match(settleVerdict({ entry, worker: { ...worker, outcome: 'failed' }, basePath, ahead: 1, trialClean: true }).reason, /failed/);
  assert.match(settleVerdict({ entry, worker, basePath, ahead: 0, trialClean: true }).reason, /커밋/);
  assert.match(settleVerdict({ entry, worker, basePath, ahead: 1, trialClean: false }).reason, /충돌/);
  assert.match(settleVerdict({ entry, worker, basePath, ahead: 1, trialClean: true, park: true }).reason, /코디네이터/);
  for (const v of [
    settleVerdict({ entry, worker: { ...worker, outcome: 'failed' }, basePath, ahead: 1, trialClean: true }),
    settleVerdict({ entry, worker, basePath, ahead: 1, trialClean: false }),
  ]) assert.equal(v.action, 'park');
});

test('base 에 커밋 안 된 추적 파일 변경이 있으면 시험 병합 전에 멈춘다', () => {
  assert.equal(baseDirtyReason(''), null);
  assert.match(baseDirtyReason(' M README.md\n'), /README\.md/);
});

/** 부른 순서를 남기는 가짜 I/O. */
function fakeDeps({ show = childShow(), wave = [entry], porcelain = '', ahead = 1, trialClean = true, branchLeft = true } = {}) {
  const calls = [];
  const log = (name, value) => (...args) => {
    calls.push([name, ...args]);
    return typeof value === 'function' ? value(...args) : value;
  };
  return {
    calls,
    deps: {
      waveEntry: (id) => wave.find((t) => t.id === id) ?? null,
      basePath: () => basePath,
      orca: log('orca', (args) => (args[1] === 'worker-show' ? show : {})),
      porcelain: log('porcelain', porcelain),
      ahead: log('ahead', ahead),
      trialMerge: log('trialMerge', trialClean),
      merge: log('merge'),
      branchExists: log('branchExists', branchLeft),
      deleteBranch: log('deleteBranch'),
      guardSettle: log('guardSettle'),
    },
  };
}

const mutating = (calls) =>
  calls
    .filter(([n, a]) => ['merge', 'deleteBranch', 'guardSettle'].includes(n) || (n === 'orca' && a[1] !== 'worker-show'))
    .map(([n, a]) => (n === 'orca' ? a.slice(0, 2).join(' ') : n));

test('웨이브에 없는 티켓은 정산하지 않는다', () => {
  assert.throws(() => settleTicket({ ticketId: 'map-x.9', apply: true, deps: fakeDeps().deps }), /웨이브에 없다/);
});

test('🚨 apply 없이 부르면 판정만 내고 아무것도 바꾸지 않는다 — 코디네이터가 그 worktree 에서 검증한다', () => {
  const { deps, calls } = fakeDeps();
  const out = settleTicket({ ticketId: 'map-x.1', deps });
  assert.equal(out.action, 'merge');
  assert.equal(out.applied, false);
  assert.equal(out.worktreePath, 'C:/dev/cc-plugins/wave-map-x-1');
  assert.deepEqual(mutating(calls), []);
});

test('병합 정산은 base 병합 → 터미널 release → worktree rm → 남은 브랜치 삭제 → 웨이브에서 뺌 순서다', () => {
  const { deps, calls } = fakeDeps();
  const out = settleTicket({ ticketId: 'map-x.1', apply: true, deps });
  assert.equal(out.applied, true);
  assert.deepEqual(mutating(calls), ['merge', 'orchestration worker-release', 'worktree rm', 'deleteBranch', 'guardSettle']);
  const rm = calls.find(([n, a]) => n === 'orca' && a[0] === 'worktree')[1];
  assert.deepEqual(rm, ['worktree', 'rm', '--worktree', 'id:a11de280-7955-44a0-a6aa-0dc4628ab0b8::C:/dev/cc-plugins']);
  assert.match(calls.find(([n]) => n === 'merge')[2], /map-x\.1/);
});

test('이미 release 됐거나 rm 이 브랜치를 지웠으면 그 단계는 건너뛴다', () => {
  const { deps, calls } = fakeDeps({ show: childShow({ released: true }), branchLeft: false });
  settleTicket({ ticketId: 'map-x.1', apply: true, deps });
  assert.deepEqual(mutating(calls), ['merge', 'worktree rm', 'guardSettle']);
});

test('🚨 주차 정산은 터미널만 release 하고 worktree·브랜치를 남긴 채 웨이브에서 뺀다', () => {
  const { deps, calls } = fakeDeps({ trialClean: false });
  const out = settleTicket({ ticketId: 'map-x.1', apply: true, deps });
  assert.equal(out.action, 'park');
  assert.deepEqual(mutating(calls), ['orchestration worker-release', 'guardSettle']);
  assert.equal(out.branch, 'wave-map-x-1');
});

test('기다릴 워커·거부는 apply 해도 바꾸지 않는다', () => {
  const waiting = fakeDeps({ show: childShow({ outcome: null }) });
  assert.equal(settleTicket({ ticketId: 'map-x.1', apply: true, deps: waiting.deps }).action, 'wait');
  assert.deepEqual(mutating(waiting.calls), []);
});

test('base 가 더러우면 시험 병합도 하지 않고 멈춘다', () => {
  const { deps, calls } = fakeDeps({ porcelain: ' M a.txt' });
  assert.throws(() => settleTicket({ ticketId: 'map-x.1', apply: true, deps }), /a\.txt/);
  assert.ok(!calls.some(([n]) => n === 'trialMerge'));
});
