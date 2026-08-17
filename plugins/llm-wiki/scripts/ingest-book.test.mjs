/**
 * Regression tests for ingest-book.mjs — built on a fixture that plants every
 * trap the design doc recorded from the pilot book: a code block whose lines
 * start with `#`, a body sentence marker promoted to a heading, 0-indexed page
 * markers, an unbalanced code block, an uppercase URL slug and a glossary
 * misread.
 *
 * Run with: node --test scripts/lint.test.mjs scripts/ingest-book.test.mjs scripts/research-channels.test.mjs scripts/setup-channels.test.mjs hooks/post-log.test.mjs
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

import { splitChapters, classifyHeading, checkText, fixText, slugify, stripFrontmatter } from './ingest-book.mjs';

const SCRIPT = new URL('./ingest-book.mjs', import.meta.url).pathname;
const SEP = '-'.repeat(48);

/** marker markdown as produced with --paginate_output (page ids are 0-indexed). */
const MARKER_MD = `

{0}${SEP}

앞표지 뒤에 붙은 짧은 서두. 이 정도 분량은 챕터로 서지 않는다.

## 2.18 문제는 변해도 방법은 변하지 않는다

동적 계획법의 기본 형태를 다룬다.

\`\`\`java
int dp(int[] nums, int start) {
    // #1 주석: 이 줄은 헤딩이 아니다
    return 0;
}
\`\`\`

{1}${SEP}

## 2-2 \\* 와일드카드가 없으면 일치할 수 없으므로 실패를 의미한다.

위 줄은 본문이 헤딩으로 오승격된 것이다.

## 2.19 동적 계획법과 역추적 알고리즘의 관계

참고: https://leetcode.com/problems/Iru-cache

\`\`\`css
#page { color: red; }
\`\`\`

{2}${SEP}

마지막 문단.
`;

test('splitChapters: code fences and mis-promoted sentences are not boundaries', () => {
  const { chapters, rejected } = splitChapters(MARKER_MD);
  assert.deepEqual(chapters.map((c) => c.title), [
    '2.18 문제는 변해도 방법은 변하지 않는다',
    '2.19 동적 계획법과 역추적 알고리즘의 관계',
  ]);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].title, /와일드카드/);
  assert.equal(rejected[0].reason, 'ends like a sentence');
  // The rejected heading stays in the body rather than being dropped.
  assert.match(chapters[0].text, /와일드카드가 없으면/);
  // `#1` and `#page` live inside fences and never split.
  assert.match(chapters[0].text, /#1 주석/);
  assert.match(chapters[1].text, /#page \{ color: red; \}/);
});

test('splitChapters: page numbers are converted from 0-indexed to printed pages', () => {
  const { chapters, pageStart, pageEnd } = splitChapters(MARKER_MD);
  assert.equal(pageStart, 1);
  assert.equal(pageEnd, 3);
  assert.equal(chapters[0].firstPage, 1);
  assert.equal(chapters[0].lastPage, 2);
  assert.equal(chapters[1].lastPage, 3);
  assert.match(chapters[1].text, /<!-- PDF p\.3 -->/);
  assert.doesNotMatch(chapters[0].text, /\{0\}-{10}/);
});

test('splitChapters: a thin preamble folds into the first chapter, a fat one stands alone', () => {
  const thin = splitChapters(MARKER_MD);
  assert.equal(thin.chapters.length, 2);

  const fat = splitChapters(`${'긴 서두 문장. '.repeat(40)}\n\n## 1.1 첫 절\n\n본문\n`);
  assert.equal(fat.chapters.length, 2);
  assert.equal(fat.chapters[0].title, '머리말 (첫 절 이전 본문)');
});

test('classifyHeading: numbering wins, sentence shape loses', () => {
  assert.equal(classifyHeading('2.18 문제는 변해도 방법은 변하지 않는다').ok, true);
  assert.equal(classifyHeading('선형 배열').ok, true);
  assert.equal(classifyHeading('0 2 3 4 6').ok, false);
  assert.equal(classifyHeading('와일드카드가 없으면 실패를 의미한다.').ok, false);
  assert.equal(classifyHeading('가'.repeat(80)).ok, false);
  // --require-numbering tightens it to dotted section numbers only.
  assert.equal(classifyHeading('선형 배열', true).ok, false);
  assert.equal(classifyHeading('2.18.1 선형 배열', true).ok, true);
});

test('checkText: the three deterministic rules fire once each', () => {
  const text = [
    '```java',
    'if (x) {',
    '  return 1;',
    '```',
    '',
    'https://leetcode.com/problems/Iru-cache 를 참고.',
  ].join('\n');
  const findings = checkText(text, { Iru: 'lru' });
  const rules = findings.map((f) => f.rule).sort();
  assert.deepEqual(rules, ['brace-balance', 'glossary', 'url-case']);
  assert.match(findings.find((f) => f.rule === 'brace-balance').detail, /off by 1/);
});

test('fixText: fixes the safe two, leaves other hosts and braces alone', () => {
  const text = 'https://leetcode.com/problems/Iru-cache and https://Example.com/PathKept and { unbalanced';
  const fixed = fixText(text, { Iru: 'lru' });
  assert.match(fixed, /leetcode\.com\/problems\/lru-cache/);
  assert.match(fixed, /Example\.com\/PathKept/);
  assert.match(fixed, /\{ unbalanced/);
});

test('slugify / stripFrontmatter', () => {
  assert.equal(slugify('2.18 문제는 변해도!'), '2-18-문제는-변해도');
  assert.equal(stripFrontmatter('---\na: 1\n---\nbody\n'), 'body\n');
  assert.equal(stripFrontmatter('no frontmatter\n'), 'no frontmatter\n');
});

// --- CLI ---

function run(args, opts = {}) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', ...opts });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('CLI split: writes chapters, a toc with the OCR warning, and page comments', () => {
  const root = tmpdir('ingest-book-split-');
  const md = path.join(root, 'book.md');
  fs.writeFileSync(md, MARKER_MD, 'utf8');
  const out = path.join(root, 'chapters');

  const res = run(['split', '--md', md, '--out', out, '--title', '테스트 책']);
  assert.equal(res.code, 0, res.stderr);

  const files = fs.readdirSync(out).sort();
  assert.equal(files.length, 3);
  assert.equal(files[0], '00-toc.md');
  assert.match(files[1], /^01-2-18-/);

  const toc = fs.readFileSync(path.join(out, '00-toc.md'), 'utf8');
  assert.match(toc, /# 테스트 책/);
  assert.match(toc, /조용히 고쳐 읽지 말고/);
  assert.match(toc, /p\.1-2/);

  const first = fs.readFileSync(path.join(out, files[1]), 'utf8');
  assert.match(first, /^<!-- 원본: PDF p\.1-2 -->/);
  assert.match(res.stdout, /1 heading candidates left inline/);
});

test('CLI check: reports findings with exit 1, --fix rewrites only the safe rules', () => {
  const root = tmpdir('ingest-book-check-');
  const file = path.join(root, '01-x.md');
  fs.writeFileSync(file, '```java\nif (x) {\n```\n\nhttps://leetcode.com/problems/Ifu-cache\n', 'utf8');

  const res = run(['check', '--dir', root]);
  assert.equal(res.code, 1);
  assert.match(res.stdout, /CHECK files=1/);
  assert.match(res.stdout, /brace-balance/);

  const fixed = run(['check', '--dir', root, '--fix']);
  assert.equal(fixed.code, 1); // brace imbalance survives on purpose
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /problems\/lfu-cache/);
  assert.match(text, /if \(x\) \{/);
});

test('CLI ingest: raw frontmatter hashes the body the way lint does', () => {
  const root = tmpdir('ingest-book-ingest-');
  const vault = path.join(root, 'vault');
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(vault, 'SCHEMA.md'), '# Wiki Schema\n', 'utf8');

  const chapters = path.join(root, 'chapters');
  fs.mkdirSync(chapters, { recursive: true });
  fs.writeFileSync(path.join(chapters, '00-toc.md'), '# toc\n', 'utf8');
  fs.writeFileSync(path.join(chapters, '01-a.md'), '# 첫 장\n\n본문\n', 'utf8');
  fs.writeFileSync(path.join(chapters, '_page_1_Diagram_0.jpeg'), 'binary', 'utf8');

  const res = run(['ingest', '--dir', chapters, '--book', '테스트 책', '--vault', vault]);
  assert.equal(res.code, 0, res.stderr);

  const dest = path.join(vault, 'raw', 'books', '테스트-책');
  const text = fs.readFileSync(path.join(dest, '01-a.md'), 'utf8');
  const end = text.indexOf('\n---', 3);
  const body = text.slice(end + 5);
  const recorded = /sha256: ([0-9a-f]{64})/.exec(text)[1];
  assert.equal(recorded, crypto.createHash('sha256').update(body, 'utf8').digest('hex'));
  assert.match(text, /ingested: \d{4}-\d{2}-\d{2}/);
  assert.ok(fs.existsSync(path.join(dest, '_page_1_Diagram_0.jpeg')));

  // The private vault repo keeps book text (2026-08-16 decision): nothing is gitignored.
  assert.ok(!fs.existsSync(path.join(vault, 'raw', 'books', '.gitignore')));
  // The log line is printed for the agent to write, never written here.
  assert.match(res.stdout, /## \[\d{4}-\d{2}-\d{2}\] ingest \| 테스트 책/);
  assert.ok(!fs.existsSync(path.join(vault, 'log.md')));

  const again = run(['ingest', '--dir', chapters, '--book', '테스트 책', '--vault', vault]);
  assert.equal(again.code, 2);
  assert.match(again.stderr, /already exists/);
});

test('CLI ingest: refuses a directory that is not a vault', () => {
  const root = tmpdir('ingest-book-novault-');
  const chapters = path.join(root, 'chapters');
  fs.mkdirSync(chapters, { recursive: true });
  fs.writeFileSync(path.join(chapters, '00-toc.md'), '# toc\n', 'utf8');
  const res = run(['ingest', '--dir', chapters, '--book', 'x', '--vault', root]);
  assert.equal(res.code, 2);
  assert.match(res.stderr, /not a vault/);
});

test('CLI convert: refuses a directory instead of scanning it', () => {
  const root = tmpdir('ingest-book-convert-');
  const res = run(['convert', '--pdf', root]);
  assert.equal(res.code, 2);
  // Either guard is a correct refusal: a non-macOS host stops before the path check.
  assert.match(res.stderr, /directory given|ENV refused/);
});

test('CLI doctor: reports every check and agrees with its own exit code', () => {
  const res = run(['doctor']);
  const out = res.stdout + (res.stderr || '');
  for (const id of ['platform', 'marker-pdf', 'docling', 'surya-models']) {
    assert.match(out, new RegExp(id));
  }
  assert.equal(res.code === 0, !/^MISS/m.test(out));
});
