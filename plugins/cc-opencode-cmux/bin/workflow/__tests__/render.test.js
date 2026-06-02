import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bar, frame } from '../render.js';

test('bar fills proportionally', () => {
  assert.equal(bar(0, 0, 4, 4), '░░░░');
  assert.equal(bar(2, 0, 4, 4), '██░░');
  assert.equal(bar(2, 2, 4, 4), '████');
  assert.equal(bar(0, 0, 0, 4), '░░░░'); // total 0 → no div-by-zero
});

test('frame includes phase counts and narrator', () => {
  const out = frame({
    phases: [{ phaseId: 'research', total: 5, done: 2, failed: 1, running: 2, queued: 0 }],
    narrator: 'working',
  });
  assert.match(out, /research/);
  assert.match(out, /2 done/);
  assert.match(out, /1 fail/);
  assert.match(out, /working/);
});
