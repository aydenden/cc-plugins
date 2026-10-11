import assert from 'node:assert/strict';
import test from 'node:test';

import { closeGate, closedTickets } from '../lib/close-gate.mjs';

// --- closedTickets ---

test('the positional arguments of bd close are the tickets', () => {
  assert.deepEqual(closedTickets('bd close abc-1'), ['abc-1']);
  assert.deepEqual(closedTickets('bd close abc-1 abc-2.3 --suggest-next'), ['abc-1', 'abc-2.3']);
  assert.deepEqual(closedTickets('bd done abc-1'), ['abc-1']);
});

test('🚨 a close behind cd, &&, ; or a pipe is still caught', () => {
  assert.deepEqual(closedTickets('cd x && bd close abc-1'), ['abc-1']);
  assert.deepEqual(closedTickets('git add . ; bd close abc-1 | tail -1'), ['abc-1']);
  assert.deepEqual(closedTickets('git commit -m x\nbd close abc-1'), ['abc-1']);
  assert.deepEqual(closedTickets('(bd close abc-1)'), ['abc-1']);
});

test('text inside a reason is not a ticket', () => {
  assert.deepEqual(closedTickets('bd close abc-1 --reason "superseded by abc-9; see abc-10"'), ['abc-1']);
  assert.deepEqual(closedTickets("bd close -r 'done, abc-9 follows' abc-1"), ['abc-1']);
  assert.deepEqual(closedTickets('bd close abc-1 --reason=abc-9'), ['abc-1']);
});

test('global flags before the subcommand are skipped', () => {
  assert.deepEqual(closedTickets('bd -C ../other close abc-1'), ['abc-1']);
  assert.deepEqual(closedTickets('bd --actor me close abc-1 --force'), ['abc-1']);
});

test('a command that does not close anything has no tickets', () => {
  for (const command of ['bd show abc-1', 'bd ready', 'echo "bd close abc-1"', 'git commit -m "bd close abc-1"', 'mybd close abc-1', 'bd closest abc-1', '']) {
    assert.deepEqual(closedTickets(command), [], command);
  }
});

test('🚨 an environment assignment in front of bd does not hide the close', () => {
  assert.deepEqual(closedTickets('BEADS_ACTOR=me bd close abc-1'), ['abc-1']);
  assert.deepEqual(closedTickets('cd x && A=1 B="two words" bd close abc-1'), ['abc-1']);
  assert.deepEqual(closedTickets('A=1 echo bd close abc-1'), []);
});

test('🚨 bd update that sets the status to closed is a close', () => {
  assert.deepEqual(closedTickets('bd update abc-1 --status closed'), ['abc-1']);
  assert.deepEqual(closedTickets('bd update abc-1 abc-2 -s closed'), ['abc-1', 'abc-2']);
  assert.deepEqual(closedTickets('bd update --status=closed abc-1'), ['abc-1']);
  assert.deepEqual(closedTickets('bd update -s closed abc-1 --force'), ['abc-1']);
});

test('bd update to another status, or with no status, closes nothing', () => {
  for (const command of ['bd update abc-1 --status open', 'bd update abc-1 --claim', 'bd update abc-1 --title closed', 'bd update abc-1 --if-status closed --assignee me']) {
    assert.deepEqual(closedTickets(command), [], command);
  }
});

test('a ticket closed twice is listed once', () => {
  assert.deepEqual(closedTickets('bd close abc-1 && bd close abc-1 abc-2'), ['abc-1', 'abc-2']);
});

// --- closeGate ---

const SPEC = {
  stages: [
    {
      id: 'define',
      kind: 'seam',
      checks: ['coverage', 'citation'],
      axes: 'define',
      artifact: { type: 'definition', dirs: ['docs/issues'] },
      preview: 'docs/previews/<ticket>/index.html',
      invariants: [{ name: 'overturn', run: ['node', 'scripts/check-overturn.mjs'] }],
    },
    { id: 'implement', kind: 'delegate', delegate_to: '/implement' },
  ],
  axes: { define: [{ id: 'behavior' }, { id: 'style' }] },
};

const doc = (ticket, rows) => ['---', 'type: definition', `ticket: ${ticket}`, '---', '', '| 축 | 정의 | 출처 |', '|---|---|---|', ...rows].join('\n');

const BEHAVIOR = '| behavior | 목록을 조회해 표로 보인다 | 기획서 3.2절 |';
const STYLE = '| style | 기존 토큰 준용 | 목업 |';
const UNLISTED = '| unlisted | 해당 없음 — 변경 파일 목록과 위 축을 대조했다 |';

/** io over an in-memory project. `invariantFails` makes the invariant exit non-zero. */
function project(files, { invariantFails = false, bypassed = [] } = {}) {
  const calls = { bypass: [], invariants: [] };
  const io = {
    calls,
    markdownIn: (dirs) => Object.keys(files).filter((path) => path.endsWith('.md') && dirs.some((dir) => path.startsWith(`${dir}/`))).sort(),
    read: (path) => files[path],
    exists: (path) => path in files,
    runInvariant: (run, docPath) => {
      calls.invariants.push([...run, docPath]);
      return invariantFails ? { ok: false, output: 'ONE-WAY the prior decision has no back-reference\n' } : { ok: true, output: '' };
    },
    bypass: (request) => {
      calls.bypass.push(request);
      const granted = request.targets.filter((target) => bypassed.includes(target));
      return { bypassed: granted, notices: granted.map((target) => `${request.check}: bypass: ${target}: why, t-1`) };
    },
  };
  return io;
}

const PASSING = {
  'docs/issues/t1-login.md': doc('abc-1', [BEHAVIOR, STYLE, UNLISTED]),
  'docs/previews/abc-1/index.html': '<html>',
};

test('a ticket whose document passes every check closes', () => {
  const io = project(PASSING);
  assert.deepEqual(closeGate({ command: 'bd close abc-1', spec: SPEC, io }), { blocked: false, lines: [] });
  assert.deepEqual(io.calls.invariants, [['node', 'scripts/check-overturn.mjs', 'docs/issues/t1-login.md']]);
  assert.deepEqual(io.calls.bypass, [], 'nothing failing, so the marker is not consulted');
});

test('🚨 a document missing an axis blocks the close and names the axis', () => {
  const io = project({ ...PASSING, 'docs/issues/t1-login.md': doc('abc-1', [BEHAVIOR, UNLISTED]) });
  const result = closeGate({ command: 'cd x && bd close abc-1', spec: SPEC, io });
  assert.equal(result.blocked, true);
  assert.ok(result.lines.includes('[abc-1 docs/issues/t1-login.md coverage(define)]'));
  assert.ok(result.lines.includes('UNADDRESSED style'));
});

test('a ticket no document declares passes, and so does a command that closes nothing', () => {
  const io = project(PASSING);
  assert.equal(closeGate({ command: 'bd close abc-2', spec: SPEC, io }).blocked, false);
  assert.equal(closeGate({ command: 'bd show abc-1', spec: SPEC, io }).blocked, false);
  assert.deepEqual(io.calls.invariants, []);
});

test('a document of another type, or with no frontmatter, is not this stage document', () => {
  const failing = doc('abc-1', [BEHAVIOR]);
  const io = project({
    'docs/issues/note.md': failing.replace('type: definition', 'type: note'),
    'docs/issues/plain.md': failing.split('\n').slice(4).join('\n'),
  });
  assert.equal(closeGate({ command: 'bd close abc-1', spec: SPEC, io }).blocked, false);
});

test('🚨 a missing preview blocks, with <ticket> filled in', () => {
  const io = project({ 'docs/issues/t1-login.md': PASSING['docs/issues/t1-login.md'] });
  const result = closeGate({ command: 'bd close abc-1', spec: SPEC, io });
  assert.equal(result.blocked, true);
  assert.ok(result.lines.includes('MISSING docs/previews/abc-1/index.html'));
});

test('a failing invariant blocks with its output', () => {
  const result = closeGate({ command: 'bd close abc-1', spec: SPEC, io: project(PASSING, { invariantFails: true }) });
  assert.equal(result.blocked, true);
  assert.deepEqual(result.lines, ['[abc-1 docs/issues/t1-login.md invariant(overturn)]', 'ONE-WAY the prior decision has no back-reference']);
});

test('every document that declares the ticket is checked, and every closed ticket', () => {
  const io = project({
    ...PASSING,
    'docs/issues/t1-extra.md': doc('abc-1', [BEHAVIOR, STYLE]),
    'docs/issues/t2-board.md': doc('abc-2', [STYLE, UNLISTED]),
    'docs/previews/abc-2/index.html': '<html>',
  });
  const result = closeGate({ command: 'bd close abc-1 abc-2', spec: SPEC, io });
  assert.ok(result.lines.includes('[abc-1 docs/issues/t1-extra.md coverage(define)]'));
  assert.ok(result.lines.includes('UNADDRESSED unlisted'));
  assert.ok(result.lines.includes('[abc-2 docs/issues/t2-board.md coverage(define)]'));
  assert.ok(result.lines.includes('UNADDRESSED behavior'));
  assert.ok(!result.lines.some((line) => line.includes('t1-login.md')), 'the passing document is not reported');
});

test('🚨 a bypass for one axis leaves the other blocking', () => {
  const files = { ...PASSING, 'docs/issues/t1-login.md': doc('abc-1', [UNLISTED]) };
  const result = closeGate({ command: 'bd close abc-1', spec: SPEC, io: project(files, { bypassed: ['style'] }) });
  assert.equal(result.blocked, true);
  assert.ok(result.lines.includes('UNADDRESSED behavior'));
  assert.ok(!result.lines.includes('UNADDRESSED style'));
  assert.ok(result.lines.includes('check-coverage: bypass: style: why, t-1'));
});

test('a bypass for every failing target lets the ticket close and still shows what was bypassed', () => {
  const files = { 'docs/issues/t1-login.md': doc('abc-1', [BEHAVIOR, UNLISTED]) };
  const io = project(files, { invariantFails: true, bypassed: ['style', 'docs/previews/abc-1/index.html', 'overturn'] });
  const result = closeGate({ command: 'bd close abc-1', spec: SPEC, io });
  assert.equal(result.blocked, false);
  assert.equal(result.lines.length, 3);
  assert.deepEqual(io.calls.bypass.map((request) => request.check), ['check-coverage', 'check-preview', 'check-invariant']);
});

test('a stage without coverage, preview or invariants checks nothing', () => {
  const spec = { stages: [{ id: 'sources', kind: 'seam', checks: ['citation'], artifact: { type: 'sources', dirs: ['docs/issues'] } }], axes: {} };
  const io = project({ 'docs/issues/s.md': '---\ntype: sources\nticket: abc-1\n---\n' });
  assert.deepEqual(closeGate({ command: 'bd close abc-1', spec, io }), { blocked: false, lines: [] });
});
