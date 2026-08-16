#!/usr/bin/env node
/**
 * llm-wiki lint — vault health check and index generation.
 *
 * Dependency-free Node ESM, single file. Runs on macOS / Linux / Windows 11 with
 * nothing but `node` on PATH; uses only node: builtins.
 *
 * The vault's SCHEMA.md is the single source of truth: required frontmatter
 * fields, the type-to-directory mapping, the removed-field list and the tag
 * taxonomy are all parsed from it, never hardcoded here.
 *
 * Usage:
 *   node lint.mjs [--vault PATH]                  summary (default)
 *   node lint.mjs --group <id> [--json] [--limit N]   drill down into one group
 *   node lint.mjs --write-index                   regenerate directory catalogs
 *   node lint.mjs --groups                        list group ids
 *
 * Output contract (see ccp-hht): the first output is a few summary lines that
 * both a human and an agent read; only drill-down is JSON. Groups are split by
 * nature — `error` (fix now) is listed per group, `backlog` (standing vault
 * state) is folded into one line.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// --- Constants ---

/** Directories never walked when collecting pages or raw sources. */
const IGNORED_DIRS = new Set([
  '.git', '.obsidian', '.makemd', '.memsearch', '.space', '.trash', '.claude',
  'node_modules', '_archive', 'assets',
]);

/** Files that are navigation or bookkeeping, not wiki pages. */
const NON_PAGE_FILES = new Set(['index.md', 'log.md', 'SCHEMA.md', 'CLAUDE.md', 'README.md']);

/** raw/ subdirectories that hold cron collector output — never a queue (ccp-maq). */
const RAW_EXCLUDED = new Set(['feeds', 'assets']);

const STALE_DAYS = 180;
const OVERSIZED_LINES = 200;
const LOG_ROTATION_LIMIT = 500;
const TITLE_DUP_THRESHOLD = 0.5;
const DEFAULT_LIMIT = 30;
const ROOT_HUB_COUNT = 15;
const NAME_MAX = 80;
/** The root index is read whole every session, so its summaries stay short. */
const ROOT_SUMMARY_MAX = 110;

const AUTO_START = '<!-- llm-wiki:auto:start -->';
const AUTO_END = '<!-- llm-wiki:auto:end -->';

/**
 * Group registry. `nature` drives the summary layout, `sort` the drill-down order.
 * Ids are the public contract — commands and skills reference them by name.
 */
const GROUPS = [
  { id: 'broken-links', nature: 'error', label: 'link target missing' },
  { id: 'frontmatter', nature: 'error', label: 'frontmatter invalid' },
  { id: 'raw-drift', nature: 'error', label: 'raw sha256 mismatch' },
  { id: 'log-rotation', nature: 'error', label: 'log.md over rotation limit' },
  { id: 'contested', nature: 'error', label: 'contested / low confidence' },
  { id: 'source-format', nature: 'backlog', label: 'sources element off-shape' },
  { id: 'tags', nature: 'backlog', label: 'tags outside the taxonomy' },
  { id: 'orphans', nature: 'backlog', label: 'no inbound wikilink' },
  { id: 'raw-unabsorbed', nature: 'backlog', label: 'raw queue not absorbed' },
  { id: 'low-confidence-unmarked', nature: 'backlog', label: 'single source, confidence unset' },
  { id: 'stale-pages', nature: 'backlog', label: 'old page with newer sibling' },
  { id: 'oversized', nature: 'backlog', label: 'over 200 lines' },
  { id: 'title-dups', nature: 'backlog', label: 'near-duplicate titles' },
];

// --- CLI ---

/**
 * Parse argv into an options object.
 * Accepts both `--group id` and `--group=id` forms.
 */
function parseArgs(argv) {
  const opts = { vault: null, group: null, json: false, limit: DEFAULT_LIMIT, writeIndex: false, listGroups: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const key = eq === -1 ? arg : arg.slice(0, eq);
    const inlineValue = eq === -1 ? null : arg.slice(eq + 1);
    const next = () => (inlineValue !== null ? inlineValue : argv[++i]);
    switch (key) {
      case '--vault': opts.vault = next(); break;
      case '--group': opts.group = next(); break;
      case '--limit': opts.limit = Number(next()); break;
      case '--json': opts.json = true; break;
      case '--write-index': opts.writeIndex = true; break;
      case '--groups': opts.listGroups = true; break;
      case '-h': case '--help': opts.help = true; break;
      default: fail(`unknown argument: ${arg}`);
    }
  }
  if (opts.group && !GROUPS.some((g) => g.id === opts.group)) {
    fail(`unknown group: ${opts.group}\nknown groups: ${GROUPS.map((g) => g.id).join(', ')}`);
  }
  if (!Number.isInteger(opts.limit) || opts.limit < 1) fail('--limit must be a positive integer');
  return opts;
}

function fail(message) {
  process.stderr.write(`[llm-wiki lint] ${message}\n`);
  process.exit(2);
}

const HELP = `llm-wiki lint — vault health check and index generation

  node lint.mjs [--vault PATH]                     summary
  node lint.mjs --group <id> [--json] [--limit N]  drill down (default limit ${DEFAULT_LIMIT})
  node lint.mjs --write-index [--vault PATH]       regenerate directory catalogs
  node lint.mjs --groups                           list group ids

The vault path comes from --vault, else $WIKI_PATH, else $OBSIDIAN_VAULT_PATH.
`;

// --- Schema (SSoT) ---

/**
 * Read the rules lint enforces out of the vault's SCHEMA.md.
 * Returns { requiredFields, knownFields, removedFields, types: Map<type, dir>, approvedTags }.
 * Fails fast when a section cannot be parsed — a silently empty rule set would
 * report a perfectly healthy vault.
 */
function loadSchema(vault) {
  const schemaPath = path.join(vault, 'SCHEMA.md');
  if (!fs.existsSync(schemaPath)) fail(`${schemaPath} not found — the vault is not an LLM Wiki`);
  const text = fs.readFileSync(schemaPath, 'utf8');

  // Frontmatter contract: the first fenced yaml block under "## Frontmatter".
  const fmSection = section(text, 'Frontmatter');
  const yamlBlock = fmSection && fmSection.match(/```yaml\n([\s\S]*?)```/);
  if (!yamlBlock) fail('SCHEMA.md: could not find the frontmatter yaml block');
  const requiredFields = [];
  const knownFields = [];
  for (const line of yamlBlock[1].split('\n')) {
    const m = line.match(/^([a-z_]+):/);
    if (!m) continue;
    knownFields.push(m[1]);
    if (/#[^#]*\brequired\b/.test(line)) requiredFields.push(m[1]);
  }
  if (!requiredFields.length) fail('SCHEMA.md: no required frontmatter fields found');

  // Removed fields: the backticked list following the "Removed fields" heading.
  const removedChunk = fmSection.split('**Removed fields**')[1];
  const removedFields = removedChunk
    ? [...removedChunk.split('\n\n')[0].matchAll(/`([^`]+)`/g)].map((m) => m[1].replace(/\s*\(.*\)$/, ''))
    : [];

  // type ↔ directory table under "## Page Types & Directories".
  const types = new Map();
  const typeSection = section(text, 'Page Types & Directories');
  if (typeSection) {
    for (const row of typeSection.matchAll(/^\|\s*`([a-z]+)`\s*\|\s*`([^`]+)`\s*\|/gm)) {
      types.set(row[1], row[2].replace(/\/$/, ''));
    }
  }
  if (!types.size) fail('SCHEMA.md: could not parse the type/directory table');

  // Tag taxonomy: every `- \`tag\` —` bullet under "## Tag Taxonomy".
  const taxonomy = section(text, 'Tag Taxonomy');
  const approvedTags = new Set(taxonomy ? [...taxonomy.matchAll(/^-\s*`([^`]+)`/gm)].map((m) => m[1]) : []);
  if (!approvedTags.size) fail('SCHEMA.md: could not parse the tag taxonomy');

  return { requiredFields, knownFields, removedFields, types, approvedTags };
}

/** Extract the body of a `## <name>` section, up to the next `## `. */
function section(text, name) {
  const start = text.indexOf(`\n## ${name}`);
  if (start === -1) return null;
  const rest = text.slice(start + 1);
  const end = rest.indexOf('\n## ', 1);
  return end === -1 ? rest : rest.slice(0, end);
}

// --- Vault scan ---

/** Walk a directory recursively, yielding relative paths of .md files. */
function* walk(root, rel = '') {
  const dir = path.join(root, rel);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      yield* walk(root, childRel);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      yield childRel;
    }
  }
}

/**
 * Minimal YAML frontmatter parser — enough for the eight schema fields.
 * Handles scalars, inline lists (`[a, b]`) and block lists. Returns
 * { fields, order, raw } or null when the file has no frontmatter.
 */
function parseFrontmatter(text) {
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const raw = text.slice(4, end + 1);
  const lines = raw.split('\n');
  const fields = {};
  const order = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!m) continue;
    const [, key, rest] = m;
    order.push(key);
    const value = rest.trim();
    if (value === '') {
      // A block list follows when the next lines are `- item`.
      const items = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
        items.push(stripQuotes(lines[++i].replace(/^\s*-\s+/, '').trim()));
      }
      fields[key] = items.length ? items : '';
    } else if (value.startsWith('[')) {
      fields[key] = value.replace(/^\[|\]$/g, '').split(',').map((s) => stripQuotes(s.trim())).filter(Boolean);
    } else {
      fields[key] = stripQuotes(value);
    }
  }
  // The body starts after the closing `---` line, newline included — that is
  // the span the raw/ sha256: is computed over (verified against the vault).
  let bodyOffset = end + 4;
  if (text[bodyOffset] === '\r') bodyOffset++;
  if (text[bodyOffset] === '\n') bodyOffset++;
  return { fields, order, raw, bodyOffset };
}

function stripQuotes(s) {
  return s.replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim();
}

/** Strip fenced code blocks and inline code so links inside samples don't count. */
function stripCode(text) {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

/** Collect every `[[target]]` in a body, normalized (alias and heading removed). */
function extractLinks(body) {
  const out = [];
  for (const m of stripCode(body).matchAll(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
    const target = m[1].trim();
    if (target) out.push(target);
  }
  return out;
}

/**
 * Load every wiki page (the type directories) plus the link-target universe.
 * Page objects carry frontmatter, body-derived facts and an inbound counter.
 */
function loadVault(vault, schema) {
  const pageDirs = new Set([...schema.types.values()]);
  const pages = [];
  const linkTargets = new Map(); // lookup key -> relative path

  const register = (rel) => {
    const noExt = rel.slice(0, -3);
    const base = path.basename(noExt);
    if (!linkTargets.has(noExt.toLowerCase())) linkTargets.set(noExt.toLowerCase(), rel);
    if (!linkTargets.has(base.toLowerCase())) linkTargets.set(base.toLowerCase(), rel);
  };

  for (const rel of walk(vault)) {
    register(rel);
    const dir = rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : '';
    const name = path.basename(rel);
    if (!pageDirs.has(dir) || NON_PAGE_FILES.has(name)) continue;
    const text = fs.readFileSync(path.join(vault, rel), 'utf8');
    const fm = parseFrontmatter(text);
    const body = fm ? text.slice(fm.bodyOffset) : text;
    const h1 = body.match(/^#\s+(.+)$/m);
    pages.push({
      rel,
      dir,
      text,
      body,
      fm,
      fields: fm ? fm.fields : {},
      name: h1 ? cleanName(h1[1]) : path.basename(rel, '.md'),
      lines: text.split('\n').length,
      links: extractLinks(body),
      inbound: 0,
    });
  }

  // Inbound counts exclude index.md files: generated catalogs link every page,
  // which would erase the orphan signal entirely.
  const byRel = new Map(pages.map((p) => [p.rel, p]));
  for (const page of pages) {
    for (const target of new Set(page.links)) {
      const rel = resolveLink(target, linkTargets);
      const hit = rel && byRel.get(rel);
      if (hit && hit !== page) hit.inbound++;
    }
  }
  return { pages, linkTargets, byRel };
}

/**
 * Turn an H1 into a display name: some pages carry a whole markdown link or a
 * bolded report title as their heading, which would wreck a catalog line.
 */
function cleanName(heading) {
  const text = heading
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return truncate(text, NAME_MAX) || heading.trim();
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function resolveLink(target, linkTargets) {
  const key = target.replace(/\.md$/i, '').toLowerCase();
  return linkTargets.get(key) || null;
}

// --- Raw sources ---

/**
 * Enumerate raw/ items. A directory directly under raw/<kind>/ is one bundle
 * item; a flat .md file is one item (ccp-maq: the unit of judgement is the
 * bundle, so a 114-file doc dump counts once).
 */
function loadRawItems(vault) {
  const rawRoot = path.join(vault, 'raw');
  if (!fs.existsSync(rawRoot)) return [];
  const items = [];
  for (const kind of fs.readdirSync(rawRoot, { withFileTypes: true })) {
    if (!kind.isDirectory() || RAW_EXCLUDED.has(kind.name) || kind.name.startsWith('.')) continue;
    const kindRel = `raw/${kind.name}`;
    for (const entry of fs.readdirSync(path.join(rawRoot, kind.name), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const files = [...walk(vault, `${kindRel}/${entry.name}`)];
        if (files.length) items.push({ rel: `${kindRel}/${entry.name}`, bundle: true, files });
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        items.push({ rel: `${kindRel}/${entry.name}`, bundle: false, files: [`${kindRel}/${entry.name}`] });
      }
    }
  }
  for (const item of items) {
    item.bytes = item.files.reduce((sum, f) => sum + safeSize(path.join(vault, f)), 0);
  }
  return items;
}

function safeSize(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

/** Every `raw/...` path mentioned anywhere in wiki pages (sources: or body marker). */
function collectRawMentions(pages) {
  const mentions = new Set();
  for (const page of pages) {
    for (const m of page.text.matchAll(/raw\/[^\s\]\)"'`,]+/g)) mentions.add(m[0].replace(/[.,]$/, ''));
  }
  return mentions;
}

// --- Checks ---

/**
 * Run every group check. Returns Map<groupId, item[]>, each already sorted by
 * the group's contracted order so `--limit N` means "the top N that matter".
 */
function runChecks(vault, schema, model) {
  const { pages, linkTargets } = model;
  const results = new Map(GROUPS.map((g) => [g.id, []]));
  const today = new Date();

  // broken-links — unresolved [[wikilinks]] and missing raw/ source files.
  const broken = new Map();
  for (const page of pages) {
    for (const target of page.links) {
      if (resolveLink(target, linkTargets)) continue;
      const key = `wikilink:${target}`;
      if (!broken.has(key)) broken.set(key, { kind: 'wikilink', target, refs: 0, from: [] });
      const entry = broken.get(key);
      entry.refs++;
      if (entry.from.length < 5) entry.from.push(page.rel);
    }
    for (const source of asList(page.fields.sources)) {
      if (!source.startsWith('raw/')) continue;
      if (fs.existsSync(path.join(vault, source))) continue;
      const key = `source:${source}`;
      if (!broken.has(key)) broken.set(key, { kind: 'source', target: source, refs: 0, from: [] });
      const entry = broken.get(key);
      entry.refs++;
      if (entry.from.length < 5) entry.from.push(page.rel);
    }
  }
  results.set('broken-links', [...broken.values()].sort((a, b) => b.refs - a.refs || a.target.localeCompare(b.target)));

  // frontmatter — missing required fields, type/directory mismatch, drift keys,
  // malformed sources. Sorted by how broken the page is.
  const fmIssues = [];
  const sourceFormat = [];
  for (const page of pages) {
    const problems = [];
    const offShape = [];
    if (!page.fm) {
      problems.push('no frontmatter');
    } else {
      for (const field of schema.requiredFields) {
        const value = page.fields[field];
        if (value === undefined || value === '' || (Array.isArray(value) && !value.length)) {
          problems.push(`missing ${field}`);
        }
      }
      const type = page.fields.type;
      if (type && !schema.types.has(type)) problems.push(`unknown type ${type}`);
      else if (type && schema.types.get(type) !== page.dir) problems.push(`type ${type} in ${page.dir}/`);
      if (page.fields.sources !== undefined && !Array.isArray(page.fields.sources)) {
        problems.push('sources not a list');
      }
      // Off-shape source elements are legacy formatting across most of the
      // vault (scheme-less URLs, `github.com/…` instead of `github:…`), so they
      // are standing state, not something today's session broke.
      for (const source of asList(page.fields.sources)) {
        if (!source.startsWith('raw/') && !/^(https?:\/\/|github:[\w.-]+\/[\w.-]+|session:\d{4}-\d{2}-\d{2})/.test(source)) {
          offShape.push(source);
        }
      }
      if (offShape.length) sourceFormat.push({ path: page.rel, count: offShape.length, sources: offShape.slice(0, 5) });
      for (const key of page.fm.order) {
        if (schema.removedFields.includes(key)) problems.push(`removed field ${key}`);
        else if (!schema.knownFields.includes(key)) problems.push(`drift field ${key}`);
      }
      if (page.fields.date && !/^\d{4}-\d{2}-\d{2}$/.test(String(page.fields.date))) problems.push('date not YYYY-MM-DD');
    }
    if (problems.length) fmIssues.push({ path: page.rel, count: problems.length, problems });
  }
  results.set('frontmatter', fmIssues.sort((a, b) => b.count - a.count || a.path.localeCompare(b.path)));
  results.set('source-format', sourceFormat.sort((a, b) => b.count - a.count || a.path.localeCompare(b.path)));

  // raw-drift — only files carrying a full sha256 digest. Cron collectors write
  // a short dedup id into the same key; that is a different mechanism and
  // hashing it would report every feed file as drifted.
  const drift = [];
  for (const rel of walk(vault, 'raw')) {
    const text = fs.readFileSync(path.join(vault, rel), 'utf8');
    const fm = parseFrontmatter(text);
    const recorded = fm && fm.fields.sha256;
    if (!recorded || !/^[0-9a-f]{64}$/.test(String(recorded))) continue;
    const actual = crypto.createHash('sha256').update(text.slice(fm.bodyOffset), 'utf8').digest('hex');
    if (actual !== recorded) drift.push({ path: rel, recorded, actual });
  }
  results.set('raw-drift', drift.sort((a, b) => a.path.localeCompare(b.path)));

  // log-rotation — one item, present only when the limit is exceeded.
  const logPath = path.join(vault, 'log.md');
  if (fs.existsSync(logPath)) {
    const entries = (fs.readFileSync(logPath, 'utf8').match(/^## \[/gm) || []).length;
    if (entries > LOG_ROTATION_LIMIT) {
      results.set('log-rotation', [{ path: 'log.md', entries, limit: LOG_ROTATION_LIMIT }]);
    }
  }

  // contested — explicit distrust markers; tiny by design, so an error group.
  results.set('contested', pages
    .filter((p) => String(p.fields.contested) === 'true' || p.fields.confidence === 'low')
    .map((p) => ({ path: p.rel, contested: String(p.fields.contested) === 'true', confidence: p.fields.confidence || null, contradictions: asList(p.fields.contradictions) }))
    .sort((a, b) => a.path.localeCompare(b.path)));

  // tags — tag-centric, not page-centric: the top rows are the work queue of
  // tags to promote into the taxonomy (ccp-hht).
  const tagUse = new Map();
  for (const page of pages) {
    for (const tag of asList(page.fields.tags)) {
      if (schema.approvedTags.has(tag)) continue;
      if (!tagUse.has(tag)) tagUse.set(tag, { tag, count: 0, pages: [] });
      const entry = tagUse.get(tag);
      entry.count++;
      if (entry.pages.length < 5) entry.pages.push(page.rel);
    }
  }
  results.set('tags', [...tagUse.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)));

  // orphans / stale / oversized / low-confidence — page-level scans.
  results.set('orphans', pages.filter((p) => p.inbound === 0)
    .map((p) => ({ path: p.rel, date: p.fields.date || null, outbound: new Set(p.links).size }))
    .sort((a, b) => cmpDateDesc(a.date, b.date) || a.path.localeCompare(b.path)));

  results.set('oversized', pages.filter((p) => p.lines > OVERSIZED_LINES)
    .map((p) => ({ path: p.rel, lines: p.lines }))
    .sort((a, b) => b.lines - a.lines));

  results.set('low-confidence-unmarked', pages
    .filter((p) => asList(p.fields.sources).length === 1 && !p.fields.confidence)
    .map((p) => ({ path: p.rel, source: asList(p.fields.sources)[0] }))
    .sort((a, b) => a.path.localeCompare(b.path)));

  results.set('stale-pages', staleCheck(pages, schema, today));

  // raw-unabsorbed — the queue, folded to bundles, heaviest first.
  const mentions = collectRawMentions(pages);
  const unabsorbed = loadRawItems(vault)
    .filter((item) => !item.files.some((f) => mentions.has(f)) && ![...mentions].some((m) => item.bundle && m.startsWith(`${item.rel}/`)))
    .map((item) => ({ path: item.rel, bundle: item.bundle, files: item.files.length, bytes: item.bytes }))
    .sort((a, b) => b.bytes - a.bytes);
  results.set('raw-unabsorbed', unabsorbed);

  results.set('title-dups', titleDuplicates(pages));
  return results;
}

/**
 * Stale = older than STALE_DAYS *and* a newer page shares an approved tag, i.e.
 * the topic has moved on. `summary` pages are exempt: they record one source at
 * one moment, so an old date is correct (SCHEMA.md stale exception).
 */
function staleCheck(pages, schema, today) {
  const dated = pages.filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(String(p.fields.date || '')));
  const newestByTag = new Map();
  for (const page of dated) {
    for (const tag of asList(page.fields.tags)) {
      if (!schema.approvedTags.has(tag)) continue;
      const current = newestByTag.get(tag);
      if (!current || page.fields.date > current.date) newestByTag.set(tag, { date: page.fields.date, path: page.rel });
    }
  }
  const out = [];
  for (const page of dated) {
    if (page.fields.type === 'summary') continue;
    const age = Math.floor((today - new Date(page.fields.date)) / 86400000);
    if (age < STALE_DAYS) continue;
    let newer = null;
    for (const tag of asList(page.fields.tags)) {
      const candidate = newestByTag.get(tag);
      if (candidate && candidate.path !== page.rel && candidate.date > page.fields.date) {
        if (!newer || candidate.date > newer.date) newer = candidate;
      }
    }
    if (newer) out.push({ path: page.rel, date: page.fields.date, ageDays: age, newer: newer.path });
  }
  return out.sort((a, b) => b.ageDays - a.ageDays);
}

/** Near-duplicate display names by token Jaccard similarity. */
function titleDuplicates(pages) {
  const tokenized = pages.map((p) => ({
    path: p.rel,
    name: p.name,
    tokens: new Set(p.name.toLowerCase().split(/[^0-9a-z가-힣]+/).filter((t) => t.length > 1)),
  }));
  const out = [];
  for (let i = 0; i < tokenized.length; i++) {
    for (let j = i + 1; j < tokenized.length; j++) {
      const a = tokenized[i];
      const b = tokenized[j];
      if (!a.tokens.size || !b.tokens.size) continue;
      let shared = 0;
      for (const t of a.tokens) if (b.tokens.has(t)) shared++;
      if (!shared) continue;
      const similarity = shared / (a.tokens.size + b.tokens.size - shared);
      if (similarity >= TITLE_DUP_THRESHOLD) {
        out.push({ a: a.path, b: b.path, similarity: Number(similarity.toFixed(2)) });
      }
    }
  }
  return out.sort((x, y) => y.similarity - x.similarity);
}

function asList(value) {
  if (value === undefined || value === '' || value === null) return [];
  return Array.isArray(value) ? value : [String(value)];
}

function cmpDateDesc(a, b) {
  return String(b || '').localeCompare(String(a || ''));
}

// --- Index generation ---

/**
 * Regenerate the per-directory catalogs and the root index's auto block.
 * This is a write, deliberately outside the error/backlog report (ccp-rsv):
 * pages are never hand-listed in an index again.
 */
function writeIndexes(vault, schema, model) {
  const written = [];
  const byDir = new Map();
  for (const page of model.pages) {
    if (!byDir.has(page.dir)) byDir.set(page.dir, []);
    byDir.get(page.dir).push(page);
  }

  for (const [type, dir] of schema.types) {
    const pages = (byDir.get(dir) || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    if (!fs.existsSync(path.join(vault, dir))) continue;
    const lines = [
      `# ${dir}/`,
      '',
      `> Generated by llm-wiki lint from page frontmatter — do not hand-edit.`,
      `> ${pages.length} \`${type}\` pages.`,
      '',
    ];
    for (const page of pages) {
      const summary = typeof page.fields.summary === 'string' ? page.fields.summary.trim() : '';
      lines.push(`- [[${page.rel.slice(0, -3)}|${page.name}]] — ${summary || '_(summary missing)_'}`);
    }
    const target = path.join(vault, dir, 'index.md');
    fs.writeFileSync(target, `${lines.join('\n')}\n`, 'utf8');
    written.push({ path: `${dir}/index.md`, pages: pages.length });
  }

  const root = updateRootIndex(vault, schema, model, byDir);
  return { written, root };
}

/**
 * Replace only the marked block in the root index; the category skeleton around
 * it is hand-written and must survive. Hubs are ranked by inbound wikilinks —
 * a mechanical signal, since tags cannot classify (54% of pages carry no
 * approved tag, so tag-based categorisation stays rejected).
 */
function updateRootIndex(vault, schema, model, byDir) {
  const rootPath = path.join(vault, 'index.md');
  if (!fs.existsSync(rootPath)) return { status: 'missing' };
  const text = fs.readFileSync(rootPath, 'utf8');
  const start = text.indexOf(AUTO_START);
  const end = text.indexOf(AUTO_END);
  if (start === -1 || end === -1 || end < start) return { status: 'no-markers' };

  const catalogLines = [];
  for (const [type, dir] of schema.types) {
    if (!fs.existsSync(path.join(vault, dir))) continue;
    catalogLines.push(`- [[${dir}/index|${dir}/]] — ${(byDir.get(dir) || []).length} \`${type}\` pages`);
  }
  const hubs = model.pages.slice().sort((a, b) => b.inbound - a.inbound || a.rel.localeCompare(b.rel)).slice(0, ROOT_HUB_COUNT);
  const hubLines = hubs.map((p) => {
    const summary = typeof p.fields.summary === 'string' ? p.fields.summary.trim() : '';
    return `- [[${p.rel.slice(0, -3)}|${p.name}]] (${p.inbound}) — ${summary ? truncate(summary, ROOT_SUMMARY_MAX) : '_(summary missing)_'}`;
  });

  const block = [
    AUTO_START,
    '',
    '### Directory catalogs',
    '',
    ...catalogLines,
    '',
    `### Hub pages (top ${ROOT_HUB_COUNT} by inbound links)`,
    '',
    ...hubLines,
    '',
    AUTO_END,
  ].join('\n');

  fs.writeFileSync(rootPath, text.slice(0, start) + block + text.slice(end + AUTO_END.length), 'utf8');
  return { status: 'updated', hubs: hubs.length, catalogs: catalogLines.length };
}

// --- Reporting ---

function printSummary(results) {
  const errors = GROUPS.filter((g) => g.nature === 'error');
  const backlog = GROUPS.filter((g) => g.nature === 'backlog');
  const errorTotal = errors.reduce((sum, g) => sum + results.get(g.id).length, 0);
  const backlogTotal = backlog.reduce((sum, g) => sum + results.get(g.id).length, 0);

  const out = [];
  out.push(errorTotal === 0 ? `LINT ok backlog=${backlogTotal}` : `LINT error=${errorTotal} backlog=${backlogTotal}`);
  for (const group of errors) {
    const count = results.get(group.id).length;
    if (count) out.push(`${group.id} ${count}`);
  }
  const backlogParts = backlog.filter((g) => results.get(g.id).length).map((g) => `${g.id} ${results.get(g.id).length}`);
  if (backlogParts.length) out.push(`[backlog] ${backlogParts.join(', ')}`);
  process.stdout.write(`${out.join('\n')}\n`);
}

function printGroup(group, items, opts) {
  const shown = items.slice(0, opts.limit);
  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ group, total: items.length, limit: opts.limit, items: shown }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${group} ${items.length}${items.length > shown.length ? ` (showing ${shown.length})` : ''}\n`);
  for (const item of shown) process.stdout.write(`${JSON.stringify(item)}\n`);
}

// --- Main ---

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(HELP);
    return;
  }
  if (opts.listGroups) {
    for (const g of GROUPS) process.stdout.write(`${g.id}\t${g.nature}\t${g.label}\n`);
    return;
  }

  const vault = opts.vault || process.env.WIKI_PATH || process.env.OBSIDIAN_VAULT_PATH;
  if (!vault) fail('no vault path — pass --vault or set WIKI_PATH');
  if (!fs.existsSync(vault)) fail(`vault not found: ${vault}`);

  const schema = loadSchema(vault);
  const model = loadVault(vault, schema);

  if (opts.writeIndex) {
    const { written, root } = writeIndexes(vault, schema, model);
    for (const entry of written) process.stdout.write(`wrote ${entry.path} (${entry.pages} pages)\n`);
    if (root.status === 'updated') process.stdout.write(`wrote index.md auto block (${root.catalogs} catalogs, ${root.hubs} hubs)\n`);
    else process.stderr.write(`[llm-wiki lint] root index.md not updated: ${root.status} — add ${AUTO_START} / ${AUTO_END}\n`);
    return;
  }

  const results = runChecks(vault, schema, model);
  if (opts.group) printGroup(opts.group, results.get(opts.group), opts);
  else printSummary(results);
}

main();
