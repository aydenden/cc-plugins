import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResult } from '../aggregate.js';

const phaseResults = [
  { id: 'p1', results: [
    { spec: 'a0', status: 'done', session: '/wf/a0' },
    { spec: 'a1', status: 'done', session: '/wf/a1' } ] },
  { id: 'p2', results: [
    { spec: 'b0', status: 'done', session: '/wf/b0' },
    { spec: 'b1', status: 'error', exit_code: 13, session: '/wf/b1', notes: 'boom' } ] },
];

test('summary counts per phase', () => {
  const r = buildResult(phaseResults);
  assert.equal(r.status, 'completed_with_failures');
  assert.deepEqual(r.phases[0], { id: 'p1', total: 2, done: 2, failed: 0 });
  assert.deepEqual(r.phases[1], { id: 'p2', total: 2, done: 1, failed: 1 });
});

test('failures list isolates failed specs', () => {
  const r = buildResult(phaseResults);
  assert.equal(r.failures.length, 1);
  assert.equal(r.failures[0].spec, 'b1');
  assert.equal(r.failures[0].exit_code, 13);
  assert.equal(r.failures[0].phase, 'p2');
});

test('all-done → completed', () => {
  const r = buildResult([{ id: 'p', results: [{ spec: 's', status: 'done' }] }]);
  assert.equal(r.status, 'completed');
  assert.equal(r.failures.length, 0);
});
