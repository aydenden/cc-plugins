import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRunWorker } from '../worker.js';

test('spawns delegate with correct args and captures report.txt', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wf-'));
  const fake = join(dir, 'oc-delegate.sh');
  writeFileSync(fake, `#!/usr/bin/env bash
echo "$@" > "${dir}/got-args.txt"
printf 'status:   done\\nsession:  X\\noc_sid:   ses_1\\nfiles:    +1 -0 (1 files)\\ndiff:     X/diff.patch\\ndone:     0 idle\\nnotes:    \\n'
exit 0
`);
  chmodSync(fake, 0o755);

  const runWorker = makeRunWorker(fake);
  const spec = { id: 's1', task_type: 'research', prompt_file: '/tmp/p.md', dir: '/tmp/work' };
  const sessionDir = join(dir, 'phase-p/s1');
  const report = await runWorker(spec, sessionDir);

  assert.equal(report.status, 'done');
  assert.equal(report.exit_code, 0);
  assert.ok(existsSync(join(sessionDir, 'report.txt')));
  const args = readFileSync(join(dir, 'got-args.txt'), 'utf8');
  assert.match(args, /--session-dir .*phase-p\/s1/);
  assert.match(args, /--prompt-file \/tmp\/p\.md/);
  assert.match(args, /--dir \/tmp\/work/);
});
