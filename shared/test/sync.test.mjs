import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { MANIFEST, pairs, stale } from '../sync.mjs';

const repoRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);

test('원본마다 받는 플러그인 수만큼 짝이 나온다', () => {
  const got = pairs('/repo', [{ file: 'scripts/a.mjs', plugins: ['p1', 'p2'] }]);
  assert.deepEqual(got, [
    { source: '/repo/shared/scripts/a.mjs', copy: '/repo/plugins/p1/scripts/a.mjs' },
    { source: '/repo/shared/scripts/a.mjs', copy: '/repo/plugins/p2/scripts/a.mjs' },
  ]);
});

test('내용이 다르거나 없는 사본만 낡은 것이다', () => {
  const files = { '/s/a': 'x', '/c/same': 'x', '/c/diff': 'y' };
  const list = [
    { source: '/s/a', copy: '/c/same' },
    { source: '/s/a', copy: '/c/diff' },
    { source: '/s/a', copy: '/c/missing' },
  ];
  assert.deepEqual(stale(list, (f) => files[f] ?? null).map((p) => p.copy), ['/c/diff', '/c/missing']);
});

// 🚨 사본만 고치면 다음 sync 가 조용히 덮고, 원본만 고치면 설치본이 낡은 채 나간다.
test('플러그인 안의 사본이 shared/ 원본과 같다 — 다르면 node shared/sync.mjs', () => {
  const differing = stale(pairs(repoRoot), read).map((p) => path.relative(repoRoot, p.copy));
  assert.deepEqual(differing, []);
});

test('목록의 원본이 실제로 있다', () => {
  for (const { file } of MANIFEST) assert.ok(fs.existsSync(path.join(repoRoot, 'shared', file)), file);
});
