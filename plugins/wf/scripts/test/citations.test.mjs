import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { repositoryLookup } from '../lib/citations-file.mjs';
import { citationReport, citedPaths, missingCitations, resolves } from '../lib/citations.mjs';

/** The citation rules of a real generated workflow, with its names generalised. */
const RULES = {
  file_extensions: ['md', 'json', 'yaml', 'ts', 'py', 'sh', 'html', 'png'],
  path_roots: ['.planning', 'docs', 'data', 'tools', 'research', 'prototypes'],
  search_roots: ['.planning', '.planning/spec', '.planning/research'],
  index_roots: ['.planning', 'docs', 'data'],
  ignore_patterns: [
    { pattern: '^(domain|server|app)(/|$)', why: 'code paths that do not exist yet' },
    { pattern: '^abc-[a-z0-9.]+$', why: 'ticket ids' },
    { pattern: '^@', why: 'npm packages' },
    { pattern: '^[A-Za-z_]+(/[A-Za-z_]+){2,}$', why: 'field lists (sets/reps/weight)' },
    { pattern: '^[a-z-]+/$', why: 'one-word folder notation' },
  ],
};

/** Lookup over an in-memory file list. Folders exist when a file sits under them. */
function memoryLookup(files) {
  const all = new Set(files);
  for (const file of files) {
    for (let folder = dirname(file); folder !== '.'; folder = dirname(folder)) all.add(folder);
  }
  return {
    exists: (path) => all.has(path),
    index: (roots) => [...all].filter((path) => roots.some((root) => path === root || path.startsWith(`${root}/`))),
  };
}

const FILES = [
  '.planning/spec/t1-login.md',
  '.planning/spec/t2-board.md',
  '.planning/research/t3-auth/README.md',
  '.planning/research/t3-auth/findings.md',
  'docs/adr/0001-storage.md',
  'tools/build.sh',
  'README.md',
];

const missing = (text, docPath = '.planning/spec/t1-login.md') =>
  missingCitations({ text, docPath, citations: RULES, lookup: memoryLookup(FILES) });

// --- what counts as a citation ---

test('a token is a citation when it ends in a known extension or starts with a known folder', () => {
  const text = 'See `docs/adr/0001-storage.md`, `tools/build.sh:12`, `research/t3-auth` and `notes.md#top`.';
  assert.deepEqual(citedPaths(text, RULES), ['docs/adr/0001-storage.md', 'tools/build.sh', 'research/t3-auth', 'notes.md']);
});

test('🚨 API identifiers, domain names and package names are not citations', () => {
  const text = [
    '`user_account.email`, `example.kr`, `api.example.com`, `@scope/pkg`, `react-query`,',
    '`GET /notices`, `/docs/app/guides`, `sets/reps/weight`, `abc-fix.30`, `process.env.HOME`,',
    '`https://example.com/a.md`, `~/notes/a.md`, `src/**/*.ts`, `docs/<ticket>/index.html`, `fn(a, b)`',
  ].join('\n');
  assert.deepEqual(citedPaths(text, RULES), []);
});

test('ignore_patterns skip tokens that would otherwise count', () => {
  assert.deepEqual(citedPaths('`server/routes.ts` and `domain/` and `docs/a.md`', RULES), ['docs/a.md']);
});

test('a path is listed once however often it is cited', () => {
  assert.deepEqual(citedPaths('`README.md` then `README.md:3` then `README.md#usage`', RULES), ['README.md']);
});

test('with no extension and no root rule nothing is a citation', () => {
  assert.deepEqual(citedPaths('`docs/a.md`', {}), []);
});

// --- where a citation is looked for ---

test('🚨 an existing file cited relative to the document is not missing', () => {
  assert.deepEqual(missing('근거는 `t2-board.md` 와 `../research/t3-auth/findings.md` 다.'), []);
});

test('🚨 a file that does not exist is missing', () => {
  assert.deepEqual(missing('근거는 `research/t99-ghost/README.md` 다.'), ['research/t99-ghost/README.md']);
});

test('resolution order: root, document folder, search roots, then a tail match in the index', () => {
  const lookup = memoryLookup(FILES);
  const doc = '.planning/spec/t1-login.md';
  assert.equal(resolves('README.md', doc, RULES, lookup), true, 'repository root');
  assert.equal(resolves('t2-board.md', doc, RULES, lookup), true, 'document folder');
  assert.equal(resolves('research/t3-auth/README.md', doc, RULES, lookup), true, 'search root .planning');
  assert.equal(resolves('t3-auth/findings.md', doc, RULES, lookup), true, 'search root .planning/research');
  assert.equal(resolves('adr/0001-storage.md', doc, RULES, lookup), true, 'tail match under docs');
  assert.equal(resolves('0001-storage.md', doc, RULES, lookup), true, 'bare file name in the index');
  assert.equal(resolves('storage.md', doc, RULES, lookup), false, 'a tail must start at a path segment');
  assert.equal(resolves('build.sh', doc, RULES, lookup), false, 'tools is not an index root');
});

test('a cited folder and a leading or trailing slash resolve', () => {
  const lookup = memoryLookup(FILES);
  assert.equal(resolves('research/t3-auth/', '.planning/spec/t1-login.md', RULES, lookup), true);
  assert.equal(resolves('/docs/adr/0001-storage.md', 'README.md', RULES, lookup), true);
});

test('the index is not consulted when an earlier step resolves', () => {
  const lookup = { exists: () => true, index: () => assert.fail('index walked') };
  assert.equal(resolves('README.md', 'a.md', RULES, lookup), true);
});

test('a document with no citations has no missing paths', () => {
  assert.deepEqual(missing('인용이 없는 문서다. `fn()` 과 `a.b` 만 있다.'), []);
});

// --- report ---

test('a clean run prints nothing', () => {
  assert.deepEqual(citationReport({ docPath: 'a.md', missing: [] }), { lines: [], failed: false });
});

test('a failing run names each path and the citing document', () => {
  const report = citationReport({ docPath: 'docs/a.md', missing: ['x.md', 'docs/y.md'] });
  assert.equal(report.failed, true);
  assert.equal(report.lines[0], 'MISSING x.md  (cited in docs/a.md)');
  assert.match(report.lines[2], /2 unverifiable citation/);
});

test('🚨 a bypass passes only the path it names', () => {
  const report = citationReport({ docPath: 'a.md', missing: ['x.md', 'y.md'], bypassed: ['x.md'] });
  assert.equal(report.failed, true);
  assert.equal(report.lines[0], 'MISSING y.md  (cited in a.md)');
  assert.deepEqual(citationReport({ docPath: 'a.md', missing: ['x.md'], bypassed: ['x.md'] }), { lines: [], failed: false });
});

// --- filesystem lookup ---

test('the repository lookup resolves real files and prunes vendored folders from the index', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'wf-citations-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of ['docs/adr/0001-storage.md', 'docs/node_modules/pkg/index.md', '.planning/spec/t1.md']) {
    mkdirSync(join(root, dirname(file)), { recursive: true });
    writeFileSync(join(root, file), '');
  }
  const lookup = repositoryLookup(root);
  assert.equal(lookup.exists('docs/adr/0001-storage.md'), true);
  assert.equal(lookup.exists('docs/adr/0002-ghost.md'), false);
  const index = lookup.index(['docs', 'no-such-root']);
  assert.ok(index.includes('docs/adr/0001-storage.md'));
  assert.ok(index.includes('docs/adr'));
  assert.ok(!index.some((path) => path.includes('node_modules')));

  const text = '`adr/0001-storage.md` 와 `t1.md` 와 `ghost.md`';
  const found = missingCitations({ text, docPath: '.planning/spec/t1.md', citations: RULES, lookup: repositoryLookup(root) });
  assert.deepEqual(found, ['ghost.md']);
});
