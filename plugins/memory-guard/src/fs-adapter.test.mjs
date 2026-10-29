/**
 * fs-adapter.mjs 테스트 — 쓰기 직후 점검이 어느 파일에 반응하는지를 임시 디렉터리로 확인한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { memoryDirForFile } from './fs-adapter.mjs';

function sandbox(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'memory-guard-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('memory/ 안의 토픽 파일과 인덱스는 메모리 쓰기다', (t) => {
  const mem = path.join(sandbox(t), 'memory');
  mkdirSync(mem);
  writeFileSync(path.join(mem, 'MEMORY.md'), '- x\n');
  assert.equal(memoryDirForFile(path.join(mem, 'auth.md')), mem);
  assert.equal(memoryDirForFile(path.join(mem, 'MEMORY.md')), mem);
});

test('설정 파일로 선언한 디렉터리는 이름이 memory 가 아니어도 메모리다', (t) => {
  const mem = path.join(sandbox(t), 'notes');
  mkdirSync(mem);
  writeFileSync(path.join(mem, 'MEMORY.md'), '- x\n');
  writeFileSync(path.join(mem, '.memory-guard.json'), '{}');
  assert.equal(memoryDirForFile(path.join(mem, 'auth.md')), mem);
});

test('인덱스가 없는 memory/ 와 메모리 밖 파일은 대상이 아니다', (t) => {
  const root = sandbox(t);
  const bare = path.join(root, 'memory');
  mkdirSync(bare);
  assert.equal(memoryDirForFile(path.join(bare, 'auth.md')), null);
  assert.equal(memoryDirForFile(path.join(root, 'src.mjs')), null);
  assert.equal(memoryDirForFile(undefined), null);
});

test('md 가 아닌 파일은 인덱스 구조를 바꾸지 않으므로 대상이 아니다', (t) => {
  const mem = path.join(sandbox(t), 'memory');
  mkdirSync(mem);
  writeFileSync(path.join(mem, 'MEMORY.md'), '- x\n');
  assert.equal(memoryDirForFile(path.join(mem, '.memory-guard.json')), null);
});
