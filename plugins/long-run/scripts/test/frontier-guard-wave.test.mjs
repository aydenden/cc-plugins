import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('../frontier-guard.mjs', import.meta.url));

/** 실 마커를 덮어쓰지 않게 상태 루트와 cwd 를 둘 다 임시 폴더로 둔다. */
function sandbox(t) {
  const state = mkdtempSync(join(tmpdir(), 'lr-wave-state-'));
  const cwd = mkdtempSync(join(tmpdir(), 'lr-wave-cwd-'));
  t.after(() => {
    rmSync(state, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });
  return (...args) => {
    const res = spawnSync(process.execPath, [GUARD, ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, LONG_RUN_STATE_ROOT: state },
    });
    return { code: res.status, out: res.stdout.trim() };
  };
}

// 인계가 진행 웨이브의 Run 을 새 세션에 넘기려고 읽는다 — epic 처럼 한 줄, 없으면 빈 출력.
test('wave 는 정산 안 된 웨이브의 Run id 한 줄을 내고, 웨이브가 없거나 끝났으면 빈 출력이다', (t) => {
  const guard = sandbox(t);
  assert.deepEqual(guard('wave'), { code: 0, out: '' });

  assert.equal(guard('claim', 'map-x').code, 0);
  assert.equal(guard('wave').out, '');

  assert.equal(guard('wave-begin', 'run_abc', 'map-x.1=ctx_1=repo::C:/b/wave-1', 'map-x.2=ctx_2').code, 0);
  assert.equal(guard('wave').out, 'run_abc');
  assert.deepEqual(JSON.parse(guard('wave', '--json').out).tickets, [
    { id: 'map-x.1', dispatchId: 'ctx_1', worktreeId: 'repo::C:/b/wave-1' },
    { id: 'map-x.2', dispatchId: 'ctx_2' },
  ]);

  guard('wave-settle', 'map-x.1');
  assert.equal(guard('wave').out, 'run_abc');
  guard('wave-settle', 'map-x.2');
  assert.equal(guard('wave').out, '');
  assert.equal(guard('wave', '--json').out, '');
});
