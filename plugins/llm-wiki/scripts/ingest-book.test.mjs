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

import { splitChapters, classifyHeading, checkText, fixText, slugify, stripFrontmatter, laneFlagText, bookAssetId, rewriteAssetLinks, findIsbn, readSkipList, trimUrl, checkUrlReachability } from './ingest-book.mjs';

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
  assert.equal(classifyHeading('2.18 선형 배열', true).ok, true);
});

test('splitChapters: a running header opens no file and its words survive inline', () => {
  // `## CHAPTER` is what marker makes of the header printed on every chapter
  // opener: it repeats, and nothing sits under it. `요약` repeats just as often
  // but carries a real section, so it has to keep its own file.
  const body = (n) => `${'요약 본문 문장. '.repeat(30)}\n\n`;
  const md = ['1.1 첫 절', 'CHAPTER', '요약', '1.2 둘째 절', 'CHAPTER', '요약', '1.3 셋째 절', 'CHAPTER', '요약']
    .map((t) => (t === 'CHAPTER' ? `## CHAPTER\n\n` : `## ${t}\n\n${body()}`))
    .join('');

  const { chapters, rejected } = splitChapters(md);

  assert.deepEqual(chapters.map((c) => c.title), ['1.1 첫 절', '요약', '1.2 둘째 절', '요약', '1.3 셋째 절', '요약']);
  assert.equal(rejected.filter((r) => r.reason === 'empty section').length, 3);
  // Nothing is dropped: the demoted heading reappears as text in the chapter
  // it interrupted.
  assert.match(chapters[0].text, /## CHAPTER/);
  assert.equal(chapters.filter((c) => !c.text.trim()).length, 0);
});

test('splitChapters: a repeated heading with almost nothing under it is a running header', () => {
  const md = ['머리', '머리', '머리']
    .map((t, i) => `## ${t}\n\n짧은 꼬리 ${i}\n\n## ${i + 1}.1 실제 절\n\n${'본문 문장. '.repeat(40)}\n\n`)
    .join('');

  const { chapters, rejected } = splitChapters(md);

  assert.deepEqual(chapters.map((c) => c.title), ['1.1 실제 절', '2.1 실제 절', '3.1 실제 절']);
  assert.equal(rejected.filter((r) => /^running header \(3x/.test(r.reason)).length, 3);
  assert.match(chapters[0].text, /짧은 꼬리 0/);
});

test('classifyHeading: a sub-section deeper than the cut is not a chapter of its own', () => {
  assert.equal(classifyHeading('9.2 언어적 안티패턴').ok, true);
  assert.equal(classifyHeading('9.2.4 안티패턴이 혼란을 일으키는 이유').ok, false);
  assert.match(classifyHeading('9.2.4 안티패턴이 혼란을 일으키는 이유').reason, /section depth 2/);
  // The cut is a knob, not a constant.
  assert.equal(classifyHeading('9.2.4 안티패턴이 혼란을 일으키는 이유', false, 3).ok, true);
  assert.equal(classifyHeading('9.2', false, 1).ok, false);
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

test('CLI split: --lane reaches the toc, so the conversion line names the lane that ran', () => {
  const root = tmpdir('ingest-book-split-lane-');
  const md = path.join(root, 'book.md');
  fs.writeFileSync(md, MARKER_MD, 'utf8');

  const withLane = path.join(root, 'with-lane');
  assert.equal(run(['split', '--md', md, '--out', withLane, '--lane', 'balanced']).code, 0);
  assert.match(fs.readFileSync(path.join(withLane, '00-toc.md'), 'utf8'), /--mode balanced/);

  // Omitted stays honest rather than naming a lane that may not be the one that ran.
  const noLane = path.join(root, 'no-lane');
  assert.equal(run(['split', '--md', md, '--out', noLane]).code, 0);
  assert.match(fs.readFileSync(path.join(noLane, '00-toc.md'), 'utf8'), /레인 미기록/);
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
  fs.writeFileSync(path.join(chapters, '01-a.md'), '# 첫 장\n\n![](_page_1_Diagram_0.jpeg)\n\n본문\n', 'utf8');
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
  // Images live outside the book folder so git never sees them, and the link
  // in the markdown is rewritten to reach them.
  const assetId = bookAssetId('테스트 책');
  const assetDir = path.join(vault, 'raw', 'books', '_assets', assetId);
  assert.ok(!fs.existsSync(path.join(dest, '_page_1_Diagram_0.jpeg')));
  assert.ok(fs.existsSync(path.join(assetDir, '_page_1_Diagram_0.jpeg')));
  assert.match(text, /!\[\]\(\.\.\/_assets\/[0-9a-f]{12}\/_page_1_Diagram_0\.jpeg\)/);

  const index = JSON.parse(fs.readFileSync(path.join(vault, 'raw', 'books', '_assets', 'index.json'), 'utf8'));
  assert.equal(index[assetId].title, '테스트 책');
  assert.equal(index[assetId].slug, '테스트-책');
  assert.equal(index[assetId].files, 1);

  // The private vault repo keeps book TEXT (2026-08-16 decision); only the
  // assets root is meant to be ignored, and this command does not write one.
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

test('laneFlagText: a known lane names its flags, an unrecorded one says so', () => {
  const base = '--paginate_output --output_format markdown --common_element_threshold 1.1 --max_streak 999999';
  assert.equal(laneFlagText('balanced'), `--mode balanced ${base}`);
  assert.equal(laneFlagText('force_ocr'), `--force_ocr ${base}`);
  // Never silently name a lane that may not be the one that ran.
  assert.match(laneFlagText(null), /레인 미기록/);
  assert.match(laneFlagText('fast'), /레인 미기록/);
});

test('convert: the IgnoreTextProcessor kill switch reaches marker itself, not just the toc', () => {
  const root = tmpdir('ingest-book-flags-');
  const pdf = path.join(root, 'book.pdf');
  fs.writeFileSync(pdf, '%PDF-1.4\n');

  // Stub marker_single so the real converter is never invoked; it only records argv.
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const argvFile = path.join(root, 'argv.txt');
  fs.writeFileSync(path.join(bin, 'marker_single'), `#!/bin/sh\nprintf '%s\\n' "$@" > ${argvFile}\n`, 'utf8');
  fs.chmodSync(path.join(bin, 'marker_single'), 0o755);

  run(['convert', '--pdf', pdf, '--lane', 'balanced', '--out', path.join(root, 'out')], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });

  const argv = fs.readFileSync(argvFile, 'utf8').trim().split('\n');
  // A subheading that opens a bullet list is otherwise deleted as a running foot.
  assert.deepEqual(argv.slice(argv.indexOf('--common_element_threshold'), argv.indexOf('--common_element_threshold') + 2),
    ['--common_element_threshold', '1.1']);
  assert.deepEqual(argv.slice(argv.indexOf('--max_streak'), argv.indexOf('--max_streak') + 2),
    ['--max_streak', '999999']);
});

test('CLI convert: an unknown lane is refused before marker is invoked', () => {
  const root = tmpdir('ingest-book-lane-');
  const pdf = path.join(root, 'book.pdf');
  fs.writeFileSync(pdf, '%PDF-1.4\n');

  const res = run(['convert', '--pdf', pdf, '--lane', 'fast']);
  assert.equal(res.code, 2);
  assert.match(res.stderr, /unknown --lane fast/);
});

test('CLI queue: refuses a missing --books instead of scanning the cwd', () => {
  const missing = run(['queue']);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /--books DIR is required/);

  const root = tmpdir('ingest-book-queue-');
  const notThere = run(['queue', '--books', path.join(root, 'nope')]);
  assert.equal(notThere.code, 2);
  assert.match(notThere.stderr, /not a directory/);
});

test('bookAssetId: normalisation-proof, so a cloud sync cannot split one book in two', () => {
  const nfc = '클린 코드'.normalize('NFC');
  const nfd = '클린 코드'.normalize('NFD');
  assert.notEqual(nfc, nfd);                       // the trap this guards against
  assert.equal(bookAssetId(nfc), bookAssetId(nfd));
  assert.match(bookAssetId(nfc), /^[0-9a-f]{12}$/);
  assert.notEqual(bookAssetId('클린 코드'), bookAssetId('클린 아키텍처'));
});

test('rewriteAssetLinks: only known assets move, other links are left alone', () => {
  const names = new Set(['_page_1_Diagram_0.jpeg', '그림 2.png']);
  const md = [
    '![](_page_1_Diagram_0.jpeg)',
    '![캡션](%EA%B7%B8%EB%A6%BC%202.png)',   // percent-encoded name
    '![](https://example.com/remote.png)',
    '[본문 링크](02-b.md)',
  ].join('\n');
  const out = rewriteAssetLinks(md, names, '../_assets/abc123abc123');

  assert.match(out, /!\[\]\(\.\.\/_assets\/abc123abc123\/_page_1_Diagram_0\.jpeg\)/);
  assert.match(out, /!\[캡션\]\(\.\.\/_assets\/abc123abc123\/%EA%B7%B8%EB%A6%BC%202\.png\)/);
  assert.match(out, /!\[\]\(https:\/\/example\.com\/remote\.png\)/);
  assert.match(out, /\[본문 링크\]\(02-b\.md\)/);
});

test('findIsbn: reads the copyright page, ignores other numbers', () => {
  assert.equal(findIsbn(['ISBN 979-11-6002-326-8 ']), '9791160023268');
  assert.equal(findIsbn(['앞', 'ISBN:9784816336140']), '9784816336140');
  assert.equal(findIsbn(['페이지 123', '전화 02-1234-5678']), null);
});

/**
 * A converted-queue sandbox: one book marker has already produced markdown for,
 * one recorded in the manifest but with nothing on disk, and a vault to load into.
 */
function loadFixture() {
  const root = tmpdir('ingest-book-load-');
  const q = path.join(root, 'q');
  const bookDir = path.join(q, 'books', 'test-book', 'Test Book');
  fs.mkdirSync(bookDir, { recursive: true });
  fs.writeFileSync(path.join(bookDir, 'Test Book.md'), [
    '', `{0}${SEP}`, '',
    '머리말이다. 이 정도로는 챕터가 서지 않는다.', '',
    '## 1 첫 번째 장', '',
    '첫 장의 본문이다. 본문 있는 챕터로 인정받을 만큼 충분히 길게 쓴 문장을 이어 붙인다. 계속 이어 쓴다.', '',
    `{1}${SEP}`, '',
    '## 2 두 번째 장', '',
    '둘째 장의 본문이다. 마찬가지로 분량을 확보하기 위해 여러 문장을 이어 쓴다. 여기까지가 본문이다.', '',
  ].join('\n'), 'utf8');

  fs.writeFileSync(path.join(q, 'queue.json'), JSON.stringify([
    { file: 'Test Book.pdf', pages: 40, lane: 'balanced', status: 'done' },
    { file: 'Never Ran.pdf', pages: 10, lane: 'balanced', status: 'pending' },
  ]), 'utf8');

  const vault = path.join(root, 'vault');
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(vault, 'SCHEMA.md'), '# SCHEMA\n', 'utf8');
  return { root, q, vault };
}

test('CLI load: takes a converted book through split -> check -> ingest and records it', () => {
  const { q, vault } = loadFixture();

  const res = run(['load', '--out', q, '--vault', vault]);
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /Test Book\.pdf — ok \(2 chapters/);
  // Only a converted book is eligible; a pending one is not offered.
  assert.match(res.stdout, /1 converted, 1 to load/);

  const state = JSON.parse(fs.readFileSync(path.join(q, 'load.json'), 'utf8'));
  assert.equal(state.length, 1);
  assert.equal(state[0].status, 'loaded');
  assert.equal(state[0].chapters, 2);

  const dest = path.join(vault, 'raw', 'books', 'test-book');
  assert.deepEqual(fs.readdirSync(dest).sort(), ['00-toc.md', '01-1-첫-번째-장.md', '02-2-두-번째-장.md']);
  // The lane the queue recorded has to reach the toc; split cannot infer it.
  assert.match(fs.readFileSync(path.join(dest, '00-toc.md'), 'utf8'), /--mode balanced/);
  // The log.md lines are collected, not left for the operator to retype 184 times.
  assert.match(fs.readFileSync(path.join(q, 'load-log.md'), 'utf8'), /ingest \| Test Book/);
});

test('CLI load: a second run is a no-op, and --force reproduces the same book exactly', () => {
  const { q, vault } = loadFixture();
  const dest = path.join(vault, 'raw', 'books', 'test-book');

  assert.equal(run(['load', '--out', q, '--vault', vault]).code, 0);
  const first = fs.readdirSync(dest).sort();

  assert.match(run(['load', '--out', q, '--vault', vault]).stdout, /0 to load, 1 skipped/);

  // The trap: chapters written inside the marker output tree make findMarkdown
  // pick 00-toc.md on the rerun and split the index into chapters of its own,
  // and a previous split's files survive into the vault beside the new ones.
  const forced = run(['load', '--out', q, '--vault', vault, '--force']);
  assert.equal(forced.code, 0, forced.stderr);
  assert.match(forced.stdout, /ok \(2 chapters/);
  assert.deepEqual(fs.readdirSync(dest).sort(), first);
});

test('CLI load: a skip list keeps a book out of the vault, a missing conversion fails it', () => {
  const { root, q, vault } = loadFixture();

  const skip = path.join(root, 'skip.txt');
  fs.writeFileSync(skip, '# 제외\nTest Book.pdf\n', 'utf8');
  assert.match(run(['load', '--out', q, '--vault', vault, '--skip', skip]).stdout, /0 to load, 1 skipped/);
  assert.equal(fs.existsSync(path.join(vault, 'raw', 'books', 'test-book')), false);

  // A book the manifest calls converted but that has no markdown is recorded as
  // failed and reported, not a crash that takes the rest of the run down.
  const manifest = path.join(q, 'queue.json');
  const entries = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  entries[1].status = 'done';
  fs.writeFileSync(manifest, JSON.stringify(entries), 'utf8');

  const res = run(['load', '--out', q, '--vault', vault]);
  assert.equal(res.code, 1);
  assert.match(res.stdout, /Never Ran\.pdf — FAILED/);
  assert.match(res.stdout, /loaded=1 failed=1/);
  const state = JSON.parse(fs.readFileSync(path.join(q, 'load.json'), 'utf8'));
  assert.equal(state.find((e) => e.file === 'Never Ran.pdf').stage, 'find');
});

test('readSkipList: comments and the .pdf suffix are optional, an NFD name still matches', () => {
  const root = tmpdir('ingest-book-skip-');
  const file = path.join(root, 'skip.txt');
  fs.writeFileSync(file, ['# 주석', '', '함께 자라기.pdf', '클린 코드'.normalize('NFD')].join('\n'), 'utf8');

  const skip = readSkipList(file);
  assert.equal(skip.has('함께 자라기'), true);
  assert.equal(skip.has('클린 코드'.normalize('NFC')), true);   // the NFD trap
  assert.equal(skip.has('# 주석'), false);
});

test('trimUrl: markdown escaping and sentence punctuation come back off', () => {
  // Measured false positive: escaped it 404s, unescaped it is 200. marker
  // double-escapes inside link text, so one pass over a single backslash is
  // not enough.
  assert.equal(
    trimUrl('https://commons.wikimedia.org/wiki/File:The\\\\_test\\\\_automation\\\\_pyramid.png'),
    'https://commons.wikimedia.org/wiki/File:The_test_automation_pyramid.png',
  );
  assert.equal(trimUrl('https://example.com/a.'), 'https://example.com/a');
  assert.equal(trimUrl('https://example.com/a_b'), 'https://example.com/a_b');
  assert.equal(trimUrl('https://example.com/x(y)'), 'https://example.com/x(y)');
  assert.equal(trimUrl('https://example.com/x)'), 'https://example.com/x');
});

test('check --urls: only 404/410 are dead, a declining server is not a defect', () => {
  const root = tmpdir('ingest-book-urls-');
  const md = path.join(root, 'book.md');
  fs.writeFileSync(md, [
    '- 살아 있음: https://alive.example/ok',
    '- 봇 차단이지 결함이 아님: https://blocked.example/page',
    '- 서버 장애이지 결함이 아님: https://broken.example/page',
    '- 사라짐: https://gone.example/missing',
    '- 닿지 않음: https://nodns.example/x',
    '- 코드블록 안은 제외:',
    '```',
    'curl https://incode.example/nope',
    '```',
  ].join('\n'), 'utf8');

  // A seeded cache is the whole probe result, so the test never leaves the machine.
  const cache = path.join(root, 'cache.json');
  fs.writeFileSync(cache, JSON.stringify({
    'https://alive.example/ok': '200',
    'https://blocked.example/page': '403',
    'https://broken.example/page': '500',
    'https://gone.example/missing': '404',
    'https://nodns.example/x': '000',
  }), 'utf8');

  const { findings, summary } = checkUrlReachability([md], { urls_cache: cache });
  assert.equal(summary.probed, 0, 'a cached URL must not be probed again');
  assert.equal(summary.checked, 5, 'a URL inside a code fence is not a link');
  assert.deepEqual(findings.map((f) => f.rule).sort(), ['url-dead', 'url-unreachable']);
  assert.match(findings.find((f) => f.rule === 'url-dead').detail, /404 https:\/\/gone\.example/);
});

test('CLI check --urls: reports through the normal finding path and exit code', () => {
  const root = tmpdir('ingest-book-urls-cli-');
  const md = path.join(root, 'book.md');
  fs.writeFileSync(md, '- 참고: https://gone.example/missing\n', 'utf8');
  const cache = path.join(root, 'cache.json');
  fs.writeFileSync(cache, JSON.stringify({ 'https://gone.example/missing': '404' }), 'utf8');

  const res = run(['check', '--dir', md, '--urls', '--urls-cache', cache]);
  assert.equal(res.code, 1);
  assert.match(res.stdout, /CHECK urls checked=1 probed=0 dead=1 unreachable=0/);
  assert.match(res.stdout, /url-dead/);

  // Without the flag the network rule does not run at all.
  const off = run(['check', '--dir', md]);
  assert.equal(off.code, 0);
  assert.doesNotMatch(off.stdout, /url-dead/);
});
