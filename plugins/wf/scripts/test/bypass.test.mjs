import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { bypassFailing, bypassLogPath } from '../lib/bypass-file.mjs';
import { MARKER_PATH, applyBypass, decideBypass, logLinesToAdd, parseMarker } from '../lib/bypass.mjs';

const STYLE = 'style: 목업 미수령, ccp-test';

/** In-memory io: `marker` null means no marker file. */
function memoryIo({ marker = null, log = '', failAppend = false } = {}) {
  const io = {
    logPath: '/log/wf-bypass.log',
    log,
    readMarker: () => marker,
    readLog: () => io.log,
    appendLog: (text) => {
      if (failAppend) throw new Error('ENOENT: no such directory');
      io.log += text;
    },
  };
  return io;
}

const request = (targets, check = 'check-coverage') => ({ check, targets, today: '2026-10-11' });

// --- parseMarker ---

test('a marker line names its target before the first colon-space', () => {
  assert.deepEqual(parseMarker(`${STYLE}\n\n  docs/a.md:12: 이관 예정, ccp-1  \r\n`), {
    entries: [
      { target: 'style', line: STYLE },
      { target: 'docs/a.md:12', line: 'docs/a.md:12: 이관 예정, ccp-1' },
    ],
    malformed: [],
  });
});

test('a line with no target or no reason is malformed', () => {
  assert.deepEqual(parseMarker('skip everything\nstyle:\nstyle:   \n: why').malformed, ['skip everything', 'style:', 'style:', ': why']);
});

// --- decideBypass ---

test('🚨 a bypass for style does not let state through', () => {
  const decision = decideBypass({ targets: ['style', 'state'], markerText: STYLE });
  assert.deepEqual(decision.granted.map((entry) => entry.target), ['style']);
});

test('a line whose target is not failing bypasses nothing and is reported', () => {
  const decision = decideBypass({ targets: ['state'], markerText: STYLE });
  assert.deepEqual(decision.granted, []);
  assert.deepEqual(decision.unmatched, [STYLE]);
});

test('the target must match exactly — no prefix, no case folding', () => {
  for (const marker of ['state-lifetime: why, t-1', 'State: why, t-1', 'stat: why, t-1']) {
    assert.deepEqual(decideBypass({ targets: ['state'], markerText: marker }).granted, [], marker);
  }
});

test('an empty or whitespace-only marker is flagged and grants nothing', () => {
  for (const markerText of ['', '   \n\t\n']) {
    const decision = decideBypass({ targets: ['style'], markerText });
    assert.equal(decision.empty, true);
    assert.deepEqual(decision.granted, []);
  }
});

test('no marker, or nothing failing, is silent', () => {
  const quiet = { granted: [], unmatched: [], malformed: [], empty: false };
  assert.deepEqual(decideBypass({ targets: ['style'], markerText: null }), quiet);
  assert.deepEqual(decideBypass({ targets: [], markerText: STYLE }), quiet);
});

// --- logLinesToAdd ---

test('the same reason on the same day is one log line', () => {
  const granted = [{ target: 'style', line: STYLE }];
  const first = logLinesToAdd({ check: 'check-coverage', today: '2026-10-11', granted, logText: '' });
  assert.deepEqual(first, [`2026-10-11 check-coverage: ${STYLE}`]);
  const again = logLinesToAdd({ check: 'check-coverage', today: '2026-10-11', granted, logText: `${first[0]}\n` });
  assert.deepEqual(again, []);
  const nextDay = logLinesToAdd({ check: 'check-coverage', today: '2026-10-12', granted, logText: `${first[0]}\n` });
  assert.equal(nextDay.length, 1);
});

test('a marker that repeats a line is still logged once', () => {
  const granted = [{ target: 'style', line: STYLE }, { target: 'style', line: STYLE }];
  assert.equal(logLinesToAdd({ check: 'c', today: '2026-10-11', granted, logText: '' }).length, 1);
});

// --- applyBypass ---

test('a granted bypass is recorded, printed, and returned by target', () => {
  const io = memoryIo({ marker: STYLE });
  const result = applyBypass(request(['style', 'state']), io);
  assert.deepEqual(result.bypassed, ['style']);
  assert.equal(io.log, `2026-10-11 check-coverage: ${STYLE}\n`);
  assert.ok(result.notices.includes(`check-coverage: bypass: ${STYLE}`));
});

test('running again the same day grants again without a second log line', () => {
  const io = memoryIo({ marker: STYLE });
  applyBypass(request(['style']), io);
  const result = applyBypass(request(['style']), io);
  assert.deepEqual(result.bypassed, ['style']);
  assert.equal(io.log.split('\n').filter(Boolean).length, 1);
});

test('🚨 a bypass that cannot be recorded is not a bypass', () => {
  const io = memoryIo({ marker: STYLE, failAppend: true });
  const result = applyBypass(request(['style']), io);
  assert.deepEqual(result.bypassed, []);
  assert.match(result.notices.join('\n'), /could not record.*\/log\/wf-bypass\.log/);
  assert.equal(io.log, '');
});

test('an empty marker says what to write and records nothing', () => {
  const io = memoryIo({ marker: '  \n' });
  const result = applyBypass(request(['style']), io);
  assert.deepEqual(result.bypassed, []);
  assert.match(result.notices.join('\n'), /no reason in it.*<target>: <why>, <ticket>/);
  assert.equal(io.log, '');
});

test('lines that match nothing are reported and not recorded', () => {
  const io = memoryIo({ marker: `${STYLE}\nskip everything` });
  const result = applyBypass(request(['state']), io);
  assert.deepEqual(result.bypassed, []);
  const notices = result.notices.join('\n');
  assert.match(notices, /bypasses nothing here.*style: 목업 미수령/);
  assert.match(notices, /not in the form.*skip everything/);
  assert.equal(io.log, '');
});

test('no marker means no notices at all', () => {
  assert.deepEqual(applyBypass(request(['style']), memoryIo()), { bypassed: [], notices: [] });
});

// --- file adapter ---

function project() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wf-bypass-')));
  mkdirSync(join(root, '.claude'));
  return root;
}

test('the adapter reads the marker and appends to WF_BYPASS_LOG', (t) => {
  const root = project();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, MARKER_PATH), `${STYLE}\n`);
  const env = { WF_BYPASS_LOG: join(root, 'bypass.log') };
  const now = new Date(2026, 9, 11, 23, 30);

  const first = bypassFailing({ check: 'check-coverage', targets: ['style', 'state'], cwd: root, env, now });
  bypassFailing({ check: 'check-coverage', targets: ['style'], cwd: root, env, now });

  assert.deepEqual(first.bypassed, ['style']);
  assert.equal(readFileSync(env.WF_BYPASS_LOG, 'utf8'), `2026-10-11 check-coverage: ${STYLE}\n`);
});

test('the adapter refuses the bypass when the log folder does not exist', (t) => {
  const root = project();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, MARKER_PATH), `${STYLE}\n`);
  const env = { WF_BYPASS_LOG: join(root, 'no-such-dir', 'bypass.log') };

  const result = bypassFailing({ check: 'check-coverage', targets: ['style'], cwd: root, env });

  assert.deepEqual(result.bypassed, []);
  assert.match(result.notices.join('\n'), /could not record/);
});

test('without a marker file the adapter grants nothing and says nothing', (t) => {
  const root = project();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = bypassFailing({ check: 'check-coverage', targets: ['style'], cwd: root, env: { WF_BYPASS_LOG: join(root, 'bypass.log') } });
  assert.deepEqual(result, { bypassed: [], notices: [] });
});

test('the default log lives in the git common dir, and in .claude outside a repository', (t) => {
  const root = project();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(bypassLogPath(root, {}), join(root, '.claude', 'wf-bypass.log'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  assert.equal(bypassLogPath(root, {}), join(root, '.git', 'wf-bypass.log'));
});
