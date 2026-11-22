import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  const guard = (...args) => {
    const res = spawnSync(process.execPath, [GUARD, ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, LONG_RUN_STATE_ROOT: state },
    });
    return { code: res.status, out: res.stdout.trim() };
  };
  // status·judge 는 bd 를 불러 저장소 밖에서 수십 초가 걸린다 — 마커만 볼 테스트는 파일을 직접 본다.
  const markerFile = () => {
    const dir = join(state, 'frontier-guard');
    return join(dir, readdirSync(dir).find((name) => name.endsWith('.json')));
  };
  guard.hook = (flag, input) =>
    spawnSync(process.execPath, [GUARD, flag], { cwd, encoding: 'utf8', input: JSON.stringify({ cwd, ...input }), env: { ...process.env, LONG_RUN_STATE_ROOT: state } });
  guard.marker = () => JSON.parse(readFileSync(markerFile(), 'utf8'));
  guard.receipts = () => {
    const dir = join(state, 'frontier-guard', 'receipts');
    return JSON.parse(readFileSync(join(dir, readdirSync(dir)[0]), 'utf8'));
  };
  guard.setMarker = (body) => writeFileSync(markerFile(), JSON.stringify(body));
  return guard;
}

test('pause·resume 은 마커에 적고 지우며, 선언이 없으면 실패한다', (t) => {
  const guard = sandbox(t);
  assert.equal(guard('pause').code, 1);

  guard('claim', 'map-x');
  assert.equal(guard('pause').code, 0);
  assert.equal(typeof guard.marker().paused.since, 'string');
  assert.equal(guard('resume').code, 0);
  assert.equal(guard.marker().paused, undefined);
});

test('🚨 다시 claim 하면 일시정지가 풀린다 — 인계받은 세션이 가드 꺼진 채 출발하면 안 된다', (t) => {
  const guard = sandbox(t);
  guard('claim', 'map-x');
  guard('pause');
  guard('claim', 'map-x');
  assert.equal(guard.marker().paused, undefined);
});

test('🚨 주인이 적힌 맵은 다른 세션이 일시정지하지 못한다', (t) => {
  const guard = sandbox(t);
  guard('claim', 'map-x');
  guard.setMarker({ ...guard.marker(), session: { id: 'owner', since: 'x' } });

  assert.equal(guard('pause', '--session', 'other').code, 1);
  assert.equal(guard.marker().paused, undefined);
  assert.equal(guard('pause', '--session', 'owner').code, 0);
  assert.equal(typeof guard.marker().paused.since, 'string');
});

test('wait 는 요지를 받아 적고, 요지가 없거나 선언이 없으면 실패한다', (t) => {
  const guard = sandbox(t);
  assert.equal(guard('wait', 'push 승인').code, 1);

  guard('claim', 'map-x');
  assert.equal(guard('wait').code, 1);
  assert.equal(guard('wait', '   ').code, 1);
  assert.equal(guard('wait', 'push 승인').code, 0);
  assert.equal(guard.marker().awaiting.reason, 'push 승인');
});

test('🚨 사람이 말하면 대기 표지가 지워지고, 프로그램이 넣은 입력으로는 안 지워진다', (t) => {
  const guard = sandbox(t);
  guard('claim', 'map-x');
  guard.setMarker({ ...guard.marker(), session: { id: 'owner', since: 'x' } });
  guard('wait', 'push 승인');

  guard.hook('--receipt', { session_id: 'owner', prompt: '[세션 인계] 이어받아라' });
  guard.hook('--receipt', { session_id: 'owner', prompt: '<task-notification>끝</task-notification>' });
  assert.equal(guard.marker().awaiting.reason, 'push 승인');

  guard.hook('--receipt', { session_id: 'other', prompt: '승인' });
  assert.equal(guard.marker().awaiting.reason, 'push 승인');

  guard.hook('--receipt', { session_id: 'owner', prompt: '승인' });
  assert.equal(guard.marker().awaiting, undefined);
});

test('🚨 AskUserQuestion 으로 고른 답도 영수증이 되고 대기 표지를 지운다', (t) => {
  const guard = sandbox(t);
  guard('claim', 'map-x');
  guard.setMarker({ ...guard.marker(), session: { id: 'owner', since: 'x' } });
  guard('wait', '배너 칸 결정');

  const asked = 'ait-1.30 배너 칸 코드를 어떻게 할까요?';
  guard.hook('--receipt', {
    session_id: 'owner',
    hook_event_name: 'PostToolUse',
    tool_name: 'AskUserQuestion',
    tool_input: { questions: [{ question: asked }] },
    tool_response: { questions: [{ question: asked }], answers: { [asked]: '빼고 낸다 (추천)' } },
  });
  assert.equal(guard.marker().awaiting, undefined);
  assert.deepEqual(guard.receipts().map((r) => r.text), ['빼고 낸다 (추천)']);
});

test('다시 claim 하면 대기 표지가 풀린다 — 앞 세션의 질문이 새 세션을 놓아주면 안 된다', (t) => {
  const guard = sandbox(t);
  guard('claim', 'map-x');
  guard('wait', 'push 승인');
  guard('claim', 'map-x');
  assert.equal(guard.marker().awaiting, undefined);
});

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
