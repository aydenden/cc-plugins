import assert from 'node:assert/strict';
import test from 'node:test';

import { editGate } from '../lib/edit-gate.mjs';

const SPEC = {
  stages: [
    { id: 'sources', kind: 'seam', checks: ['citation', 'negation'], artifact: { type: 'sources', dirs: ['docs/issues'] } },
    { id: 'screen', kind: 'seam', checks: ['coverage'], axes: 'screen', artifact: { type: 'screen', dirs: ['docs/issues', 'docs/screens'] } },
  ],
  axes: { screen: [{ id: 'style' }] },
  citations: { file_extensions: ['md'], path_roots: ['docs'] },
  negation: { claim: '찾지 못', proof: 'rg |검색' },
};

const HEAD = '---\ntype: sources\nticket: abc-1\n---\n';

function io({ files = ['docs/adr/0001.md'], bypassed = [] } = {}) {
  const calls = [];
  return {
    calls,
    lookup: { exists: (path) => files.includes(path), index: () => [] },
    bypass: (request) => {
      calls.push(request);
      const granted = request.targets.filter((target) => bypassed.includes(target));
      return { bypassed: granted, notices: granted.map((target) => `check-citations: bypass: ${target}: why, t-1`) };
    },
  };
}

const run = (overrides, lookup = io()) => {
  const text = overrides.text ?? HEAD;
  return editGate({ tool: 'Write', docPath: 'docs/issues/s1.md', text, written: text, spec: SPEC, io: lookup, ...overrides });
};

test('a document with resolving citations and declared frontmatter is quiet', () => {
  assert.deepEqual(run({ text: `${HEAD}근거는 \`docs/adr/0001.md\` 다.` }), { failed: false, lines: [], warnings: [] });
});

test('🚨 a citation that does not resolve fails and names the path', () => {
  const result = run({ text: `${HEAD}근거는 \`docs/adr/0002-ghost.md\` 다.` });
  assert.equal(result.failed, true);
  assert.equal(result.lines[0], 'MISSING docs/adr/0002-ghost.md  (cited in docs/issues/s1.md)');
});

test('a bypass for the cited path lets it through and says so', () => {
  const lookup = io({ bypassed: ['docs/adr/0002-ghost.md'] });
  const result = run({ text: `${HEAD}근거는 \`docs/adr/0002-ghost.md\` 다.` }, lookup);
  assert.equal(result.failed, false);
  assert.deepEqual(result.lines, ['check-citations: bypass: docs/adr/0002-ghost.md: why, t-1']);
  assert.deepEqual(lookup.calls, [{ check: 'check-citations', targets: ['docs/adr/0002-ghost.md'] }]);
});

test('🚨 a file outside the watched folders is ignored', () => {
  const text = '`docs/adr/0002-ghost.md` 를 찾지 못했다.';
  for (const docPath of ['README.md', 'docs/notes/a.md', 'src/a.md', 'docs/issues-old/a.md']) {
    assert.deepEqual(run({ docPath, text }), { failed: false, lines: [], warnings: [] }, docPath);
  }
});

test('a non-markdown file in a watched folder is ignored', () => {
  assert.deepEqual(run({ docPath: 'docs/issues/data.json', text: '`docs/ghost.md`' }), { failed: false, lines: [], warnings: [] });
});

test('an unproven absence claim the edit wrote is a warning, not a failure', () => {
  const result = run({ text: `${HEAD}공식 문서를 찾지 못했다.` });
  assert.equal(result.failed, false);
  assert.match(result.warnings.join('\n'), /UNPROVEN docs\/issues\/s1\.md:5/);
});

test('an older claim is not flagged by an edit elsewhere', () => {
  const text = `${HEAD}공식 문서를 찾지 못했다.\n\n새 문장.`;
  assert.deepEqual(run({ tool: 'Edit', text, written: '새 문장.' }).warnings, []);
});

test('🚨 a newly written document without type and ticket is warned about', () => {
  for (const text of ['# 근거 표\n', '---\ntype: sources\n---\n', '---\ntype: memo\nticket: abc-1\n---\n']) {
    const result = run({ text });
    assert.equal(result.failed, false);
    assert.match(result.warnings.join('\n'), /frontmatter declares no type \(sources\|screen\) and ticket/, text);
  }
});

test('an Edit does not repeat the frontmatter warning', () => {
  assert.deepEqual(run({ tool: 'Edit', text: '# 근거 표\n', written: '# 근거 표' }).warnings, []);
});

test('a document runs the checks of the stage whose type it declares', () => {
  const screen = '---\ntype: screen\nticket: abc-1\n---\n`docs/ghost.md` 를 찾지 못했다.';
  assert.deepEqual(run({ text: screen }), { failed: false, lines: [], warnings: [] });
});

test('an undeclared document runs the checks of every stage watching its folder', () => {
  const result = run({ tool: 'Edit', text: '`docs/ghost.md`', written: '`docs/ghost.md`' });
  assert.equal(result.failed, true);
  assert.deepEqual(run({ tool: 'Edit', docPath: 'docs/screens/a.md', text: '`docs/ghost.md`', written: 'x' }), { failed: false, lines: [], warnings: [] });
});
