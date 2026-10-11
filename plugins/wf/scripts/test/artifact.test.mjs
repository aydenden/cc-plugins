import assert from 'node:assert/strict';
import test from 'node:test';

import { declared, relativeTo, watchingStages } from '../lib/artifact.mjs';

// --- relativeTo ---

test('an absolute path under the root becomes a /-separated relative path', () => {
  assert.equal(relativeTo('/work/proj', '/work/proj/docs/issues/t1.md'), 'docs/issues/t1.md');
  assert.equal(relativeTo('/work/proj', 'docs/issues/t1.md'), 'docs/issues/t1.md');
});

test('🚨 a backslash absolute path is made relative on any host', () => {
  assert.equal(relativeTo('C:\\work\\proj', 'C:\\work\\proj\\docs\\issues\\t1.md'), 'docs/issues/t1.md');
  assert.equal(relativeTo('C:/work/proj', 'C:\\work\\proj\\docs\\issues\\t1.md'), 'docs/issues/t1.md');
  assert.equal(relativeTo('C:\\work\\proj', 'c:\\work\\proj\\docs\\t1.md'), 'docs/t1.md');
});

test('a path outside the root, or the root itself, is null', () => {
  assert.equal(relativeTo('/work/proj', '/work/other/a.md'), null);
  assert.equal(relativeTo('/work/proj', '/work/proj-two/a.md'), null);
  assert.equal(relativeTo('/work/proj', '/work/proj'), null);
  assert.equal(relativeTo('C:\\work\\proj', 'D:\\work\\proj\\a.md'), null);
});

// --- watchingStages ---

const SPEC = {
  stages: [
    { id: 'define', artifact: { type: 'definition', dirs: ['docs/issues'] } },
    { id: 'screen', artifact: { type: 'screen', dirs: ['docs/screens/', './docs/issues'] } },
    { id: 'implement' },
  ],
};

test('a stage watches the files under its artifact folders', () => {
  const ids = (path) => watchingStages(SPEC, path).map((stage) => stage.id);
  assert.deepEqual(ids('docs/issues/t1/definition.md'), ['define', 'screen']);
  assert.deepEqual(ids('docs/screens/a.md'), ['screen']);
  assert.deepEqual(ids('docs/issues-old/a.md'), []);
  assert.deepEqual(ids('README.md'), []);
});

// --- declared ---

test('reads type and ticket from the frontmatter', () => {
  assert.deepEqual(declared('---\ntype: definition\nticket: abc-12.3\ntitle: x\n---\n# body'), { type: 'definition', ticket: 'abc-12.3' });
});

test('quotes, CRLF and a BOM do not get in the way', () => {
  assert.deepEqual(declared('\uFEFF---\r\ntype: "definition"\r\nticket: \'abc-1\'\r\n---\r\n'), { type: 'definition', ticket: 'abc-1' });
});

test('🚨 a --- further down the document is not a frontmatter delimiter', () => {
  const text = '# title\n\n---\ntype: definition\nticket: abc-1\n---\n';
  assert.deepEqual(declared(text), { type: null, ticket: null });
});

test('keys below the closing delimiter are body, not declarations', () => {
  assert.deepEqual(declared('---\ntype: definition\n---\nticket: abc-1\n'), { type: 'definition', ticket: null });
});

test('an empty value and an indented key declare nothing', () => {
  assert.deepEqual(declared('---\ntype:\n  ticket: abc-1\n---\n'), { type: null, ticket: null });
});
