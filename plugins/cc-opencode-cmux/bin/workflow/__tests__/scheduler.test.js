import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWorkflow } from '../scheduler.js';

function makeTracker() {
  let active = 0, peak = 0;
  const order = [];
  const runWorker = async (spec) => {
    active++; peak = Math.max(peak, active);
    order.push(`start:${spec.id}`);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    order.push(`end:${spec.id}`);
    return { status: spec.id.endsWith('fail') ? 'error' : 'done',
             session: `/wf/${spec.id}`, exit_code: spec.id.endsWith('fail') ? 13 : 0 };
  };
  return { runWorker, peak: () => peak, order };
}

const manifest = {
  workdir: '/wf', concurrency: 3, notify: 'on-complete',
  phases: [
    { id: 'p1', concurrency: 3, specs: Array.from({ length: 7 },
        (_, i) => ({ id: `a${i}`, task_type: 'x', prompt_file: '/x', dir: '/x' })) },
    { id: 'p2', concurrency: 2, specs: [
        { id: 'b0', prompt_file: '/x', dir: '/x' },
        { id: 'b1fail', prompt_file: '/x', dir: '/x' }] },
  ],
};

test('respects concurrency cap per phase', async () => {
  const t = makeTracker();
  await runWorkflow(manifest, t.runWorker, () => {});
  assert.ok(t.peak() <= 3, `peak ${t.peak()} exceeded cap 3`);
});

test('phase barrier: all p1 end before any p2 start', async () => {
  const t = makeTracker();
  await runWorkflow(manifest, t.runWorker, () => {});
  const firstP2 = t.order.findIndex((e) => e.startsWith('start:b'));
  const lastP1End = t.order.map((e, i) => [e, i])
    .filter(([e]) => e.startsWith('end:a')).pop()[1];
  assert.ok(lastP1End < firstP2, 'p2 started before p1 finished');
});

test('continues past failures and records them', async () => {
  const t = makeTracker();
  const res = await runWorkflow(manifest, t.runWorker, () => {});
  const p2 = res.find((p) => p.id === 'p2');
  assert.equal(p2.results.length, 2);
  assert.equal(p2.results.filter((r) => r.status !== 'done').length, 1);
});
