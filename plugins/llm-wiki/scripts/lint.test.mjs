/**
 * Regression tests for lint.mjs — built on a throwaway fixture vault so every
 * group has a known, planted defect. Run with: node --test scripts/lint.test.mjs scripts/ingest-book.test.mjs scripts/research-channels.test.mjs scripts/setup-channels.test.mjs hooks/post-log.test.mjs
 *
 * Dependency-free: node:test / node:assert only.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const LINT = new URL('./lint.mjs', import.meta.url).pathname;

const SCHEMA = `# Wiki Schema

## Frontmatter

\`\`\`yaml
---
type: entity | concept                                  # required, 1:1 with the directory
tags: [from taxonomy below]                             # required
summary: one-line description of this page              # required
date: YYYY-MM-DD                                        # required
sources:                                                # required, always a YAML list
  - raw/articles/foo.md
# Optional:
confidence: high | medium | low
contested: true
contradictions: [page-slug]
---
\`\`\`

**Removed fields** — do not write these:
\`title\`, \`created\`, \`updated\`, \`source\` (scalar form), \`source_hash\`.

## Page Types & Directories

| type | directory | holds |
|---|---|---|
| \`entity\` | \`entities/\` | one notable tool |
| \`concept\` | \`concepts/\` | a concept |

## Tag Taxonomy

### Group
- \`approved\` — an approved tag
- \`also-approved\` — another approved tag
`;

/** Build a fixture vault with one planted defect per lint group. */
function makeVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-wiki-lint-'));
  const write = (rel, body) => {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body, 'utf8');
  };
  const page = (fields, body) => `---\n${fields}\n---\n\n${body}\n`;

  write('SCHEMA.md', SCHEMA);
  write('log.md', '# Log\n');

  // Healthy hub: linked from others, complete frontmatter.
  write('concepts/hub.md', page(
    'type: concept\ntags: [approved]\nsummary: the hub\ndate: 2026-08-16\nsources:\n  - https://example.com/a',
    '# Hub\n\nSee [[concepts/spoke]].',
  ));

  // broken-links: points at a page that does not exist, plus a missing raw source.
  write('concepts/spoke.md', page(
    'type: concept\ntags: [approved]\nsummary: the spoke\ndate: 2026-08-16\nsources:\n  - raw/articles/gone.md',
    '# Spoke\n\nSee [[concepts/hub]] and [[nowhere]].',
  ));

  // frontmatter: missing summary/sources, wrong directory for its type, drift key.
  write('concepts/broken-fm.md', page(
    'type: entity\ntags: [approved]\ndate: 2026-08-16\ntitle: removed field',
    '# Broken FM\n\nLinked from [[concepts/hub]] nowhere, so also an orphan.',
  ));

  // source-format: scheme-less URL is off-shape but not an error.
  write('concepts/odd-source.md', page(
    'type: concept\ntags: [approved]\nsummary: odd source\ndate: 2026-08-16\nsources:\n  - example.com/no-scheme',
    '# Odd Source\n\n[[concepts/hub]]',
  ));

  // tags: a tag outside the taxonomy.
  write('concepts/bad-tag.md', page(
    'type: concept\ntags: [approved, not-in-taxonomy]\nsummary: bad tag\ndate: 2026-08-16\nsources:\n  - https://example.com/b',
    '# Bad Tag\n\n[[concepts/hub]]',
  ));

  // contested + low-confidence-unmarked live on separate pages.
  write('concepts/contested.md', page(
    'type: concept\ntags: [approved]\nsummary: contested\ndate: 2026-08-16\ncontested: true\nsources:\n  - https://example.com/c',
    '# Contested\n\n[[concepts/hub]]',
  ));
  write('concepts/single-source.md', page(
    'type: concept\ntags: [approved]\nsummary: single source\ndate: 2026-08-16\nsources:\n  - https://example.com/d',
    '# Single Source\n\n[[concepts/hub]]',
  ));

  // stale-pages: old page whose approved tag has a much newer sibling.
  write('concepts/old.md', page(
    'type: concept\ntags: [approved]\nsummary: old page\ndate: 2020-01-01\nsources:\n  - https://example.com/e\n  - https://example.com/f',
    '# Old\n\n[[concepts/hub]]',
  ));

  // oversized: over the 200-line threshold.
  write('concepts/huge.md', page(
    'type: concept\ntags: [approved]\nsummary: huge page\ndate: 2026-08-16\nsources:\n  - https://example.com/g\n  - https://example.com/h',
    `# Huge\n\n[[concepts/hub]]\n${'filler\n'.repeat(210)}`,
  ));

  // title-dups: near-identical display names.
  write('entities/tool-alpha.md', page(
    'type: entity\ntags: [approved]\nsummary: tool alpha\ndate: 2026-08-16\nsources:\n  - https://example.com/i\n  - https://example.com/j',
    '# Tool Alpha Guide\n\n[[concepts/hub]]',
  ));
  write('entities/tool-alpha-v2.md', page(
    'type: entity\ntags: [approved]\nsummary: tool alpha v2\ndate: 2026-08-16\nsources:\n  - https://example.com/k\n  - https://example.com/l',
    '# Tool Alpha Guide v2\n\n[[concepts/hub]]',
  ));

  // A heading that is a whole markdown link — the display name must survive it.
  write('concepts/messy-heading.md', page(
    'type: concept\ntags: [approved]\nsummary: messy heading\ndate: 2026-08-16\nsources:\n  - https://example.com/n\n  - https://example.com/o',
    '# **[Report Title](https://example.com/report)**\n\n[[concepts/hub]]',
  ));

  // raw/: one absorbed bundle, one unabsorbed bundle, one unabsorbed flat file,
  // a feeds file that must never be counted, and a drifted digest.
  write('raw/articles/absorbed.md', 'body\n');
  write('raw/articles/orphan-source.md', 'a longer body so it sorts first\n');
  write('raw/papers/bundle-a/one.md', 'x\n');
  write('raw/papers/bundle-a/two.md', 'y\n');
  write('raw/feeds/noise.md', '---\nsha256: 0123456789abcdef\n---\nfeed noise\n');
  write('concepts/absorber.md', page(
    'type: concept\ntags: [approved]\nsummary: absorber\ndate: 2026-08-16\nsources:\n  - raw/articles/absorbed.md\n  - https://example.com/m',
    '# Absorber\n\n[[concepts/hub]]',
  ));
  const drifted = 'the body that no longer matches\n';
  write('raw/articles/drifted.md', `---\ningested: 2026-08-16\nsha256: ${crypto.createHash('sha256').update('different', 'utf8').digest('hex')}\n---\n${drifted}`);
  write('concepts/drift-absorber.md', page(
    'type: concept\ntags: [approved]\nsummary: digest watcher\ndate: 2026-08-16\nsources:\n  - raw/articles/drifted.md\n  - raw/papers/bundle-a/one.md',
    '# Digest Watcher\n\n[[concepts/hub]]',
  ));

  return root;
}

/** Run lint and return stdout. */
function lint(vault, args = []) {
  return execFileSync(process.execPath, [LINT, '--vault', vault, ...args], { encoding: 'utf8' });
}

function group(vault, id) {
  return JSON.parse(lint(vault, ['--group', id, '--json', '--limit', '100']));
}

const vault = makeVault();
test.after(() => fs.rmSync(vault, { recursive: true, force: true }));

test('summary reports error and backlog totals', () => {
  const out = lint(vault).split('\n');
  assert.match(out[0], /^LINT error=\d+ backlog=\d+$/);
  assert.ok(out.some((l) => l.startsWith('[backlog] ')), 'backlog folds into one line');
  assert.ok(out.some((l) => l.startsWith('broken-links ')), 'error groups are listed individually');
});

test('broken-links covers wikilinks and missing raw sources', () => {
  const { items } = group(vault, 'broken-links');
  assert.deepEqual(items.map((i) => i.target).sort(), ['nowhere', 'raw/articles/gone.md']);
  assert.ok(items.every((i) => i.refs >= 1));
});

test('frontmatter flags missing fields, directory mismatch and removed keys', () => {
  const { items } = group(vault, 'frontmatter');
  assert.equal(items.length, 1);
  const [item] = items;
  assert.equal(item.path, 'concepts/broken-fm.md');
  assert.ok(item.problems.includes('missing summary'));
  assert.ok(item.problems.includes('missing sources'));
  assert.ok(item.problems.includes('type entity in concepts/'));
  assert.ok(item.problems.includes('removed field title'));
});

test('off-shape sources are backlog, not a frontmatter error', () => {
  const { items } = group(vault, 'source-format');
  assert.deepEqual(items.map((i) => i.path), ['concepts/odd-source.md']);
});

test('raw-drift only checks full digests, so feed dedup ids are ignored', () => {
  const { items } = group(vault, 'raw-drift');
  assert.deepEqual(items.map((i) => i.path), ['raw/articles/drifted.md']);
});

test('tags reports unapproved tags by frequency', () => {
  const { items } = group(vault, 'tags');
  assert.deepEqual(items.map((i) => i.tag), ['not-in-taxonomy']);
  assert.equal(items[0].count, 1);
});

test('orphans ignores index.md backlinks', () => {
  const { items } = group(vault, 'orphans');
  const paths = items.map((i) => i.path);
  assert.ok(paths.includes('concepts/broken-fm.md'));
  assert.ok(!paths.includes('concepts/hub.md'), 'a linked page is never an orphan');
  lint(vault, ['--write-index']);
  const after = group(vault, 'orphans').items.map((i) => i.path);
  assert.deepEqual(after, paths, 'generated catalogs must not absorb the orphan signal');
});

test('raw-unabsorbed folds bundles and skips feeds', () => {
  const { items } = group(vault, 'raw-unabsorbed');
  const paths = items.map((i) => i.path);
  assert.ok(paths.includes('raw/articles/orphan-source.md'));
  assert.ok(!paths.some((p) => p.startsWith('raw/feeds/')), 'feeds are never a queue');
  assert.ok(!paths.includes('raw/articles/absorbed.md'), 'a referenced file is absorbed');
  assert.ok(!paths.includes('raw/papers/bundle-a'), 'one referenced file absorbs the whole bundle');
  assert.equal(items[0].path, 'raw/articles/orphan-source.md', 'sorted by size desc');
});

test('backlog page checks fire on their planted pages', () => {
  assert.deepEqual(group(vault, 'oversized').items.map((i) => i.path), ['concepts/huge.md']);
  assert.deepEqual(group(vault, 'stale-pages').items.map((i) => i.path), ['concepts/old.md']);
  assert.deepEqual(group(vault, 'contested').items.map((i) => i.path), ['concepts/contested.md']);
  const single = group(vault, 'low-confidence-unmarked').items.map((i) => i.path);
  assert.ok(single.includes('concepts/single-source.md'));
  assert.ok(!single.includes('concepts/old.md'), 'two sources is not single-source');
  const dups = group(vault, 'title-dups').items;
  assert.equal(dups.length, 1);
  assert.ok(dups[0].similarity >= 0.5);
});

test('--limit truncates while reporting the real total', () => {
  const one = JSON.parse(lint(vault, ['--group', 'tags', '--json', '--limit', '1']));
  assert.equal(one.items.length, 1);
  assert.equal(one.limit, 1);
  assert.ok(one.total >= 1);
});

test('--write-index regenerates catalogs and the root auto block', () => {
  lint(vault, ['--write-index']);
  const catalog = fs.readFileSync(path.join(vault, 'concepts/index.md'), 'utf8');
  assert.match(catalog, /\[\[concepts\/hub\|Hub\]\] — the hub/);
  assert.match(catalog, /do not hand-edit/);
  assert.match(catalog, /\[\[concepts\/messy-heading\|Report Title\]\]/, 'markdown in an H1 is stripped for the display name');

  fs.writeFileSync(path.join(vault, 'index.md'), `# Wiki Index\n\n## Manual skeleton\n\n<!-- llm-wiki:auto:start -->\nstale\n<!-- llm-wiki:auto:end -->\n\ntail\n`, 'utf8');
  lint(vault, ['--write-index']);
  const root = fs.readFileSync(path.join(vault, 'index.md'), 'utf8');
  assert.match(root, /## Manual skeleton/, 'the hand-written skeleton survives');
  assert.match(root, /tail/, 'content after the block survives');
  assert.doesNotMatch(root, /stale/);
  assert.match(root, /\[\[concepts\/index\|concepts\/\]\]/);
  assert.match(root, /Hub pages/);
});

test('unknown group and missing vault fail loudly', () => {
  assert.throws(() => lint(vault, ['--group', 'nope']), /status 2|Command failed/);
  assert.throws(() => execFileSync(process.execPath, [LINT, '--vault', path.join(vault, 'nope')], { encoding: 'utf8' }));
});
