#!/usr/bin/env node
/**
 * llm-wiki ingest-book — scanned book PDF -> chapter markdown -> vault raw/books/.
 *
 * Dependency-free Node ESM, single file (node: builtins only). The conversion
 * itself is NOT dependency-free: it shells out to `marker_single`, which only
 * this machine has. Every subcommand therefore runs the environment guard first
 * and refuses outright when the host cannot do the work, so the pipeline never
 * half-runs on another device.
 *
 * Usage:
 *   node ingest-book.mjs doctor [--pdf FILE]
 *   node ingest-book.mjs convert --pdf FILE [--out DIR] [--pages A-B]
 *   node ingest-book.mjs split --md FILE --out DIR [--title T] [--level N]
 *                              [--require-numbering] [--page-offset N]
 *                              [--no-page-offset]
 *   node ingest-book.mjs check --dir DIR [--fix] [--glossary FILE]
 *                              [--json] [--limit N]
 *   node ingest-book.mjs ingest --dir DIR --book SLUG [--vault PATH] [--force]
 *
 * Design record: docs/plans/2026-08-16-book-ingest-pipeline-design.md.
 * Two decisions in there are deliberately overridden here, see `splitChapters`
 * (single marker run, pagination markers instead of a second JSON pass) and
 * `ingest` (the log.md line is printed, never written).
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

// --- Constants ---

const MARKER_BIN = 'marker_single';
const DOCLING_BIN = 'docling';

/** Fixed marker flags. `--use_llm` is absent on purpose: it ships pages to an external API (design §9-4). */
const MARKER_BASE_FLAGS = ['--paginate_output', '--output_format', 'markdown'];

/**
 * Which OCR path a PDF needs, decided by whether it carries an extractable text
 * layer. Measured over a fixed 20-page range on two books of this corpus:
 *
 *   truly textless page (pdftotext yields nothing)
 *     --mode balanced   24.7 s/page, headings emitted as `##` (what `split` keys on)
 *     --force_ocr       31.7 s/page, headings emitted as `### **bold**`
 *   page carrying a text layer
 *     --mode balanced    2.0 s/page, ZERO code fences  <- trusts the layer, destroys code
 *     --force_ocr       13.4 s/page, 122 code fences
 *
 * The trap is that a scanned Korean book's "text layer" is usually junk - either
 * a custom font encoding with no ToUnicode CMap (`>?@A@ BCD@EF@`) or a bad OCR
 * layer baked in by the scanner (`//` read as `II`, 객체 as 객쳬). Both `fast`
 * and `balanced` believe it and flatten code blocks into prose; only
 * `--force_ocr` re-reads the page image. So balanced is the faster, cleaner
 * path but ONLY where there is no layer at all to be fooled by.
 *
 * `--mode fast` is never used. It is the MPS default, and on a textless page it
 * still block-OCRs at 26.4 s/page while emitting worse headings than balanced.
 */
const LANE_FLAGS = {
  balanced: ['--mode', 'balanced'],
  force_ocr: ['--force_ocr'],
};

/**
 * How the toc records the flags a book was converted with. `split` only sees
 * the markdown, so the lane has to be passed in; an unrecorded lane says so
 * rather than naming a lane that may not be the one that ran.
 */
function laneFlagText(lane) {
  const flags = LANE_FLAGS[lane];
  if (!flags) return `${MARKER_BASE_FLAGS.join(' ')} (레인 미기록)`;
  return [...flags, ...MARKER_BASE_FLAGS].join(' ');
}

/**
 * surya settings that marker exposes only through the environment, applied as
 * defaults so the caller does not have to remember them. Anything already set
 * in the environment wins.
 *
 * The cap exists because full-page OCR sometimes falls into repetition and
 * then generates until the slot's KV context is exhausted — measured at prompt
 * 2,441 + generation 9,847 = the full 12,288 — burning eight minutes on one
 * page. 7.7% of pages did this on the first book and consumed 39% of the GPU
 * time. Capping sends those pages to block-mode fallback instead: on a
 * controlled 20-page range it cut the run from 250s to 170s while the only
 * difference in the output was eight spaces of comment alignment. Legitimate
 * pages generate far less (median 1,077 tokens, p90 1,687), so 4,096 leaves
 * 2.4x headroom.
 *
 * Slot count is NOT set here. It is hardware-bound — on an M3 Pro (14 GPU
 * cores) throughput peaked at 12 and regressed at 16 — so the right value on
 * another machine is a different number, and surya's own default is saner than
 * a figure measured on one laptop. Set SURYA_INFERENCE_PARALLEL to tune it.
 */
const SURYA_TUNING = { SURYA_MAX_TOKENS_FULL_PAGE: '4096' };

const INSTALL_HINT = [
  'uv tool install --python 3.12 marker-pdf',
  'uv tool install --python 3.12 docling --with ocrmac   # web ingest only',
].join('\n  ');

/** `{12}------------------------------------------------` — marker's page separator, 0-indexed. */
const PAGE_MARKER = /^\{(\d+)\}-{10,}\s*$/;
/**
 * What `split` leaves behind once the separator above has been consumed —
 * with the printed page appended when the book's own numbering is known.
 * Keep this in step with the marker `splitChapters` emits: the code-block
 * rules rely on it to tell a page break from a real gap between listings.
 */
const PAGE_COMMENT = /^<!-- PDF p\.\d+(?: · 책 p\.\d+)? -->\s*$/;

/** The one place the marker is written, so the matcher above has a single shape to track. */
function pageComment(pdfPage, bookPage) {
  return bookPage === null || bookPage === undefined
    ? `<!-- PDF p.${pdfPage} -->`
    : `<!-- PDF p.${pdfPage} · 책 p.${bookPage} -->`;
}

// Guard the coupling: a change to pageComment that PAGE_COMMENT no longer
// matches would silently un-merge page-split code blocks, quietly tripling the
// brace-balance findings instead of failing.
for (const sample of [pageComment(7, null), pageComment(7, 4)]) {
  if (!PAGE_COMMENT.test(sample)) {
    throw new Error(`PAGE_COMMENT does not match pageComment output: ${sample}`);
  }
}
const HEADING_LINE = /^#{1,6}\s/;
/** An ellipsis-only comment line — the book eliding part of a listing on purpose. */
const ELIDED_LINE = /^\s*(\/\/|#|\/\*)\s*\.\.\.\s*(\*\/)?\s*$/;
/**
 * A statement fused with the next line by a dropped newline: either a call or
 * control-flow head starts right after the semicolon, or a block comment opens
 * on the same line.
 *
 * Both halves are narrow on purpose, measured against real source. Bare
 * keywords (`; break;`, `; return x`) were dropped — single-line switch cases
 * use the first and prose in comments trips the second. Line comments were
 * dropped too: `x++;  // note` is ordinary trailing alignment, whereas a block
 * comment opening behind a statement is not something authors write.
 */
const STMT_MERGE = /;\s*[A-Za-z_$][\w$]*\s*[({]|;[ \t]{2,}\/\*/;

/**
 * Size thresholds for the ingest warning. The per-file numbers are GitHub's
 * (50 MiB warns, 100 MiB is refused); the per-book one is ours — 10x the first
 * book ingested, high enough that a normal title stays quiet.
 */
const INGEST_SIZE_WARN_MB = 50;
const GITHUB_FILE_WARN_MB = 50;
const GITHUB_FILE_BLOCK_MB = 100;

/** Below these, an auto-detected page offset is discarded as too shaky to print. */
const PAGE_OFFSET_MIN_SAMPLES = 5;
const PAGE_OFFSET_MIN_AGREEMENT = 0.8;

const DEFAULT_LEVEL = 2;
const HEADING_MAX_LEN = 60;
const NAME_MAX = 60;
const DEFAULT_LIMIT = 30;
/** Below this, the text before the first heading is joined into chapter 1 instead of standing alone. */
const PREAMBLE_MIN = 200;

/** OCR misreads confirmed on the pilot book (design §5.1). Extend via --glossary. */
const DEFAULT_GLOSSARY = { Iru: 'lru', Ifu: 'lfu' };

/** Hosts whose URL path is lowercase by specification, so uppercase there is certainly a misread. */
const LOWERCASE_SLUG_HOSTS = new Set(['leetcode.com']);

const OCR_WARNING = `> [!warning] 이 자료는 스캔본 OCR 산출물이다
> 코드의 인덱스·상수·변수명에 오독 가능성이 있다.
> **코드 블록은 그대로 실행되지 않는다고 전제할 것.** 실측된 결함은 두 가지다 —
> 줄바꿈이 소실돼 두 문장이 한 줄로 붙거나(\`fast = fast.next;while (...) {\`),
> 페이지 경계에서 중괄호가 빠지거나 없던 것이 생긴다. \`check\`의
> \`stmt-merge\`·\`brace-balance\`가 잡아낸 위치는 특히 의심할 것.
> 코드를 인용하거나 동작을 단정하기 전에 원본 PDF 해당 페이지를 확인할 것.
> 이상한 토큰을 발견하면 **조용히 고쳐 읽지 말고 사용자에게 알릴 것.**`;

/** One-line form for individual chapters, which get read without the book index. */
const CHAPTER_OCR_NOTE =
  '> [!warning] 스캔본 OCR — 코드 블록은 그대로 실행되지 않는다고 전제하고, ' +
  '인용 전 원본 PDF 페이지를 확인할 것. 상세는 [[00-toc]].';

const IMAGE_RE = /!\[[^\]]*\]\(([^)\s]+)\)/g;

// --- CLI ---

/** Parse argv into { cmd, opts }. Accepts both `--k v` and `--k=v`. */
function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    const key = (eq === -1 ? arg.slice(2) : arg.slice(2, eq)).replace(/-/g, '_');
    if (eq !== -1) {
      opts[key] = arg.slice(eq + 1);
    } else if (rest[i + 1] && !rest[i + 1].startsWith('--')) {
      opts[key] = rest[++i];
    } else {
      opts[key] = true;
    }
  }
  return { cmd, opts };
}

const USAGE = `ingest-book — scanned book PDF -> chapter markdown -> vault raw/books/

  doctor  [--pdf FILE]                        check this host can run the pipeline
  convert --pdf FILE [--out DIR] [--pages A-B] [--lane L]  marker conversion (~69 min for 462p)
  split   --md FILE --out DIR [--title T] [--level N] [--require-numbering] [--lane L]
          [--page-offset N | --no-page-offset]   인쇄 페이지 병기 (기본: 목차에서 자동 검출)
  check   --dir DIR [--fix] [--glossary FILE] [--json] [--limit N]
  ingest  --dir DIR --book SLUG [--vault PATH] [--force]
  queue   --books DIR [--out DIR] [--plan] [--limit N]
          [--free-floor-gb N] [--max-book-mb N] [--disable-images]
                     bulk convert; resumable. 'touch <out>/STOP' or SIGTERM
                     stops it after the book in flight, never mid-book.`;

function main(argv) {
  const { cmd, opts } = parseArgs(argv);
  if (!cmd || opts.help || cmd === 'help') {
    console.log(USAGE);
    return 0;
  }
  switch (cmd) {
    case 'doctor': return doctor(opts);
    case 'convert': return convert(opts);
    case 'split': return split(opts);
    case 'check': return check(opts);
    case 'ingest': return ingest(opts);
    case 'queue': return queue(opts);
    default:
      console.error(`unknown command: ${cmd}\n\n${USAGE}`);
      return 2;
  }
}

function fail(message) {
  console.error(message);
  return 2;
}

// --- Environment guard ---

/** Is `bin` on PATH? Resolved without a shell so a missing binary is not a shell error. */
function which(bin) {
  const res = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' });
  if (res.status !== 0) return null;
  return res.stdout.split('\n')[0].trim() || null;
}

/**
 * Inspect the host. `required` checks decide whether the pipeline may run at
 * all; the rest are reported so the agent can explain a slow first run.
 *
 * docling is NOT required: it converts web documents (design ADR-2), and the
 * book path never calls it. Refusing a working book conversion over a missing
 * web tool would be a guard that fails the wrong way.
 */
function inspectEnv() {
  const checks = [];
  checks.push({
    id: 'platform', required: true, ok: process.platform === 'darwin',
    detail: process.platform,
    hint: 'marker + surya OCR are set up on the macOS host only; run this there.',
  });
  const marker = which(MARKER_BIN);
  checks.push({
    id: 'marker-pdf', required: true, ok: Boolean(marker),
    detail: marker || 'not on PATH',
    hint: `uv tool install --python 3.12 marker-pdf`,
  });
  const docling = which(DOCLING_BIN);
  checks.push({
    id: 'docling', required: false, ok: Boolean(docling),
    detail: docling || 'not on PATH (web ingest only, book path unaffected)',
    hint: 'uv tool install --python 3.12 docling --with ocrmac',
  });
  const hub = path.join(process.env.HOME || '', '.cache', 'huggingface', 'hub');
  checks.push({
    id: 'surya-models', required: false, ok: fs.existsSync(hub),
    detail: fs.existsSync(hub) ? hub : 'not cached — first run downloads ~3.6GB',
    hint: 'no action needed; the first conversion downloads the models',
  });
  return checks;
}

/** Print the guard result; return an exit code. Every subcommand goes through this. */
function requireEnv() {
  const checks = inspectEnv();
  const missing = checks.filter((c) => c.required && !c.ok);
  if (!missing.length) return 0;
  console.error('ENV refused — this host cannot run the book pipeline:');
  for (const c of missing) console.error(`  ✗ ${c.id}: ${c.detail}\n    ${c.hint}`);
  console.error(`\n  ${INSTALL_HINT}`);
  return 2;
}

function doctor(opts) {
  for (const c of inspectEnv()) {
    const mark = c.ok ? 'ok  ' : c.required ? 'MISS' : 'warn';
    console.log(`${mark} ${c.id.padEnd(13)} ${c.detail}`);
  }
  if (typeof opts.pdf === 'string') {
    const err = validatePdf(opts.pdf);
    console.log(err ? `MISS pdf           ${err}` : `ok   pdf           ${opts.pdf}`);
    if (err) return 2;
  }
  return inspectEnv().some((c) => c.required && !c.ok) ? 2 : 0;
}

// --- convert ---

/**
 * Validate the PDF argument. Returns an error string or null.
 *
 * A directory is refused rather than searched: the book folder is a cloud-sync
 * mount, and enumerating it triggers downloads of every un-synced file
 * (design §9-3). Only the file named on the command line is ever touched.
 */
function validatePdf(pdf) {
  let stat;
  try {
    stat = fs.statSync(pdf);
  } catch {
    return `no such file: ${pdf}`;
  }
  if (stat.isDirectory()) return `directory given; name the single PDF file (cloud-sync folders must not be scanned): ${pdf}`;
  if (!/\.pdf$/i.test(pdf)) return `not a .pdf: ${pdf}`;
  return null;
}

function convert(opts) {
  const guard = requireEnv();
  if (guard) return guard;
  if (typeof opts.pdf !== 'string') return fail('convert: --pdf FILE is required');
  const err = validatePdf(opts.pdf);
  if (err) return fail(`convert: ${err}`);

  const outDir = path.resolve(typeof opts.out === 'string' ? opts.out : './book-out');
  fs.mkdirSync(outDir, { recursive: true });

  const lane = typeof opts.lane === 'string' ? opts.lane : pickLane(opts.pdf).lane;
  if (!LANE_FLAGS[lane]) return fail(`convert: unknown --lane ${lane} (balanced|force_ocr)`);
  const args = [opts.pdf, ...LANE_FLAGS[lane], ...MARKER_BASE_FLAGS, '--output_dir', outDir];
  if (typeof opts.pages === 'string') args.push('--page_range', opts.pages);

  const env = { ...SURYA_TUNING, ...process.env };
  console.log(`convert: lane=${lane}`);
  console.log(`convert: ${MARKER_BIN} ${args.join(' ')}`);
  for (const [key, value] of Object.entries(SURYA_TUNING)) {
    if (process.env[key] === undefined) console.log(`convert: ${key}=${value} (default)`);
  }
  console.log('convert: a 462-page book took ~69 min here; the first run also loads models.');
  const res = spawnSync(MARKER_BIN, args, { stdio: 'inherit', env });
  if (res.status !== 0) return fail(`convert: ${MARKER_BIN} exited ${res.status}`);

  const produced = findMarkdown(outDir);
  if (!produced) return fail(`convert: no markdown found under ${outDir}`);
  console.log(`convert: ${produced} (${(fs.statSync(produced).size / 1024).toFixed(1)} KB)`);
  return 0;
}

/** marker writes <out>/<pdf-stem>/<pdf-stem>.md; find the largest .md under the tree. */
function findMarkdown(dir) {
  let best = null;
  for (const rel of walk(dir)) {
    if (!rel.endsWith('.md')) continue;
    const abs = path.join(dir, rel);
    const size = fs.statSync(abs).size;
    if (!best || size > best.size) best = { abs, size };
  }
  return best && best.abs;
}

function* walk(root, rel = '') {
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      yield* walk(root, childRel);
    } else if (entry.isFile()) {
      yield childRel;
    }
  }
}

// --- split ---

/**
 * Is this line a usable chapter boundary?
 *
 * marker promotes some body sentences to headings (design §3.5), and code
 * blocks contain lines starting with `#` (CSS selectors, shell comments). The
 * design proposed a second marker pass in JSON to read `SectionHeader` blocks
 * instead — that is rejected here: a mis-promoted heading IS a SectionHeader
 * block, so JSON does not solve the real false positive, while a second pass
 * doubles an hour-plus conversion. Fence tracking kills the code-block case, and
 * shape checks kill the sentence case.
 */
function classifyHeading(text, requireNumbering) {
  const numbered = /^\d+(\.\d+)+([.\s]|$)/.test(text);
  if (requireNumbering && !numbered) return { ok: false, reason: 'no section number' };
  if (numbered) return { ok: true };
  if (!text.trim()) return { ok: false, reason: 'empty' };
  if (/^[\d\s.,]+$/.test(text)) return { ok: false, reason: 'digits only' };
  if (/[.。?!]$/.test(text)) return { ok: false, reason: 'ends like a sentence' };
  if (text.length > HEADING_MAX_LEN) return { ok: false, reason: `longer than ${HEADING_MAX_LEN} chars` };
  return { ok: true };
}

/**
 * Cut marker markdown into chapters.
 *
 * Page provenance comes from marker's `--paginate_output` markers, which are
 * 0-indexed (design §9-1); every page number this function emits is that
 * position made 1-indexed — the page's ordinal in the PDF, NOT the number
 * printed on the page. The two differ by however much front matter the book
 * has (23 pages in the first book ingested), so they cannot be derived from
 * each other without a per-book offset. `<!-- PDF p.N -->` is labelled
 * accordingly; a reader who needs the printed number must convert. Markers are
 * replaced rather than dropped, so provenance survives inside a chapter and
 * not just in its header.
 */
function splitChapters(markdown, { level = DEFAULT_LEVEL, requireNumbering = false, pageOffset = null } = {}) {
  const lines = markdown.split('\n');
  const printed = (pdfPage) => printedPage(pdfPage, pageOffset);
  const headingRe = new RegExp(`^(#{1,${level}})\\s+(.*)$`);
  const chapters = [];
  const rejected = [];
  let fence = null;
  let page = null;
  let pageStart = null;
  let current = null;

  const open = (title, startPage) => {
    current = { title, body: [], firstPage: startPage, lastPage: startPage };
    chapters.push(current);
  };

  for (const line of lines) {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      const token = fenceMatch[1][0].repeat(3);
      if (!fence) fence = token;
      else if (token === fence) fence = null;
    }

    const pageMatch = PAGE_MARKER.exec(line);
    if (pageMatch && !fence) {
      page = Number(pageMatch[1]) + 1;
      if (pageStart === null) pageStart = page;
      if (current) {
        current.lastPage = page;
        if (current.firstPage === null) current.firstPage = page;
        current.body.push(pageComment(page, printed(page)));
      }
      continue;
    }

    const headingMatch = !fence && headingRe.exec(line);
    if (headingMatch) {
      const title = headingMatch[2].trim();
      const verdict = classifyHeading(title, requireNumbering);
      if (verdict.ok) {
        open(title, page);
        continue;
      }
      rejected.push({ title, reason: verdict.reason, page });
    }

    if (!current) {
      if (!chapters.length) open(null, page);
      else current = chapters[chapters.length - 1];
    }
    current.body.push(line);
    if (page !== null) current.lastPage = page;
  }

  // A thin preamble is front matter noise; fold it into the first real chapter.
  if (chapters.length > 1 && chapters[0].title === null) {
    const preamble = chapters[0].body.join('\n').trim();
    if (preamble.length < PREAMBLE_MIN) {
      chapters.shift();
    } else {
      chapters[0].title = '머리말 (첫 절 이전 본문)';
    }
  } else if (chapters.length === 1 && chapters[0].title === null) {
    chapters[0].title = '본문';
  }

  for (const ch of chapters) ch.text = `${ch.body.join('\n').trim()}\n`;
  return { chapters, rejected, pageStart, pageEnd: page };
}

/** Chapter file name: `NN-<kebab title>.md`, Korean kept, punctuation dropped. */
function chapterFile(index, title) {
  const slug = slugify(title) || `chapter-${index}`;
  return `${String(index).padStart(2, '0')}-${slug}.md`;
}

function slugify(text) {
  return String(text)
    .replace(/[*_`\\]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, NAME_MAX)
    .replace(/-+$/, '');
}

/**
 * The number printed on the page, or null when it cannot be stated.
 *
 * Front matter sits before page 1 of the numbered body, so anything at or
 * below the offset has no printed number to give (or carries roman numerals
 * this does not attempt to reconstruct).
 */
function printedPage(pdfPage, offset) {
  if (offset === null || offset === undefined) return null;
  const book = pdfPage - offset;
  return book >= 1 ? book : null;
}

/**
 * Recover how far the PDF's page count runs ahead of the book's own.
 *
 * Marker drops running headers and footers, so the printed number is not in
 * the text — but the book's table of contents lists it for every section, and
 * the body repeats those section numbers as headings whose PDF page IS known.
 * Pairing the two gives one offset estimate per section; the mode wins, so a
 * TOC row mangled by OCR (truncated page column, misread digit) is outvoted
 * rather than believed.
 *
 * Returns null unless the vote is decisive — a shaky offset is worse than
 * none, because a wrong printed number sends the reader to the wrong page
 * while looking authoritative.
 */
function detectPageOffset(lines) {
  const toc = new Map();
  const tocRow = /<b>(\d+\.\d+)<\/b>.*?\|\s*(\d+)\s*\|?\s*$/;
  const bodyHeading = /^#{1,6}\s+(\d+\.\d+)(?:\s|$)/;
  const fenceRe = /^\s*(```+|~~~+)/;

  for (const line of lines) {
    const m = tocRow.exec(line);
    if (m && !toc.has(m[1])) toc.set(m[1], Number(m[2]));
  }
  if (!toc.size) return null;

  const votes = new Map();
  const seen = new Set();
  let page = null;
  let fence = false;
  for (const line of lines) {
    if (fenceRe.test(line)) {
      fence = !fence;
      continue;
    }
    const pageMatch = PAGE_MARKER.exec(line);
    if (pageMatch && !fence) {
      page = Number(pageMatch[1]) + 1;
      continue;
    }
    if (fence || page === null) continue;
    const heading = bodyHeading.exec(line);
    if (!heading || seen.has(heading[1]) || !toc.has(heading[1])) continue;
    seen.add(heading[1]);
    const offset = page - toc.get(heading[1]);
    if (offset < 0) continue;
    votes.set(offset, (votes.get(offset) || 0) + 1);
  }

  const total = [...votes.values()].reduce((a, b) => a + b, 0);
  if (total < PAGE_OFFSET_MIN_SAMPLES) return null;
  const [offset, agree] = [...votes].sort((a, b) => b[1] - a[1])[0];
  if (agree / total < PAGE_OFFSET_MIN_AGREEMENT) return null;
  return { offset, samples: total, agree };
}

function pageRange(ch, pageOffset = null) {
  if (ch.firstPage === null || ch.firstPage === undefined) return '(페이지 불명)';
  const pdf = ch.firstPage === ch.lastPage ? `p.${ch.firstPage}` : `p.${ch.firstPage}-${ch.lastPage}`;
  const first = printedPage(ch.firstPage, pageOffset);
  const last = printedPage(ch.lastPage, pageOffset);
  if (first === null && last === null) return pdf;
  // A chapter that starts in the front matter has no printed number to start
  // from, so say so rather than let its end double as its start.
  if (first === null) return `${pdf} · 책 앞부속~p.${last}`;
  if (first === last) return `${pdf} · 책 p.${last}`;
  return `${pdf} · 책 p.${first}-${last}`;
}

function buildToc({ title, source, chapters, files, pageStart, pageEnd, pageOffset = null, offsetSource = 'none', lane = null }) {
  const rows = chapters.map((ch, i) => {
    const lines = ch.text.split('\n').length;
    return `| ${String(i + 1).padStart(2, '0')} | [${escapePipes(ch.title)}](${files[i]}) | ${pageRange(ch, pageOffset)} | ${lines} |`;
  });
  return [
    `# ${title}`,
    '',
    OCR_WARNING,
    '',
    '## 변환 정보',
    '',
    `- 원본: \`${source}\``,
    `- 변환: marker-pdf \`${laneFlagText(lane)}\``,
    `- 변환일: ${today()}`,
    `- 원본 페이지: PDF p.${pageStart ?? '?'}-${pageEnd ?? '?'} (1-indexed로 환산됨)`,
    pageOffset === null
      ? '- 인쇄 페이지: 없음 — PDF 페이지만 표기됨'
      : `- 인쇄 페이지: **책 p.N = PDF p.N - ${pageOffset}** (${offsetSource}). 앞부속(PDF p.1-${pageOffset})은 인쇄 번호가 없어 PDF 페이지만 표기된다`,
    `- 챕터: ${chapters.length}`,
    '',
    '## 챕터',
    '',
    '| # | 제목 | 원본 페이지 | 줄 |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

function escapePipes(text) {
  return String(text).replace(/\|/g, '\\|');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function split(opts) {
  if (typeof opts.md !== 'string') return fail('split: --md FILE is required');
  if (typeof opts.out !== 'string') return fail('split: --out DIR is required');
  if (!fs.existsSync(opts.md)) return fail(`split: no such file: ${opts.md}`);

  const markdown = fs.readFileSync(opts.md, 'utf8');
  const level = Number(opts.level || DEFAULT_LEVEL);

  // Printed page numbers are on by default; --page-offset pins them when the
  // book's TOC is too damaged to vote, --no-page-offset drops them entirely.
  let pageOffset = null;
  let offsetSource = 'none';
  if (opts.no_page_offset) {
    offsetSource = 'disabled';
  } else if (opts.page_offset !== undefined) {
    pageOffset = Number(opts.page_offset);
    if (!Number.isInteger(pageOffset) || pageOffset < 0) {
      return fail('split: --page-offset must be a non-negative integer');
    }
    offsetSource = 'given';
  } else {
    const detected = detectPageOffset(markdown.split('\n'));
    if (detected) {
      pageOffset = detected.offset;
      offsetSource = `detected from ${detected.agree}/${detected.samples} TOC entries`;
    }
  }

  const lane = typeof opts.lane === 'string' ? opts.lane : null;

  const { chapters, rejected, pageStart, pageEnd } = splitChapters(markdown, {
    level,
    requireNumbering: Boolean(opts.require_numbering),
    pageOffset,
  });
  if (!chapters.length) return fail('split: no content found');

  const outDir = path.resolve(opts.out);
  fs.mkdirSync(outDir, { recursive: true });
  const files = chapters.map((ch, i) => chapterFile(i + 1, ch.title));
  chapters.forEach((ch, i) => {
    // The full banner lives in 00-toc.md, but a chapter is what gets opened on
    // its own, so it carries a one-line pointer back to it.
    const header =
      `<!-- 원본: PDF ${pageRange(ch, pageOffset)} -->\n\n# ${ch.title}\n\n${CHAPTER_OCR_NOTE}\n\n`;
    fs.writeFileSync(path.join(outDir, files[i]), header + ch.text, 'utf8');
  });

  const title = typeof opts.title === 'string' ? opts.title : path.basename(opts.md, '.md');
  fs.writeFileSync(
    path.join(outDir, '00-toc.md'),
    buildToc({ title, source: path.basename(opts.md), chapters, files, pageStart, pageEnd, pageOffset, offsetSource }),
    'utf8',
  );

  copyImages(markdown, path.dirname(path.resolve(opts.md)), outDir);

  console.log(`split: ${chapters.length} chapters -> ${outDir}`);
  console.log(`split: pages ${pageStart ?? '?'}-${pageEnd ?? '?'} (1-indexed)`);
  console.log(
    pageOffset === null
      ? `split: printed page numbers omitted (${offsetSource})`
      : `split: printed page = PDF page - ${pageOffset} (${offsetSource})`,
  );
  if (rejected.length) {
    console.log(`split: ${rejected.length} heading candidates left inline (not split points):`);
    for (const r of rejected.slice(0, DEFAULT_LIMIT)) {
      console.log(`  p.${r.page ?? '?'} ${r.reason}: ${truncate(r.title, 70)}`);
    }
    if (rejected.length > DEFAULT_LIMIT) console.log(`  … ${rejected.length - DEFAULT_LIMIT} more`);
  }
  return 0;
}

/** Copy the images the markdown references so a chapter folder renders on its own. */
function copyImages(markdown, fromDir, toDir) {
  let copied = 0;
  for (const m of markdown.matchAll(IMAGE_RE)) {
    const ref = decodeURIComponent(m[1]);
    if (/^[a-z]+:/i.test(ref)) continue;
    const src = path.join(fromDir, ref);
    const dest = path.join(toDir, path.basename(ref));
    if (!fs.existsSync(src) || fs.existsSync(dest)) continue;
    fs.copyFileSync(src, dest);
    copied++;
  }
  if (copied) console.log(`split: ${copied} images copied`);
  return copied;
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// --- check (OCR misread detector, design §5.4) ---

/**
 * Four deterministic rules. `--fix` applies only the two that cannot guess
 * wrong (glossary terms, lowercase-by-spec URL slugs); the two code-block
 * rules are reported and never auto-edited, since repairing OCR'd code needs
 * the source scan.
 *
 * Known limit: this catches KNOWN misreads only. Index/constant/variable
 * corruption (`dp[i][j]` -> `dp[i][i]`) stays invisible — design §5.5.
 */
function checkText(text, glossary) {
  const findings = [];
  const lines = text.split('\n');
  findings.push(...checkCodeBlocks(lines));
  lines.forEach((line, i) => {
    if (/^\s*(```+|~~~+)/.test(line)) return;

    for (const m of line.matchAll(/https?:\/\/[^\s)<>\]]+/g)) {
      const url = m[0];
      const slash = url.indexOf('/', url.indexOf('://') + 3);
      if (slash === -1) continue;
      const host = url.slice(url.indexOf('://') + 3, slash).toLowerCase();
      const urlPath = url.slice(slash);
      if (!/[A-Z]/.test(urlPath)) continue;
      findings.push({
        line: i + 1,
        rule: 'url-case',
        detail: url,
        fixable: LOWERCASE_SLUG_HOSTS.has(host),
      });
    }

    for (const [wrong, right] of Object.entries(glossary)) {
      const re = new RegExp(`\\b${escapeRe(wrong)}\\b`, 'g');
      const hits = line.match(re);
      if (hits) {
        findings.push({ line: i + 1, rule: 'glossary', detail: `${wrong} -> ${right} (${hits.length})`, fixable: true });
      }
    }
  });

  findings.sort((a, b) => a.line - b.line);
  return findings;
}

/**
 * Code-block rules, run over whole blocks rather than line by line.
 *
 * `brace-balance` — marker closes and reopens the fence at every page break
 * (`--paginate_output`), so one logical listing arrives as several blocks,
 * each individually unbalanced. Counting per block reported 6 findings on a
 * 10-page sample where only 2 were real. Blocks are therefore grouped into
 * page-continuation runs and balance is summed per run: an intervening page
 * marker keeps the run open, an intervening heading closes it (a new section
 * means new code). Two classes of legitimate imbalance are then dropped —
 * listings the book itself elides (`// ...`) and the file's first run, which
 * continues from a page outside this file.
 *
 * The run sum also catches what per-block counting could not: when OCR
 * invents closing braces on a page-final block, that block looks balanced but
 * its continuation goes negative, so the run does not sum to zero.
 *
 * `stmt-merge` — OCR drops the newline between a statement and what follows,
 * fusing two lines (`fast = fast.next;while (fast != null) {`). Braces still
 * balance, so nothing else sees it. A trailing comment is normal after one
 * space; the wide gap left by a collapsed line break is the signal.
 */
function checkCodeBlocks(lines) {
  const findings = [];
  const blocks = [];
  let fence = null;
  let start = 0;
  let body = [];

  lines.forEach((line, i) => {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      const token = fenceMatch[1][0].repeat(3);
      if (!fence) {
        fence = token;
        start = i + 1;
        body = [];
      } else if (token === fence) {
        blocks.push({ start, end: i + 1, body });
        fence = null;
      }
      return;
    }
    if (fence) body.push(line);
  });
  if (fence) blocks.push({ start, end: lines.length, body, unterminated: true });

  for (const block of blocks) {
    block.balance = braceBalance(block.body);
    block.elided = block.body.some((l) => ELIDED_LINE.test(l));
    findings.push(...stmtMergeFindings(block));
  }

  for (const [index, run] of continuationRuns(blocks, lines).entries()) {
    const balance = run.reduce((sum, b) => sum + b.balance, 0);
    if (balance === 0) continue;
    // The first run continues from a page this file does not contain, so it
    // closes braces it never opened. Only that direction is explained away —
    // a positive first run has genuinely unclosed braces.
    if ((index === 0 && balance < 0) || run.some((b) => b.elided)) continue;
    const span = run.length > 1 ? ` (${run.length} blocks joined across page breaks)` : '';
    const kind = run.some((b) => b.unterminated) ? 'unterminated code block' : 'code block';
    findings.push({
      line: run[0].start,
      rule: 'brace-balance',
      detail: `${kind} off by ${balance}${span}`,
    });
  }
  return findings;
}

function braceBalance(body) {
  let balance = 0;
  for (const line of body) {
    for (const ch of line) {
      if (ch === '{') balance++;
      else if (ch === '}') balance--;
    }
  }
  return balance;
}

/** Blocks joined by a page break with no heading between them. */
function continuationRuns(blocks, lines) {
  const runs = [];
  let run = [];
  for (const [i, block] of blocks.entries()) {
    if (i === 0) {
      run = [block];
      continue;
    }
    const gap = lines.slice(blocks[i - 1].end, block.start - 1);
    const continues =
      gap.some((l) => PAGE_MARKER.test(l) || PAGE_COMMENT.test(l)) && !gap.some((l) => HEADING_LINE.test(l));
    if (continues) {
      run.push(block);
    } else {
      runs.push(run);
      run = [block];
    }
  }
  if (run.length) runs.push(run);
  return runs;
}

function stmtMergeFindings(block) {
  const findings = [];
  block.body.forEach((line, offset) => {
    const match = STMT_MERGE.exec(line);
    if (!match) return;
    findings.push({
      line: block.start + offset + 1,
      rule: 'stmt-merge',
      detail: truncate(line.trim(), 80),
    });
  });
  return findings;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Apply the two safe rules. Returns the rewritten text. */
function fixText(text, glossary) {
  let out = text;
  for (const [wrong, right] of Object.entries(glossary)) {
    out = out.replace(new RegExp(`\\b${escapeRe(wrong)}\\b`, 'g'), right);
  }
  out = out.replace(/https?:\/\/[^\s)<>\]]+/g, (url) => {
    const start = url.indexOf('://') + 3;
    const slash = url.indexOf('/', start);
    if (slash === -1) return url;
    const host = url.slice(start, slash).toLowerCase();
    if (!LOWERCASE_SLUG_HOSTS.has(host)) return url;
    return url.slice(0, slash) + url.slice(slash).toLowerCase();
  });
  return out;
}

function check(opts) {
  const target = typeof opts.dir === 'string' ? opts.dir : null;
  if (!target) return fail('check: --dir DIR (or FILE) is required');
  if (!fs.existsSync(target)) return fail(`check: no such path: ${target}`);

  let glossary = { ...DEFAULT_GLOSSARY };
  if (typeof opts.glossary === 'string') {
    try {
      glossary = { ...glossary, ...JSON.parse(fs.readFileSync(opts.glossary, 'utf8')) };
    } catch (e) {
      return fail(`check: cannot read glossary ${opts.glossary}: ${e.message}`);
    }
  }

  const stat = fs.statSync(target);
  const files = stat.isDirectory()
    ? [...walk(target)].filter((r) => r.endsWith('.md')).sort().map((r) => path.join(target, r))
    : [target];

  const all = [];
  let fixedFiles = 0;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const findings = checkText(text, glossary);
    for (const f of findings) all.push({ file: path.relative(process.cwd(), file), ...f });
    if (opts.fix) {
      const fixed = fixText(text, glossary);
      if (fixed !== text) {
        fs.writeFileSync(file, fixed, 'utf8');
        fixedFiles++;
      }
    }
  }

  if (opts.json) {
    console.log(JSON.stringify({ files: files.length, findings: all }, null, 2));
    return all.length ? 1 : 0;
  }

  const byRule = new Map();
  for (const f of all) byRule.set(f.rule, (byRule.get(f.rule) || 0) + 1);
  if (!all.length) {
    console.log(`CHECK ok files=${files.length}`);
    return 0;
  }
  const limit = Number(opts.limit || DEFAULT_LIMIT);
  console.log(`CHECK files=${files.length} ${[...byRule].map(([r, n]) => `${r}=${n}`).join(' ')}`);
  for (const f of all.slice(0, limit)) {
    console.log(`  ${f.file}:${f.line} ${f.rule} — ${truncate(f.detail, 90)}`);
  }
  if (all.length > limit) console.log(`  … ${all.length - limit} more (--limit N, --json)`);
  if (opts.fix) console.log(`CHECK fixed ${fixedFiles} files (glossary + lowercase-slug URLs only)`);
  return 1;
}

// --- ingest ---

function vaultPath(opts) {
  return (typeof opts.vault === 'string' && opts.vault)
    || process.env.WIKI_PATH
    || process.env.OBSIDIAN_VAULT_PATH
    || null;
}

/**
 * Copy a chapter folder into `$WIKI/raw/books/<slug>/`, giving every file the
 * raw/ frontmatter SCHEMA.md defines. `sha256` covers the body only — the span
 * after the closing `---` line — which is exactly what lint's raw-drift check
 * hashes; any other span would report drift on every file forever.
 *
 * Book text IS committed to the vault repo: design §1 barred any repository,
 * but the vault's remote is private and the user chose backup and cross-device
 * sync over the blanket ban (2026-08-16). Nothing here is gitignored.
 *
 * log.md is printed, not written: the PostToolUse hook fires on the agent's
 * Write/Edit of log.md, so a script writing it directly would silently skip
 * index regeneration and lint (wiki-schema rule 6/7).
 */
function ingest(opts) {
  const dir = typeof opts.dir === 'string' ? opts.dir : null;
  if (!dir) return fail('ingest: --dir DIR is required');
  if (typeof opts.book !== 'string') return fail('ingest: --book SLUG is required');
  const vault = vaultPath(opts);
  if (!vault) return fail('ingest: set WIKI_PATH (or OBSIDIAN_VAULT_PATH), or pass --vault');
  if (!fs.existsSync(path.join(vault, 'SCHEMA.md'))) return fail(`ingest: not a vault (no SCHEMA.md): ${vault}`);
  if (!fs.existsSync(path.join(dir, '00-toc.md'))) return fail(`ingest: ${dir} has no 00-toc.md — run split first`);

  const slug = slugify(opts.book);
  const booksRoot = path.join(vault, 'raw', 'books');
  const dest = path.join(booksRoot, slug);
  if (fs.existsSync(dest) && !opts.force) return fail(`ingest: ${dest} already exists (--force to overwrite)`);
  fs.mkdirSync(dest, { recursive: true });

  const ingested = today();
  let pages = 0;
  let assets = 0;
  for (const rel of [...walk(dir)].sort()) {
    const src = path.join(dir, rel);
    const target = path.join(dest, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!rel.endsWith('.md')) {
      fs.copyFileSync(src, target);
      assets++;
      continue;
    }
    const body = stripFrontmatter(fs.readFileSync(src, 'utf8'));
    const sha = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
    fs.writeFileSync(target, `---\ningested: ${ingested}\nsha256: ${sha}\n---\n${body}`, 'utf8');
    pages++;
  }

  const rel = `raw/books/${slug}`;
  console.log(`ingest: ${pages} markdown + ${assets} assets -> ${rel}/`);
  warnOnSize(dir, rel);
  console.log('\nlog.md 에 append 할 줄 (직접 Write/Edit 로 추가할 것 — 훅이 그때 lint 를 돌린다):\n');
  console.log(`## [${ingested}] ingest | ${opts.book}`);
  console.log(`- Raw: \`${rel}/\` (${pages} 파일, 책 단위 1줄)`);
  console.log('- Created/Updated: (없음 — raw 적재만)');
  return 0;
}

/**
 * Warn when a book is heavy enough to matter to the vault's git remote.
 *
 * Size varies by an order of magnitude between books, and the cause is
 * invisible until after conversion: marker usually extracts just the figures
 * (the first book ingested came to 5MB from 239 of them), but a book whose
 * pages it treats as images instead yields one scan per page — a few hundred
 * MB for a single title. GitHub blocks individual files over 100 MiB and
 * recommends repositories stay under 1 GB, and because JPEG does not delta
 * compress, a book adds its full weight to the history permanently: deleting
 * it later does not shrink `.git` without a history rewrite.
 *
 * This warns rather than blocks — the size may well be intended.
 */
function warnOnSize(dir, rel) {
  let mdBytes = 0;
  let assetBytes = 0;
  let largest = { rel: null, bytes: 0 };
  for (const entry of walk(dir)) {
    const { size } = fs.statSync(path.join(dir, entry));
    if (entry.endsWith('.md')) mdBytes += size;
    else assetBytes += size;
    if (size > largest.bytes) largest = { rel: entry, bytes: size };
  }

  const totalMb = (mdBytes + assetBytes) / 1024 / 1024;
  const oversizeFile = largest.bytes / 1024 / 1024 >= GITHUB_FILE_WARN_MB;
  if (totalMb < INGEST_SIZE_WARN_MB && !oversizeFile) return;

  console.log('');
  console.log(`ingest: WARNING — ${rel}/ is ${totalMb.toFixed(1)}MB ` +
    `(markdown ${(mdBytes / 1024 / 1024).toFixed(1)}MB + assets ${(assetBytes / 1024 / 1024).toFixed(1)}MB).`);
  console.log(`  Largest file: ${largest.rel} (${(largest.bytes / 1024 / 1024).toFixed(1)}MB)`);
  if (oversizeFile) {
    console.log(`  Files over ${GITHUB_FILE_BLOCK_MB}MB are rejected by GitHub outright.`);
  }
  console.log('  This weight is permanent once committed — removing the book later leaves it in history.');
  console.log('  If the assets are page scans rather than figures, re-convert with --disable_image_extraction.');
}

/** Drop an existing frontmatter block so re-ingest does not nest one inside another. */
function stripFrontmatter(text) {
  if (!text.startsWith('---\n')) return text;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return text;
  let offset = end + 4;
  if (text[offset] === '\r') offset++;
  if (text[offset] === '\n') offset++;
  return text.slice(offset);
}

// --- Queue (bulk conversion) ---

const PDFTOTEXT_BIN = 'pdftotext';
const PDFINFO_BIN = 'pdfinfo';

/** Page count from `pdfinfo`, or null when the tool cannot read the file. */
function pdfPageCount(pdf) {
  const res = spawnSync(PDFINFO_BIN, [pdf], { encoding: 'utf8', maxBuffer: 1 << 20 });
  if (res.status !== 0) return null;
  const match = /^Pages:\s+(\d+)$/m.exec(res.stdout);
  return match ? Number(match[1]) : null;
}

/**
 * Non-whitespace characters `pdftotext` can pull out of the WHOLE document.
 *
 * The whole document matters: a 20-page sample said 261 of 280 books were
 * textless, and the full-document pass agreed — but only because it was run.
 * A book with a text layer on a handful of pages would slip past a sample and
 * then get silently mangled by the balanced lane.
 */
function pdfTextChars(pdf) {
  const res = spawnSync(PDFTOTEXT_BIN, [pdf, '-'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (res.status !== 0) return null;
  return res.stdout.replace(/\s+/g, '').length;
}

/**
 * Route one PDF to an OCR lane. See `LANE_FLAGS` for why the rule is "any text
 * layer at all -> force_ocr": the layer is far more likely to be junk than
 * usable, and the cheap lanes have no way to tell the difference.
 *
 * When `pdftotext` is missing or fails, fall back to `force_ocr` — it is the
 * slower lane but it is the one that cannot silently corrupt a book.
 */
function pickLane(pdf) {
  const chars = pdfTextChars(pdf);
  if (chars === null) return { lane: 'force_ocr', chars: null, reason: 'pdftotext unavailable' };
  if (chars === 0) return { lane: 'balanced', chars: 0, reason: 'no text layer' };
  return { lane: 'force_ocr', chars, reason: 'text layer present (assume junk)' };
}

/** Free bytes on the volume holding `dir`. */
function freeBytes(dir) {
  const st = fs.statfsSync(dir);
  return st.bavail * st.bsize;
}

function dirStats(dir) {
  let bytes = 0;
  let images = 0;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      bytes += fs.statSync(full).size;
      if (/\.(jpe?g|png|webp)$/i.test(entry.name)) images++;
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return { bytes, images };
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m${String(s % 60).padStart(2, '0')}s`;
}

/**
 * Build the work list once and cache it. Scanning the book directory is a
 * deliberate exception to the "never glob the cloud mount" rule that governs
 * `convert`: bulk conversion needs the whole list, and this only runs against a
 * folder the caller has already materialised locally. `queue` refuses to start
 * if any entry is still a cloud placeholder.
 */
function buildManifest(booksDir) {
  const files = fs.readdirSync(booksDir)
    .filter((name) => /\.pdf$/i.test(name))
    .sort();
  const entries = [];
  for (const [index, name] of files.entries()) {
    const full = path.join(booksDir, name);
    const { lane, chars, reason } = pickLane(full);
    const pages = pdfPageCount(full);
    entries.push({ file: name, pages, chars, lane, reason, status: 'pending' });
    process.stderr.write(`\rscanning ${index + 1}/${files.length}`);
  }
  process.stderr.write('\n');
  // Shortest first: an early book that finishes proves the pipeline before a
  // 1,600-page one ties the GPU up for half a day.
  entries.sort((a, b) => (a.pages ?? Infinity) - (b.pages ?? Infinity));
  return entries;
}

function queue(opts) {
  const guard = requireEnv();
  if (guard) return guard;
  for (const bin of [PDFTOTEXT_BIN, PDFINFO_BIN]) {
    if (!which(bin)) return fail(`queue: ${bin} not on PATH (brew install poppler)`);
  }
  if (typeof opts.books !== 'string') return fail('queue: --books DIR is required');
  const booksDir = path.resolve(opts.books);
  if (!fs.existsSync(booksDir) || !fs.statSync(booksDir).isDirectory()) {
    return fail(`queue: --books is not a directory: ${booksDir}`);
  }
  const outRoot = path.resolve(typeof opts.out === 'string' ? opts.out : './book-queue');
  fs.mkdirSync(outRoot, { recursive: true });

  const manifestPath = path.join(outRoot, 'queue.json');
  let entries;
  if (fs.existsSync(manifestPath)) {
    entries = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    console.log(`queue: resuming ${manifestPath}`);
  } else {
    console.log(`queue: building manifest from ${booksDir}`);
    entries = buildManifest(booksDir);
    writeJsonAtomic(manifestPath, entries);
  }

  const byStatus = (s) => entries.filter((e) => e.status === s);
  const pending = byStatus('pending');
  const totalPages = entries.reduce((sum, e) => sum + (e.pages ?? 0), 0);
  const pendingPages = pending.reduce((sum, e) => sum + (e.pages ?? 0), 0);
  const lanes = entries.reduce((acc, e) => ({ ...acc, [e.lane]: (acc[e.lane] ?? 0) + 1 }), {});
  console.log(`queue: ${entries.length} books, ${totalPages} pages total`);
  console.log(`queue: lanes ${Object.entries(lanes).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`queue: done=${byStatus('done').length} failed=${byStatus('failed').length} pending=${pending.length} (${pendingPages} pages)`);

  if (opts.plan) {
    for (const e of pending) console.log(`  ${String(e.pages ?? '?').padStart(5)}p  ${e.lane.padEnd(10)} ${e.file}`);
    return 0;
  }

  const freeFloor = Number(opts.free_floor_gb ?? 20) * 1024 ** 3;
  const maxBookBytes = Number(opts.max_book_mb ?? 300) * 1024 ** 2;
  const limit = opts.limit === undefined ? Infinity : Number(opts.limit);
  const logPath = path.join(outRoot, 'queue.log');
  const note = (line) => {
    console.log(line);
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`);
  };

  // Two ways to ask for a clean stop, both of which let the book in flight
  // finish: `touch <out>/STOP`, or a signal. Killing the process outright
  // instead throws away however much of the current book has been converted -
  // half an hour, for a long one.
  //
  // The handler works even though `spawnSync` blocks the event loop: the signal
  // is delivered to libuv's watcher, which only runs once marker returns, so a
  // signal mid-book lands exactly at the book boundary. A second one is an
  // impatient operator, and gets the immediate exit they asked for.
  const stopFile = path.join(outRoot, 'STOP');
  let stopRequested = false;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      if (stopRequested) process.exit(130);
      stopRequested = true;
      console.log(`\nqueue: ${signal} received — finishing the current book, then stopping (again to force)`);
    });
  }

  let processed = 0;
  let elapsedPages = 0;
  let elapsedSeconds = 0;
  for (const entry of entries) {
    if (entry.status !== 'pending') continue;
    if (stopRequested) { note('queue: stop requested, stopping at a book boundary'); break; }
    if (fs.existsSync(stopFile)) { note(`queue: ${stopFile} present, stopping at a book boundary`); break; }
    if (processed >= limit) { note(`queue: --limit ${limit} reached, stopping`); break; }

    const free = freeBytes(outRoot);
    if (free < freeFloor) {
      note(`queue: STOP — ${(free / 1024 ** 3).toFixed(1)}GB free is below the ${(freeFloor / 1024 ** 3).toFixed(0)}GB floor`);
      break;
    }

    const bookDir = path.join(outRoot, 'books', slugify(entry.file.replace(/\.pdf$/i, '')));
    // A book interrupted mid-run leaves a partial tree; marker would otherwise
    // mix the old output into the retry.
    fs.rmSync(bookDir, { recursive: true, force: true });
    fs.mkdirSync(bookDir, { recursive: true });

    const args = [
      path.join(booksDir, entry.file),
      ...LANE_FLAGS[entry.lane],
      ...MARKER_BASE_FLAGS,
      '--output_dir', bookDir,
    ];
    if (opts.disable_images) args.push('--disable_image_extraction');

    note(`queue: [${processed + 1}] ${entry.file} (${entry.pages ?? '?'}p, ${entry.lane})`);
    const started = Date.now();
    const logFile = path.join(bookDir, 'marker.log');
    const out = fs.openSync(logFile, 'w');
    const res = spawnSync(MARKER_BIN, args, { stdio: ['ignore', out, out], env: { ...SURYA_TUNING, ...process.env } });
    fs.closeSync(out);
    const secs = (Date.now() - started) / 1000;

    entry.secs = Math.round(secs);
    const produced = res.status === 0 ? findMarkdown(bookDir) : null;
    if (res.status !== 0 || !produced) {
      entry.status = 'failed';
      entry.rc = res.status;
      note(`queue:   FAILED rc=${res.status} after ${fmtDuration(secs)} — see ${logFile}`);
    } else {
      const { bytes, images } = dirStats(bookDir);
      entry.status = 'done';
      entry.outBytes = bytes;
      entry.images = images;
      entry.mdBytes = fs.statSync(produced).size;
      const perPage = entry.pages ? secs / entry.pages : null;
      note(`queue:   done in ${fmtDuration(secs)}${perPage ? ` (${perPage.toFixed(1)}s/page)` : ''}, ${(bytes / 1024 ** 2).toFixed(1)}MB, ${images} images`);
      if (bytes > maxBookBytes) {
        note(`queue:   WARNING ${(bytes / 1024 ** 2).toFixed(0)}MB exceeds --max-book-mb; check whether the assets are page scans, not figures`);
      }
      if (entry.pages) { elapsedPages += entry.pages; elapsedSeconds += secs; }
    }
    writeJsonAtomic(manifestPath, entries);
    processed++;
    if (stopRequested || fs.existsSync(stopFile)) { note('queue: stopping — progress is recorded, rerun to resume'); break; }

    // Rate from THIS run only. The recorded 8.9 s/page came from a single book;
    // a live average over several is the number worth trusting.
    if (elapsedPages > 0) {
      const rate = elapsedSeconds / elapsedPages;
      const left = entries.filter((e) => e.status === 'pending').reduce((sum, e) => sum + (e.pages ?? 0), 0);
      note(`queue:   rate ${rate.toFixed(1)}s/page — ${left} pages left, ETA ${fmtDuration(left * rate)}`);
    }
  }

  const failed = byStatus('failed');
  console.log(`queue: done=${byStatus('done').length} failed=${failed.length} pending=${byStatus('pending').length}`);
  for (const e of failed) console.log(`  FAILED rc=${e.rc} ${e.file}`);
  return failed.length > 0 ? 1 : 0;
}

// --- Entry point ---

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) process.exit(main(process.argv.slice(2)));

export { pickLane, buildManifest, laneFlagText, splitChapters, classifyHeading, checkText, fixText, slugify, stripFrontmatter, inspectEnv };
