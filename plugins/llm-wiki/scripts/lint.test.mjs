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
import { fileURLToPath } from 'node:url';

// `URL.pathname` yields `/C:/…` on Windows, which resolves to `C:\C:\…`.
const LINT = fileURLToPath(new URL('./lint.mjs', import.meta.url));

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

  // The shapes SCHEMA allows beyond raw//https//github, and the one it does not:
  // an element that packs several sources into prose.
  write('concepts/new-shapes.md', page(
    'type: concept\ntags: [approved]\nsummary: shape coverage\ndate: 2026-08-16\nsources:\n  - code:crates/risk/engine.rs:10-20\n  - session:unknown\n  - session:2026-08-16\n  - "web: alpha.com, beta.com"',
    '# New Shapes\n\n[[concepts/hub]]',
  ));

  // tags: one of each violation, plus a free keyword that must stay silent.
  write('concepts/bad-tag.md', page(
    'type: concept\ntags: [approved, free-keyword, Approved, MixedCase, snake_case, 2026-05]\nsummary: bad tag\ndate: 2026-08-16\nsources:\n  - https://example.com/b',
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
  assert.deepEqual(items.map((i) => i.path).sort(), ['concepts/new-shapes.md', 'concepts/odd-source.md']);
});

test('code:, session:unknown pass; prose packing several sources does not', () => {
  const item = group(vault, 'source-format').items.find((i) => i.path === 'concepts/new-shapes.md');
  assert.deepEqual(item.sources, ['web: alpha.com, beta.com'], 'only the prose element is off-shape');
});

test('raw-drift only checks full digests, so feed dedup ids are ignored', () => {
  const { items } = group(vault, 'raw-drift');
  assert.deepEqual(items.map((i) => i.path), ['raw/articles/drifted.md']);
});

test('tags reports vocabulary splits, not every tag outside the taxonomy', () => {
  const { items } = group(vault, 'tags');
  const byTag = new Map(items.map((i) => [i.tag, i]));
  assert.ok(!byTag.has('free-keyword'), 'a free keyword is allowed alongside the controlled vocabulary');
  assert.deepEqual(
    [...byTag.keys()].sort(),
    ['2026-05', 'Approved', 'MixedCase', 'snake_case'],
  );
  assert.deepEqual(byTag.get('Approved'), { tag: 'Approved', count: 1, pages: ['concepts/bad-tag.md'], reason: 'spelling', suggest: 'approved' });
  assert.equal(byTag.get('MixedCase').reason, 'case');
  assert.equal(byTag.get('MixedCase').suggest, 'mixedcase');
  assert.equal(byTag.get('snake_case').suggest, 'snake-case');
  assert.equal(byTag.get('2026-05').reason, 'banned');
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

// --- log.md rotation ---

const LOG_HEADER = '# Wiki Log\n\n> Chronological record of all wiki actions. Append-only.\n> Format: `## [YYYY-MM-DD] action | subject`\n';

/** Minimal vault whose only interesting file is log.md — rotation mutates it. */
function makeLogVault(entries) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-wiki-log-'));
  fs.writeFileSync(path.join(root, 'SCHEMA.md'), SCHEMA, 'utf8');
  fs.writeFileSync(path.join(root, 'log.md'), `${LOG_HEADER}\n${entries}`, 'utf8');
  return root;
}

test('--rotate-log archives by the newest entry year and leaves a pointer', () => {
  const log = makeLogVault('## [2025-01-02] ingest | old\n- a\n\n## [2026-03-04] update | newer\n- b\n');
  try {
    const out = lint(log, ['--rotate-log']);
    assert.match(out, /rotated log\.md → log-2026\.md \(2 entries/);

    const archive = fs.readFileSync(path.join(log, 'log-2026.md'), 'utf8');
    assert.match(archive, /# Wiki Log/, 'the archive keeps the header so it reads standalone');
    assert.match(archive, /\[2025-01-02\][\s\S]*\[2026-03-04\]/, 'every entry moved, in order');

    const fresh = fs.readFileSync(path.join(log, 'log.md'), 'utf8');
    assert.match(fresh, /# Wiki Log/);
    assert.match(fresh, /이전 이력: `log-2026\.md` \(2 entries\)/, 'past history stays discoverable');
    assert.doesNotMatch(fresh, /^## \[\d{4}-/m, 'no entries carried over');
  } finally {
    fs.rmSync(log, { recursive: true, force: true });
  }
});

test('rotating twice in a year does not overwrite the first archive', () => {
  const log = makeLogVault('## [2026-03-04] update | first\n- a\n');
  try {
    lint(log, ['--rotate-log']);
    fs.appendFileSync(path.join(log, 'log.md'), '## [2026-05-06] update | second\n- b\n', 'utf8');
    assert.match(lint(log, ['--rotate-log']), /log-2026-2\.md/);
    assert.ok(fs.existsSync(path.join(log, 'log-2026.md')));
  } finally {
    fs.rmSync(log, { recursive: true, force: true });
  }
});

test('rotating an entry-less log is refused, not silently emptied', () => {
  const log = makeLogVault('');
  try {
    const result = execFileSync(process.execPath, [LINT, '--vault', log, '--rotate-log'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(result, '');
    assert.match(fs.readFileSync(path.join(log, 'log.md'), 'utf8'), /# Wiki Log/);
    assert.ok(!fs.existsSync(path.join(log, 'log-2026.md')));
  } finally {
    fs.rmSync(log, { recursive: true, force: true });
  }
});

test('log-rotation fires on bytes long before the entry count would', () => {
  // Few entries, but heavy ones — the case the entry-count limit misses entirely.
  const fat = Array.from({ length: 20 }, (_, i) => `## [2026-0${(i % 9) + 1}-01] update | entry ${i}\n${'x'.repeat(9000)}\n`).join('\n');
  const log = makeLogVault(fat);
  try {
    const summary = lint(log);
    assert.match(summary, /^log-rotation 1$/m);
    const { items } = JSON.parse(lint(log, ['--group', 'log-rotation', '--json']));
    assert.deepEqual(items[0].over, ['bytes'], '20 entries is nowhere near the entry limit');
    assert.ok(items[0].bytes > items[0].byteLimit);
    assert.equal(items[0].entries, 20);
  } finally {
    fs.rmSync(log, { recursive: true, force: true });
  }
});

test('a small log raises nothing', () => {
  const log = makeLogVault('## [2026-03-04] update | tiny\n- a\n');
  try {
    assert.doesNotMatch(lint(log), /log-rotation/);
  } finally {
    fs.rmSync(log, { recursive: true, force: true });
  }
});

test('unknown group and missing vault fail loudly', () => {
  assert.throws(() => lint(vault, ['--group', 'nope']), /status 2|Command failed/);
  assert.throws(() => execFileSync(process.execPath, [LINT, '--vault', path.join(vault, 'nope')], { encoding: 'utf8' }));
});

test('a CRLF working copy parses the same as LF', () => {
  // A git checkout with core.autocrlf=true hands back CRLF while the committed
  // bytes are LF, so every parser here must see the same text on both.
  const crlf = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-wiki-crlf-'));
  try {
    const write = (rel, body) => {
      fs.mkdirSync(path.join(crlf, path.dirname(rel)), { recursive: true });
      fs.writeFileSync(path.join(crlf, rel), body.replace(/\n/g, '\r\n'), 'utf8');
    };
    write('SCHEMA.md', SCHEMA);
    write('log.md', '# Log\n');
    write('concepts/a.md', '---\ntype: concept\ntags: [approved]\nsummary: page a\ndate: 2026-08-16\nsources:\n  - https://example.com/a\n---\n\n# A\n\n[[concepts/b]]\n');
    write('concepts/b.md', '---\ntype: concept\ntags: [approved]\nsummary: page b\ndate: 2026-08-16\nsources:\n  - https://example.com/b\n---\n\n# B\n\n[[concepts/a]]\n');
    // A removed field must still be caught, which only works if the SCHEMA
    // "Removed fields" list was parsed out of the CRLF text.
    write('concepts/c.md', '---\ntype: concept\ntags: [approved]\nsummary: page c\ndate: 2026-08-16\ntitle: removed field\nsources:\n  - https://example.com/c\n---\n\n# C\n\n[[concepts/a]]\n');

    const out = lint(crlf).split('\n');
    assert.match(out[0], /^LINT error=\d+ backlog=\d+$/);
    const fm = JSON.parse(lint(crlf, ['--group', 'frontmatter', '--json', '--limit', '100']));
    assert.equal(fm.items.filter((i) => i.path === 'concepts/a.md').length, 0, 'a valid CRLF page is not a frontmatter error');
    const removed = fm.items.find((i) => i.path === 'concepts/c.md');
    assert.ok(removed && removed.problems.includes('removed field title'), 'the SCHEMA removed-field list is parsed out of CRLF text');
  } finally {
    fs.rmSync(crlf, { recursive: true, force: true });
  }
});

test('raw sha256 matches whether the working copy is LF or CRLF', () => {
  // The digest is recorded once and read on every platform, so it must be
  // computed over LF-normalized text rather than the checkout's bytes.
  const digest = (body) => crypto.createHash('sha256').update(body, 'utf8').digest('hex');
  const body = '# Source\n\nbody line one\nbody line two\n';
  const make = (eol) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-wiki-eol-'));
    const write = (rel, text) => {
      fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text.replace(/\n/g, eol), 'utf8');
    };
    write('SCHEMA.md', SCHEMA);
    write('log.md', '# Log\n');
    write('raw/articles/one.md', `---\nsource_url: https://example.com/one\ningested: 2026-08-16\nsha256: ${digest(body)}\n---\n${body}`);
    return root;
  };
  for (const eol of ['\n', '\r\n']) {
    const root = make(eol);
    try {
      const drift = JSON.parse(lint(root, ['--group', 'raw-drift', '--json', '--limit', '100']));
      assert.equal(drift.total, 0, `no drift with ${eol === '\n' ? 'LF' : 'CRLF'} line endings`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});
