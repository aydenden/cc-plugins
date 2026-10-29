import test from 'node:test';
import assert from 'node:assert/strict';

import { baseBranchOf, excludeAddition, planWave, specOf, workerStartArgs, worktreeNameOf } from '../lib/wave-plan.mjs';

const ticket = {
  id: 'map-x.14',
  title: '시작 스크립트',
  description: '무엇을 만든다.',
  acceptance_criteria: '단위 테스트가 초록이다.',
  notes: '실측 기준 orca 1.4.218.',
};

test('worktree 이름은 티켓 id 에서 정해지고 git·orca 가 받는 글자만 남는다', () => {
  assert.equal(worktreeNameOf('nis-zk8x.14'), 'wave-nis-zk8x-14');
  assert.equal(worktreeNameOf('a/b c'), 'wave-a-b-c');
});

test('base-branch 는 지정이 이기고, 없으면 base 의 지금 브랜치다', () => {
  assert.equal(baseBranchOf({ flag: 'develop', head: 'main' }), 'develop');
  assert.equal(baseBranchOf({ head: 'main\n' }), 'main');
});

test('🚨 base 가 브랜치에 있지 않으면(detached) 정하지 않고 실패한다 — orca 가 origin 기본 브랜치로 떨어진다', () => {
  assert.throws(() => baseBranchOf({ head: 'HEAD' }), /--base-branch/);
  assert.throws(() => baseBranchOf({ head: '' }), /--base-branch/);
});

test('spec 은 티켓 본문·완료조건·노트를 싣고, 워커가 bd 를 안 쓰며 base 에 합치지 않는다고 말한다', () => {
  const spec = specOf({ ticket, baseBranch: 'main' });
  assert.match(spec, /map-x\.14/);
  assert.match(spec, /무엇을 만든다/);
  assert.match(spec, /단위 테스트가 초록이다/);
  assert.match(spec, /orca 1\.4\.218/);
  assert.match(spec, /bd 를 쓰지 않는다/);
  assert.match(spec, /push·merge·rebase 하지 않는다/);
  assert.match(spec, /worker_done/);
  assert.match(spec, /--outcome failed/);
});

test('완료조건 칸이 비면 본문의 완료 조건을 따르라고 말한다', () => {
  const spec = specOf({ ticket: { id: 't', title: 'x', description: '본문' }, baseBranch: 'main' });
  assert.match(spec, /본문에 적힌 완료 조건/);
  assert.doesNotMatch(spec, /## 노트/);
});

test('worker-start 인자는 new-child·이름·base-branch·Run 을 명시한다', () => {
  const args = workerStartArgs({ name: 'wave-t', spec: 's', title: 't: x', baseBranch: 'main', runId: 'run_1', agent: 'claude', model: 'm1' });
  assert.deepEqual(args, [
    'orchestration', 'worker-start',
    '--spec', 's',
    '--task-title', 't: x',
    '--worktree', 'new-child',
    '--name', 'wave-t',
    '--base-branch', 'main',
    '--agent', 'claude',
    '--model', 'm1',
    '--run', 'run_1',
  ]);
  assert.ok(!workerStartArgs({ name: 'n', spec: 's', title: 't', baseBranch: 'main', agent: 'claude' }).includes('--model'));
  assert.ok(!workerStartArgs({ name: 'n', spec: 's', title: 't', baseBranch: 'main', agent: 'claude' }).includes('--run'));
});

test('exclude 줄은 base 안에 생기는 worktree 폴더를 가리고, 이미 있으면 덧붙이지 않는다', () => {
  assert.equal(excludeAddition('', 'wave-t'), '/wave-t/\n');
  assert.equal(excludeAddition('# git\n*.log', 'wave-t'), '\n/wave-t/\n');
  assert.equal(excludeAddition('/wave-t/\n', 'wave-t'), '');
});

test('계획은 티켓마다 이름·spec·인자를 내고, 중복 티켓·빈 목록을 거부한다', () => {
  const plan = planWave({ epic: 'map-x', tickets: [ticket, { ...ticket, id: 'map-x.15' }], baseBranch: 'main', agent: 'claude' });
  assert.equal(plan.baseBranch, 'main');
  assert.match(plan.objective, /map-x/);
  assert.deepEqual(plan.workers.map((w) => w.name), ['wave-map-x-14', 'wave-map-x-15']);
  assert.ok(plan.workers.every((w) => w.args.includes('new-child')));

  assert.throws(() => planWave({ epic: 'map-x', tickets: [], baseBranch: 'main', agent: 'claude' }), /티켓/);
  assert.throws(() => planWave({ epic: 'map-x', tickets: [ticket, ticket], baseBranch: 'main', agent: 'claude' }), /중복/);
});

test('🚨 닫힌 티켓은 계획에 넣지 않는다 — 끝난 일을 워커에게 다시 시킨다', () => {
  assert.throws(() => planWave({ epic: 'map-x', tickets: [{ ...ticket, status: 'closed' }], baseBranch: 'main', agent: 'claude' }), /닫힌/);
});
