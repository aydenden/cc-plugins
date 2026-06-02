import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest } from '../manifest.js';

const ok = {
  workdir: '/tmp/wf',
  phases: [
    { id: 'research', specs: [
      { id: 's1', prompt_file: '/tmp/s1.md', dir: '/tmp', task_type: 'research' },
    ] },
  ],
};

test('valid manifest normalizes defaults', () => {
  const m = validateManifest(ok);
  assert.equal(m.concurrency, 3);
  assert.equal(m.notify, 'on-complete');
  assert.equal(m.phases[0].concurrency, 3);
  assert.equal(m.phases[0].specs[0].task_type, 'research');
});

test('rejects empty phases', () => {
  assert.throws(() => validateManifest({ workdir: '/x', phases: [] }), /phases/);
});

test('rejects spec without prompt_file', () => {
  assert.throws(() => validateManifest({
    workdir: '/x', phases: [{ id: 'p', specs: [{ id: 's', dir: '/x' }] }],
  }), /prompt_file/);
});

test('per-phase concurrency override', () => {
  const m = validateManifest({ ...ok, concurrency: 5,
    phases: [{ id: 'p', concurrency: 2, specs: ok.phases[0].specs }] });
  assert.equal(m.concurrency, 5);
  assert.equal(m.phases[0].concurrency, 2);
});
