import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { capabilityGaps, envelopeResult, REQUIRED_CAPABILITIES, runIdOf, workerReceiptOf } from '../lib/orca-adapter.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/orca/${name}.json`, import.meta.url), 'utf8'));

test('실측 orca 1.4.218 의 명령 스키마에는 웨이브가 쓰는 서브커맨드·플래그가 전부 있다', () => {
  assert.deepEqual(capabilityGaps(fixture('agent-context')), []);
});

test('🚨 쓰는 서브커맨드가 없으면 그 이름을, 플래그가 없으면 명령과 플래그를 말한다', () => {
  const schema = fixture('agent-context');
  const withoutRelease = { ...schema, commands: schema.commands.filter((c) => c.command !== 'orchestration worker-release') };
  assert.deepEqual(capabilityGaps(withoutRelease), ['orchestration worker-release']);

  const renamedFlag = {
    ...schema,
    commands: schema.commands.map((c) =>
      c.command === 'orchestration worker-start' ? { ...c, flags: c.flags.filter((f) => f !== 'base-branch') } : c
    ),
  };
  assert.deepEqual(capabilityGaps(renamedFlag), ['orchestration worker-start --base-branch']);
});

test('스키마 꼴이 아니면 전부 없는 것으로 본다 — 모르는 것을 있다고 읽지 않는다', () => {
  assert.equal(capabilityGaps(null).length, Object.keys(REQUIRED_CAPABILITIES).length);
  assert.equal(capabilityGaps({ commands: 'x' }).length, Object.keys(REQUIRED_CAPABILITIES).length);
});

test('봉투를 벗기고, ok:false 는 예외다', () => {
  assert.equal(envelopeResult(fixture('run-create')).run.id, 'run_fb4934954c3b');
  assert.throws(() => envelopeResult({ ok: false, error: { code: 'x' } }), /ok:false/);
  assert.throws(() => envelopeResult('not json'), /봉투/);
});

test('run-create 영수증에서 Run id 를 읽는다', () => {
  assert.equal(runIdOf(envelopeResult(fixture('run-create'))), 'run_fb4934954c3b');
  assert.throws(() => runIdOf({}), /Run id/);
});

test('worker-start 영수증에서 dispatch·task·worktree·에이전트 터미널을 읽는다', () => {
  assert.deepEqual(workerReceiptOf(envelopeResult(fixture('worker-start-ready'))), {
    ready: true,
    dispatchId: 'ctx_e669745663fb',
    taskId: 'task_0c57bb04032e',
    worktreeId: 'a11de280-7955-44a0-a6aa-0dc4628ab0b8::C:/dev/cc-plugins',
    terminal: 'term_d80009ea-bb98-4c23-bc4b-6c86e7617cbd',
    stage: 'input_accepted',
    residualResources: [],
  });
});

test('🚨 ready 가 아닌 영수증은 ready:false 다 — dispatch 가 있어도 시작된 워커로 읽지 않는다', () => {
  const failed = { ...envelopeResult(fixture('worker-start-ready')), state: 'failed', failedStage: 'setup', residualResources: [{ kind: 'worktree' }] };
  const receipt = workerReceiptOf(failed);
  assert.equal(receipt.ready, false);
  assert.deepEqual(receipt.residualResources, [{ kind: 'worktree' }]);
});
