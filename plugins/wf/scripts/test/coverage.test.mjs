import assert from 'node:assert/strict';
import test from 'node:test';

import { coverageFindings, coverageReport } from '../lib/coverage.mjs';

const UNLISTED = '| unlisted | 해당 없음 — 변경 파일 목록과 위 축을 대조했다 |';

/** `<verdict> <axis>` per finding, for a document that also carries a closed unlisted row. */
function verdicts(axisIds, table) {
  return coverageFindings(axisIds, `${table}\n${UNLISTED}`).map(({ axis, verdict }) => `${verdict} ${axis}`);
}

const FULL = [
  '| 축 | 정의 | 출처 |',
  '|---|---|---|',
  '| behavior | 목록을 조회해 표로 보인다 | 기획서 3.2절 |',
  '| style | 기존 토큰 준용 | 목업 `mockup/detail.html` |',
].join('\n');

// --- cases carried over from check-coverage.test.sh ---

test('full rows pass', () => {
  assert.deepEqual(verdicts(['behavior', 'style'], FULL), []);
});

test('missing axis blocks', () => {
  assert.deepEqual(verdicts(['behavior', 'style'], '| behavior | 목록 조회 | 기획서 3.2절 |'), ['UNADDRESSED style']);
});

test('empty source cell blocks', () => {
  assert.deepEqual(verdicts(['style'], '| style | 기존 토큰 준용 |  |'), ['INCOMPLETE style']);
});

test('empty definition blocks', () => {
  assert.deepEqual(verdicts(['style'], '| style |  | 목업 있음 |'), ['INCOMPLETE style']);
});

test('not-applicable with reason passes', () => {
  assert.deepEqual(verdicts(['i18n'], '| i18n | **해당 없음** — 단일 언어 프로젝트 |'), []);
});

test('bare not-applicable blocks', () => {
  assert.deepEqual(verdicts(['i18n'], '| i18n | 해당 없음 |'), ['INCOMPLETE i18n']);
  assert.deepEqual(verdicts(['i18n'], '| i18n | **해당없음** — |'), ['INCOMPLETE i18n']);
});

test('not-applicable reason in next cell passes', () => {
  assert.deepEqual(verdicts(['i18n'], '| i18n | 해당 없음 | 단일 언어 프로젝트 |'), []);
});

test('prefix id does not borrow a longer row', () => {
  const table = '| state-lifetime | 보드 전환에서 유지 | 목업 전환 시나리오 |';
  assert.deepEqual(verdicts(['state', 'state-lifetime'], table), ['UNADDRESSED state']);
});

test('both rows present pass', () => {
  const table = '| state | 로딩 스켈레톤 | 기존 컴포넌트 |\n| state-lifetime | 보드 전환에서 유지 | 목업 전환 시나리오 |';
  assert.deepEqual(verdicts(['state', 'state-lifetime'], table), []);
});

// --- rules that changed ---

test('🚨 heading form is not a row — the axis is unaddressed', () => {
  assert.deepEqual(verdicts(['style'], '## style\n\n목업 토큰을 그대로 쓴다.'), ['UNADDRESSED style']);
});

test('a mention in prose does not address the axis', () => {
  assert.deepEqual(verdicts(['state'], 'The state of the board is kept. See `state` below.'), ['UNADDRESSED state']);
});

test('the id standing alone in another cell is not that axis row', () => {
  assert.deepEqual(verdicts(['state'], '| behavior | state | 기획서 3.2절 |'), ['UNADDRESSED state']);
});

test('the id inside a longer first cell is not that axis row', () => {
  assert.deepEqual(verdicts(['state'], '| state 관련 | 로딩 스켈레톤 | 기존 컴포넌트 |'), ['UNADDRESSED state']);
});

test('the match is exact, including case', () => {
  assert.deepEqual(verdicts(['state'], '| State | 로딩 스켈레톤 | 기존 컴포넌트 |'), ['UNADDRESSED state']);
});

test('emphasis around the first cell is ignored, underscores inside an id are kept', () => {
  for (const cell of ['**style**', '`style`', '_style_', '**`style`**']) {
    assert.deepEqual(verdicts(['style'], `| ${cell} | 기존 토큰 준용 | 목업 |`), [], cell);
  }
  assert.deepEqual(verdicts(['stale_refs'], '| `stale_refs` | 은퇴 표기 0건 | rg 결과 |'), []);
});

test('a row with nothing after the id is incomplete', () => {
  assert.deepEqual(verdicts(['style'], '| style |'), ['INCOMPLETE style']);
});

test('an escaped pipe does not split a cell', () => {
  assert.deepEqual(verdicts(['style'], String.raw`| style | a \| b | 목업 |`), []);
});

test('🚨 a CRLF document still shows an empty source cell as incomplete', () => {
  const text = ['| 축 | 정의 | 출처 |', '|---|---|---|', '| style | 기존 토큰 준용 |  |', UNLISTED].join('\r\n');
  assert.deepEqual(coverageFindings(['style'], text).map((f) => `${f.verdict} ${f.axis}`), ['INCOMPLETE style']);
});

test('a CRLF document with full rows passes', () => {
  assert.deepEqual(coverageFindings(['behavior', 'style'], `${FULL}\n${UNLISTED}`.replace(/\n/g, '\r\n')), []);
});

// --- the built-in unlisted axis ---

test('🚨 a document with no unlisted row is unaddressed on it', () => {
  assert.deepEqual(coverageFindings(['behavior', 'style'], FULL), [{ axis: 'unlisted', verdict: 'UNADDRESSED', detail: '' }]);
});

test('an unlisted row that says 해당 없음 with no reason is incomplete', () => {
  const findings = coverageFindings([], '| unlisted | 해당 없음 |');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].verdict, 'INCOMPLETE');
  assert.match(findings[0].detail, /사유가 없다/);
});

test('an unlisted row that names what it found passes', () => {
  assert.deepEqual(coverageFindings([], '| unlisted | 캐시 무효화 시점 | 후속 티켓 t-12 |'), []);
});

test('unlisted is asked even when the stage lists no axes', () => {
  assert.deepEqual(coverageFindings([], '본문만 있다').map((f) => f.axis), ['unlisted']);
});

// --- report ---

test('the report counts unlisted, names each open axis, and blocks', () => {
  const findings = coverageFindings(['behavior', 'style'], '| behavior | 목록 조회 | 기획서 |\n| style | 기존 토큰 |  |');
  const report = coverageReport({ artifact: 'docs/issues/t1.md', axisIds: ['behavior', 'style'], findings });
  assert.equal(report.failed, true);
  assert.equal(report.lines[0], 'INCOMPLETE style — 빈 칸이 있다 — 출처 없는 판정은 미결이다');
  assert.equal(report.lines[1], 'UNADDRESSED unlisted');
  assert.equal(report.lines[2], 'check-coverage: 1/3 axes addressed in docs/issues/t1.md');
});

test('🚨 a bypass passes only the axis it names', () => {
  const findings = coverageFindings(['style', 'state'], UNLISTED);
  const report = coverageReport({ artifact: 'a.md', axisIds: ['style', 'state'], findings, bypassed: ['style'] });
  assert.equal(report.failed, true);
  assert.deepEqual(report.lines.slice(0, 2), ['UNADDRESSED state', 'check-coverage: 2/3 axes addressed in a.md']);
});

test('a clean report is one line and does not block', () => {
  const report = coverageReport({ artifact: 'a.md', axisIds: ['behavior', 'style'], findings: [] });
  assert.deepEqual(report, { lines: ['check-coverage: 3/3 axes addressed in a.md'], failed: false });
});
