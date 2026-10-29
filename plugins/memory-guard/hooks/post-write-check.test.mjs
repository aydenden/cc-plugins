/**
 * post-write-check.mjs 테스트 — 훅 프로세스를 실제로 띄워 출력과 종료코드를 본다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'post-write-check.mjs');

function run(filePath) {
  const input = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: filePath } });
  return spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8' });
}

function memory(t, index, topics = []) {
  const root = mkdtempSync(path.join(tmpdir(), 'memory-guard-hook-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'memory');
  mkdirSync(dir);
  writeFileSync(path.join(dir, 'MEMORY.md'), index);
  for (const name of topics) writeFileSync(path.join(dir, name), '---\ndescription: x\n---\n');
  return { root, dir };
}

test('메모리 밖 쓰기에는 아무것도 출력하지 않는다', (t) => {
  const { root } = memory(t, '- [a](a.md)\n', ['a.md', 'lonely.md']);
  const r = run(path.join(root, 'src.mjs'));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('구조 지적이 있는 메모리 쓰기는 exit 0 과 additionalContext 로 경고한다', (t) => {
  const { dir } = memory(t, '- [a](a.md)\n', ['a.md', 'lonely.md']);
  const r = run(path.join(dir, 'a.md'));
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.hookEventName, 'PostToolUse');
  assert.match(out.additionalContext, /\[orphan-topic\] lonely\.md/);
});

test('지적 없는 메모리 쓰기는 조용하다', (t) => {
  const { dir } = memory(t, '- [a](a.md)\n', ['a.md']);
  const r = run(path.join(dir, 'a.md'));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});
