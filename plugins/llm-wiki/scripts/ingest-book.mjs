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
 *                              [--require-numbering]
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
const MARKER_FLAGS = ['--force_ocr', '--paginate_output', '--output_format', 'markdown'];

const INSTALL_HINT = [
  'uv tool install --python 3.12 marker-pdf',
  'uv tool install --python 3.12 docling --with ocrmac   # web ingest only',
].join('\n  ');

/** `{12}------------------------------------------------` — marker's page separator, 0-indexed. */
const PAGE_MARKER = /^\{(\d+)\}-{10,}\s*$/;

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
> 코드를 인용하거나 동작을 단정하기 전에 원본 PDF 해당 페이지를 확인할 것.
> 이상한 토큰을 발견하면 **조용히 고쳐 읽지 말고 사용자에게 알릴 것.**`;

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
  convert --pdf FILE [--out DIR] [--pages A-B]   marker conversion (1.3~2h for 462p)
  split   --md FILE --out DIR [--title T] [--level N] [--require-numbering]
  check   --dir DIR [--fix] [--glossary FILE] [--json] [--limit N]
  ingest  --dir DIR --book SLUG [--vault PATH] [--force]`;

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
  const args = [opts.pdf, ...MARKER_FLAGS, '--output_dir', outDir];
  if (typeof opts.pages === 'string') args.push('--page_range', opts.pages);

  console.log(`convert: ${MARKER_BIN} ${args.join(' ')}`);
  console.log('convert: a full book takes 1.3~2h; the first run also loads models.');
  const res = spawnSync(MARKER_BIN, args, { stdio: 'inherit' });
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
 * doubles a 1.3~2h conversion. Fence tracking kills the code-block case, and
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
 * 0-indexed (design §9-1); every page number this function emits is already
 * converted to the 1-indexed number printed on the page. Markers are replaced
 * with `<!-- PDF p.N -->` rather than dropped, so provenance survives inside a
 * chapter and not just in its header.
 */
function splitChapters(markdown, { level = DEFAULT_LEVEL, requireNumbering = false } = {}) {
  const lines = markdown.split('\n');
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
        current.body.push(`<!-- PDF p.${page} -->`);
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

function pageRange(ch) {
  if (ch.firstPage === null || ch.firstPage === undefined) return '(페이지 불명)';
  return ch.firstPage === ch.lastPage ? `p.${ch.firstPage}` : `p.${ch.firstPage}-${ch.lastPage}`;
}

function buildToc({ title, source, chapters, files, pageStart, pageEnd }) {
  const rows = chapters.map((ch, i) => {
    const lines = ch.text.split('\n').length;
    return `| ${String(i + 1).padStart(2, '0')} | [${escapePipes(ch.title)}](${files[i]}) | ${pageRange(ch)} | ${lines} |`;
  });
  return [
    `# ${title}`,
    '',
    OCR_WARNING,
    '',
    '## 변환 정보',
    '',
    `- 원본: \`${source}\``,
    `- 변환: marker-pdf \`${MARKER_FLAGS.join(' ')}\``,
    `- 변환일: ${today()}`,
    `- 원본 페이지: ${pageStart ?? '?'}-${pageEnd ?? '?'} (1-indexed로 환산됨)`,
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
  const { chapters, rejected, pageStart, pageEnd } = splitChapters(markdown, {
    level,
    requireNumbering: Boolean(opts.require_numbering),
  });
  if (!chapters.length) return fail('split: no content found');

  const outDir = path.resolve(opts.out);
  fs.mkdirSync(outDir, { recursive: true });
  const files = chapters.map((ch, i) => chapterFile(i + 1, ch.title));
  chapters.forEach((ch, i) => {
    const header = `<!-- 원본: PDF ${pageRange(ch)} -->\n\n# ${ch.title}\n\n`;
    fs.writeFileSync(path.join(outDir, files[i]), header + ch.text, 'utf8');
  });

  const title = typeof opts.title === 'string' ? opts.title : path.basename(opts.md, '.md');
  fs.writeFileSync(
    path.join(outDir, '00-toc.md'),
    buildToc({ title, source: path.basename(opts.md), chapters, files, pageStart, pageEnd }),
    'utf8',
  );

  copyImages(markdown, path.dirname(path.resolve(opts.md)), outDir);

  console.log(`split: ${chapters.length} chapters -> ${outDir}`);
  console.log(`split: pages ${pageStart ?? '?'}-${pageEnd ?? '?'} (1-indexed)`);
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
 * Three deterministic rules. `--fix` applies only the two that cannot guess
 * wrong (glossary terms, lowercase-by-spec URL slugs); brace imbalance is
 * reported and never auto-edited, since the cause is a split code block
 * (design §3.5), not a character misread.
 *
 * Known limit: this catches KNOWN misreads only. Index/constant/variable
 * corruption (`dp[i][j]` -> `dp[i][i]`) stays invisible — design §5.5.
 */
function checkText(text, glossary) {
  const findings = [];
  const lines = text.split('\n');
  let fence = null;
  let fenceStart = 0;
  let braces = 0;

  lines.forEach((line, i) => {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      const token = fenceMatch[1][0].repeat(3);
      if (!fence) {
        fence = token;
        fenceStart = i + 1;
        braces = 0;
      } else if (token === fence) {
        if (braces !== 0) {
          findings.push({ line: fenceStart, rule: 'brace-balance', detail: `code block off by ${braces}` });
        }
        fence = null;
      }
      return;
    }
    if (fence) {
      for (const ch of line) {
        if (ch === '{') braces++;
        else if (ch === '}') braces--;
      }
    }

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

  if (fence && braces !== 0) {
    findings.push({ line: fenceStart, rule: 'brace-balance', detail: `unterminated code block off by ${braces}` });
  }
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

  // Purchased books must not reach any remote (design §1); the vault has one.
  const ignore = path.join(booksRoot, '.gitignore');
  let ignoreCreated = false;
  if (!fs.existsSync(ignore)) {
    fs.writeFileSync(ignore, '# 구매 저작물 본문은 어떤 원격 저장소에도 올리지 않는다\n*\n!.gitignore\n', 'utf8');
    ignoreCreated = true;
  }

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
  if (ignoreCreated) console.log(`ingest: created ${rel.replace(`/${slug}`, '')}/.gitignore (book text stays off the remote)`);
  console.log('\nlog.md 에 append 할 줄 (직접 Write/Edit 로 추가할 것 — 훅이 그때 lint 를 돌린다):\n');
  console.log(`## [${ingested}] ingest | ${opts.book}`);
  console.log(`- Raw: \`${rel}/\` (${pages} 파일, 책 단위 1줄)`);
  console.log('- Created/Updated: (없음 — raw 적재만)');
  return 0;
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

// --- Entry point ---

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) process.exit(main(process.argv.slice(2)));

export { splitChapters, classifyHeading, checkText, fixText, slugify, stripFrontmatter, inspectEnv };
