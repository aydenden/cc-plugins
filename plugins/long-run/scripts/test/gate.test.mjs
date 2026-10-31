import test from 'node:test';
import assert from 'node:assert/strict';

import { bdCalls, closesEpic, denyCommand, denyWrite, needsGate, shellSegments } from '../lib/gate.mjs';

const frontier = { pushable: ['free'], questions: ['q'], blocked: ['t'], unscoped: [] };
const waiting = { pushable: [], questions: ['q'], blocked: ['t'], unscoped: [] };
const deny = (command, extra = {}) => denyCommand({ command, frontier, ...extra });

test('따옴표 안의 구분자와 명령은 명령이 아니다', () => {
  assert.deepEqual(shellSegments('a "b; c" && d'), [['a', 'b; c'], ['d']]);
  assert.deepEqual(bdCalls('echo "bd close q"'), []);
  assert.deepEqual(bdCalls('cd x && bd close q --reason "y; z"'), [['close', 'q', '--reason', 'y; z']]);
});

test('환경변수·전역 옵션·괄호를 넘어 bd 를 찾는다', () => {
  assert.deepEqual(bdCalls('FOO=1 bd -C /r --json close q'), [['close', 'q']]);
  assert.deepEqual(bdCalls('(bd close q)'), [['close', 'q']]);
  assert.deepEqual(bdCalls('bd.exe close q'), [['close', 'q']]);
});

test('줄바꿈은 명령을 가른다', () => {
  assert.deepEqual(bdCalls('ls\nbd close q'), [['close', 'q']]);
});

test('판정할 명령만 bd 를 부른다', () => {
  for (const c of ['bd close q', 'bd update t --claim', 'git commit -m x', 'git -C /r push', 'bd human respond q', 'bd ready --claim']) assert.equal(needsGate(c), true, c);
  for (const c of ['ls', 'npm test', 'bd show q', 'bd ready', 'git status', 'bd create --title x']) assert.equal(needsGate(c), false, c);
});

test('🚨 질문을 사람의 답 없이 닫는 길을 모두 막는다', () => {
  for (const c of ['bd close q', 'bd human respond q -r A', 'bd human dismiss q', 'bd delete q', 'bd label remove q human', 'bd update q --status closed', 'bd update q --remove-label human']) {
    assert.match(deny(c) ?? '', /frontier-guard\.mjs answer/, c);
  }
});

test('🚨 막힌 티켓과 질문은 claim 하지 못한다 — bd 는 잡아 준다(실측)', () => {
  assert.match(deny('bd update t --claim'), /답을 기다린다/);
  assert.match(deny('bd update t --status in_progress'), /답을 기다린다/);
  assert.match(deny('bd update q --claim'), /질문/);
  assert.equal(deny('bd update free --claim'), null);
});

test('범위 없는 질문에 막혔으면 범위를 적는 길을 말한다', () => {
  assert.match(denyCommand({ command: 'bd update t --claim', frontier: { ...waiting, unscoped: ['q'] } }), /bd dep add/);
});

test('--force 로 막힌 티켓을 닫지 못한다', () => {
  assert.match(deny('bd close t --force'), /--force/);
});

test('사람의 말이 없으면 의존을 풀어 질문을 건너뛰지 못한다', () => {
  assert.match(deny('bd dep remove t q'), /건너뛰지/);
  assert.equal(deny('bd dep remove t q', { hasReceiptSince: () => true }), null);
  assert.equal(deny('bd dep add t q'), null);
});

test('bd ready --claim 은 질문을 집지 못하게 한다', () => {
  assert.match(deny('bd ready --claim'), /exclude-label human/);
  assert.equal(deny('bd ready --claim --exclude-label human'), null);
  assert.match(denyCommand({ command: 'bd ready --claim --exclude-label human', frontier: waiting }), /없다/);
});

test('🚨 밀 수 있는 것이 없으면 commit·push 를 막고, 밀 수 있으면 막지 않는다', () => {
  assert.match(denyCommand({ command: 'git commit -m x', frontier: waiting }), /답을 기다린다/);
  assert.match(denyCommand({ command: 'git -C /r push', frontier: waiting }), /답을 기다린다/);
  assert.equal(deny('git commit -m x'), null);
  assert.equal(denyCommand({ command: 'git commit -m x', frontier: waiting, inWave: true }), null);
});

test('맵과 무관한 티켓과 읽기는 통과한다', () => {
  assert.equal(deny('bd close other'), null);
  assert.equal(deny('bd show q'), null);
  assert.equal(deny('bd comments add q 메모'), null);
});

test('맵을 닫기 전 남은 일이 있으면 거부한다', () => {
  assert.equal(closesEpic('bd close map --reason x', 'map'), true);
  assert.equal(closesEpic('bd close map.1', 'map'), false);
  assert.match(deny('bd close map', { closeProblem: '보고서 없음' }), /보고서 없음/);
});

test('🚨 쓰기는 대기 중 worktree 안에서만 막는다 — 인계 문서·scratchpad 는 맵의 작업이 아니다', () => {
  const input = { worktree: '/r', frontier: waiting };
  assert.match(denyWrite({ ...input, filePath: '/r/src/a.mjs' }), /답을 기다린다/);
  assert.equal(denyWrite({ ...input, filePath: '/r2/a.mjs' }), null);
  assert.equal(denyWrite({ ...input, filePath: '/home/u/.claude/handoff/x.md' }), null);
  assert.equal(denyWrite({ ...input, filePath: '/r/a.mjs', frontier }), null);
  assert.equal(denyWrite({ ...input, filePath: '/r/a.mjs', inWave: true }), null);
});
