#!/usr/bin/env node
/**
 * llm-wiki research-channels — key-free REST channels for the research path.
 *
 * Dependency-free Node ESM, single file. Runs on macOS / Linux / Windows 11 with
 * nothing but `node` on PATH; uses only node: builtins and global fetch.
 *
 * Wraps exactly the two channels that are key-free REST and therefore belong to
 * the mandatory (install-free) layer (ccp-0at, ccp-73z):
 *
 *   papers  arXiv · OpenAlex · Crossref · Europe PMC · PubMed
 *   tweet   cdn.syndication.twimg.com/tweet-result (single tweet, no auth)
 *
 * Everything else stays unwrapped: WebSearch / WebFetch are built into Claude
 * Code, context7 is an MCP server, and Reddit / X collection / YouTube / GitHub
 * already ship their own CLIs.
 *
 * The value of this script is twofold:
 *   1. Pinning the traps so they are not rediscovered per call — arXiv returns an
 *      empty body over http://, OpenAlex and Crossref want `mailto=` for the
 *      polite pool, PubMed without a key is capped at 3 req/s, and the tweet
 *      endpoint needs a derived token.
 *   2. Compressing responses — a 6KB Atom document becomes title / authors / DOI
 *      / date / abstract, so the agent's context holds results instead of markup.
 *
 * Usage:
 *   node research-channels.mjs papers "<query>" [--source id,...] [--limit N] [--json]
 *   node research-channels.mjs tweet <id|url> [--json]
 *   node research-channels.mjs sources
 *
 * Degradation is the normal path, not an exception (ccp-0at): a source that
 * fails is reported in `skipped:` and the remaining sources still answer.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

// --- Constants ---

const DEFAULT_LIMIT = 5;
const REQUEST_TIMEOUT_MS = 15000;
/** PubMed without an API key allows 3 req/s; esearch + esummary are sequential. */
const PUBMED_GAP_MS = 350;
/** Text mode truncates abstracts; --json always carries the full text. */
const ABSTRACT_CHARS = 400;
const AUTHORS_SHOWN = 3;

const USER_AGENT = 'llm-wiki-research-channels/1.0 (+https://github.com/aydenden/cc-plugins)';

const HELP = `llm-wiki research-channels — key-free REST channels

  node research-channels.mjs papers "<query>" [options]   search the 5 paper sources
  node research-channels.mjs tweet <id|url> [--json]      fetch one tweet, no auth
  node research-channels.mjs sources                      list paper source ids

Options for \`papers\`:
  --source <id,...>   restrict to these sources (default: all)
  --limit N           results per source (default ${DEFAULT_LIMIT})
  --mailto <email>    polite-pool contact for OpenAlex / Crossref
                      (default: $LLM_WIKI_MAILTO)
  --json              full records, untruncated abstracts

Exit codes: 0 ok · 1 every requested channel failed · 2 usage error
`;

// --- Paper sources ---

/**
 * Each source exposes `search(query, ctx)` returning compressed records:
 * { source, title, authors[], date, doi, url, abstract }.
 * A source that cannot answer throws; the caller degrades and reports it.
 */
const SOURCES = [
  {
    id: 'arxiv',
    label: 'arXiv',
    coverage: 'CS / physics / math preprints',
    async search(query, ctx) {
      // https:// is mandatory — http://export.arxiv.org answers with an empty body.
      const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(`all:${query}`)}&start=0&max_results=${ctx.limit}`;
      const xml = await httpText(url, ctx);
      return parseArxiv(xml);
    },
  },
  {
    id: 'openalex',
    label: 'OpenAlex',
    coverage: 'broadest general scholarly metadata',
    async search(query, ctx) {
      const params = new URLSearchParams({
        search: query,
        'per-page': String(ctx.limit),
        select: 'display_name,authorships,doi,publication_date,abstract_inverted_index,id',
      });
      // `mailto` moves the call into the polite pool — steadier throughput.
      if (ctx.mailto) params.set('mailto', ctx.mailto);
      const data = await httpJson(`https://api.openalex.org/works?${params}`, ctx);
      return (data.results || []).map((work) => ({
        source: 'openalex',
        title: clean(work.display_name),
        authors: (work.authorships || []).map((a) => a.author?.display_name).filter(Boolean),
        date: work.publication_date || null,
        doi: normalizeDoi(work.doi),
        url: work.doi || work.id || null,
        abstract: reconstructAbstract(work.abstract_inverted_index),
      }));
    },
  },
  {
    id: 'crossref',
    label: 'Crossref',
    coverage: 'every registered DOI',
    async search(query, ctx) {
      const params = new URLSearchParams({
        query,
        rows: String(ctx.limit),
        select: 'title,author,DOI,issued,abstract,URL',
      });
      if (ctx.mailto) params.set('mailto', ctx.mailto);
      const data = await httpJson(`https://api.crossref.org/works?${params}`, ctx);
      return (data.message?.items || []).map((item) => ({
        source: 'crossref',
        title: clean(Array.isArray(item.title) ? item.title[0] : item.title),
        authors: (item.author || []).map((a) => [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean),
        date: dateFromParts(item.issued?.['date-parts']?.[0]),
        doi: normalizeDoi(item.DOI),
        url: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : null),
        // Crossref abstracts arrive as JATS XML fragments.
        abstract: clean(stripTags(item.abstract)),
      }));
    },
  },
  {
    id: 'europepmc',
    label: 'Europe PMC',
    coverage: 'biomedical, abstracts included',
    async search(query, ctx) {
      const params = new URLSearchParams({
        query,
        format: 'json',
        pageSize: String(ctx.limit),
        resultType: 'core', // `lite` omits abstractText
      });
      const data = await httpJson(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?${params}`, ctx);
      return (data.resultList?.result || []).map((rec) => ({
        source: 'europepmc',
        title: clean(rec.title),
        authors: rec.authorString ? rec.authorString.replace(/\.$/, '').split(/,\s*/) : [],
        date: rec.firstPublicationDate || null,
        doi: normalizeDoi(rec.doi),
        url: rec.doi ? `https://doi.org/${rec.doi}` : rec.pmid ? `https://europepmc.org/article/MED/${rec.pmid}` : null,
        abstract: clean(stripTags(rec.abstractText)),
      }));
    },
  },
  {
    id: 'pubmed',
    label: 'PubMed',
    coverage: 'biomedical, MeSH-expanded queries',
    async search(query, ctx) {
      // Two sequential calls: esearch yields ids, esummary the metadata. Abstracts
      // would need a third (efetch) call in a different format — Europe PMC already
      // covers the same corpus with abstracts, so they are left out on purpose.
      const searchParams = new URLSearchParams({
        db: 'pubmed', term: query, retmode: 'json', retmax: String(ctx.limit),
      });
      const found = await httpJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${searchParams}`, ctx);
      const ids = found.esearchresult?.idlist || [];
      if (!ids.length) return [];
      await sleep(PUBMED_GAP_MS);
      const sumParams = new URLSearchParams({ db: 'pubmed', id: ids.join(','), retmode: 'json' });
      const summary = await httpJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${sumParams}`, ctx);
      const result = summary.result || {};
      return ids.filter((id) => result[id]).map((id) => {
        const rec = result[id];
        const doi = (rec.articleids || []).find((a) => a.idtype === 'doi')?.value;
        return {
          source: 'pubmed',
          title: clean(rec.title),
          authors: (rec.authors || []).map((a) => a.name).filter(Boolean),
          date: normalizePubdate(rec.sortpubdate || rec.pubdate),
          doi: normalizeDoi(doi),
          url: doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
          abstract: null,
        };
      });
    },
  },
];

// --- HTTP ---

class ChannelError extends Error {}

async function httpGet(url, ctx) {
  let response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': ctx.mailto ? `${USER_AGENT} mailto:${ctx.mailto}` : USER_AGENT, Accept: '*/*' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ChannelError(err.name === 'TimeoutError' ? `timeout after ${REQUEST_TIMEOUT_MS}ms` : `network: ${err.message}`);
  }
  if (!response.ok) throw new ChannelError(`http ${response.status}`);
  return response;
}

async function httpText(url, ctx) {
  const body = await (await httpGet(url, ctx)).text();
  if (!body.trim()) throw new ChannelError('empty body');
  return body;
}

async function httpJson(url, ctx) {
  const body = await httpText(url, ctx);
  try {
    return JSON.parse(body);
  } catch {
    throw new ChannelError('response was not JSON');
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Parsing helpers ---

/**
 * Pull the fields we keep out of an arXiv Atom feed. A real XML parser would be a
 * dependency; the feed's shape is flat and stable enough for tag extraction.
 */
function parseArxiv(xml) {
  const entries = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  while ((match = entryRe.exec(xml)) !== null) {
    const entry = match[1];
    const id = (tagText(entry, 'id') || '').replace(/^http:/, 'https:');
    entries.push({
      source: 'arxiv',
      title: clean(tagText(entry, 'title')),
      authors: [...entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)]
        .map((m) => clean(decodeEntities(m[1]))).filter(Boolean),
      date: (tagText(entry, 'published') || '').slice(0, 10) || null,
      // Most entries carry no <arxiv:doi>; the registered DataCite DOI is derivable
      // from the id, and having it is what merges an arXiv hit with its OpenAlex twin.
      doi: normalizeDoi(tagText(entry, 'arxiv:doi')) || arxivDoi(id),
      url: id || null,
      abstract: clean(tagText(entry, 'summary')),
    });
  }
  return entries;
}

/** `https://arxiv.org/abs/2312.10997v2` -> `10.48550/arxiv.2312.10997`. */
function arxivDoi(id) {
  const match = /arxiv\.org\/abs\/(.+?)(?:v\d+)?$/i.exec(id || '');
  return match ? `10.48550/arxiv.${match[1].toLowerCase()}` : null;
}

function tagText(xml, tag) {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml);
  return match ? decodeEntities(match[1]) : null;
}

function decodeEntities(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');
}

/**
 * Crossref abstracts are JATS fragments that may also be entity-encoded, so tags
 * survive a single strip; decode between two strips to catch both layers.
 */
function stripTags(text) {
  if (typeof text !== 'string') return text;
  return decodeEntities(text.replace(/<[^>]+>/g, ' ')).replace(/<[^>]+>/g, ' ');
}

function clean(text) {
  if (typeof text !== 'string') return null;
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed || null;
}

/** OpenAlex ships abstracts as a token -> positions map; invert it back to prose. */
function reconstructAbstract(inverted) {
  if (!inverted || typeof inverted !== 'object') return null;
  const words = [];
  for (const [word, positions] of Object.entries(inverted)) {
    for (const position of positions || []) words[position] = word;
  }
  return clean(words.join(' '));
}

function normalizeDoi(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').toLowerCase();
}

function dateFromParts(parts) {
  if (!Array.isArray(parts) || !parts.length) return null;
  const [year, month = 1, day = 1] = parts;
  if (!year) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** PubMed dates come as `2024/03/11 00:00` or `2024 Mar 11`. */
function normalizePubdate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const slash = /^(\d{4})\/(\d{2})\/(\d{2})/.exec(value);
  if (slash) return `${slash[1]}-${slash[2]}-${slash[3]}`;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const named = /^(\d{4})(?:\s+([A-Za-z]{3}))?(?:\s+(\d{1,2}))?/.exec(value);
  if (!named) return null;
  const month = named[2] ? MONTHS.indexOf(named[2]) + 1 : null;
  if (!month) return named[1];
  return `${named[1]}-${String(month).padStart(2, '0')}${named[3] ? `-${String(named[3]).padStart(2, '0')}` : ''}`;
}

/**
 * Collapse the same paper found in several sources into one record, since all five
 * sources overlap heavily. The first source wins the fields it has; later ones fill
 * the gaps (typically an abstract PubMed cannot supply).
 */
function mergeRecords(records) {
  const byKey = new Map();
  for (const record of records) {
    if (!record.title) continue;
    const key = record.doi || `title:${record.title.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '')}`;
    const seen = byKey.get(key);
    if (!seen) {
      byKey.set(key, { ...record, sources: [record.source] });
      continue;
    }
    if (!seen.sources.includes(record.source)) seen.sources.push(record.source);
    for (const field of ['date', 'doi', 'url', 'abstract']) {
      if (!seen[field] && record[field]) seen[field] = record[field];
    }
    if (seen.authors.length === 0 && record.authors.length) seen.authors = record.authors;
  }
  const merged = [...byKey.values()];
  merged.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title));
  for (const record of merged) delete record.source;
  return merged;
}

// --- Tweet ---

/**
 * The syndication endpoint derives its token from the tweet id. Undocumented, so
 * it can change without notice — failures degrade rather than throw upward.
 */
function tweetToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

/** Accept a bare id, an x.com/twitter.com status URL, or a URL with query junk. */
function tweetId(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (/^\d{1,25}$/.test(trimmed)) return trimmed;
  const match = /(?:x\.com|twitter\.com)\/[^/]+\/status(?:es)?\/(\d{1,25})/.exec(trimmed);
  return match ? match[1] : null;
}

async function fetchTweet(id, ctx) {
  const params = new URLSearchParams({ id, token: tweetToken(id), lang: 'en' });
  const data = await httpJson(`https://cdn.syndication.twimg.com/tweet-result?${params}`, ctx);
  return compressTweet(data);
}

function compressTweet(data) {
  if (!data || typeof data !== 'object' || (!data.text && !data.user)) {
    throw new ChannelError('unexpected payload shape — the embed endpoint may have changed');
  }
  const media = [
    ...(data.mediaDetails || []).map((m) => m.video_info?.variants?.at(-1)?.url || m.media_url_https),
    ...(data.photos || []).map((p) => p.url),
  ].filter(Boolean);
  return {
    id: data.id_str || null,
    author: data.user?.screen_name ? `@${data.user.screen_name}` : null,
    author_name: data.user?.name || null,
    date: data.created_at || null,
    text: clean(data.text),
    favorites: data.favorite_count ?? null,
    media: [...new Set(media)],
    parent: data.parent ? { id: data.parent.id_str || null, author: data.parent.user?.screen_name ? `@${data.parent.user.screen_name}` : null, text: clean(data.parent.text) } : null,
    quoted: data.quoted_tweet ? { id: data.quoted_tweet.id_str || null, author: data.quoted_tweet.user?.screen_name ? `@${data.quoted_tweet.user.screen_name}` : null, text: clean(data.quoted_tweet.text) } : null,
  };
}

// --- CLI ---

function parseArgs(argv) {
  const opts = {
    command: null, positional: [], sources: null, limit: DEFAULT_LIMIT,
    mailto: process.env.LLM_WIKI_MAILTO || null, json: false, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('-')) {
      if (!opts.command) opts.command = arg;
      else opts.positional.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const key = eq === -1 ? arg : arg.slice(0, eq);
    const inlineValue = eq === -1 ? null : arg.slice(eq + 1);
    const next = () => (inlineValue !== null ? inlineValue : argv[++i]);
    switch (key) {
      case '--source': opts.sources = next().split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--limit': opts.limit = Number(next()); break;
      case '--mailto': opts.mailto = next(); break;
      case '--json': opts.json = true; break;
      case '-h': case '--help': opts.help = true; break;
      default: fail(`unknown argument: ${arg}`);
    }
  }
  if (!Number.isInteger(opts.limit) || opts.limit < 1) fail('--limit must be a positive integer');
  if (opts.sources) {
    const unknown = opts.sources.filter((id) => !SOURCES.some((s) => s.id === id));
    if (unknown.length) fail(`unknown source: ${unknown.join(', ')}\nknown sources: ${SOURCES.map((s) => s.id).join(', ')}`);
  }
  return opts;
}

function fail(message) {
  process.stderr.write(`[llm-wiki research-channels] ${message}\n`);
  process.exit(2);
}

function truncate(text, max) {
  if (typeof text !== 'string') return null;
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function formatAuthors(authors) {
  if (!authors.length) return 'authors unknown';
  return authors.length <= AUTHORS_SHOWN
    ? authors.join(', ')
    : `${authors.slice(0, AUTHORS_SHOWN).join(', ')} et al. (${authors.length})`;
}

/** Summary line first, then one block per paper — the shape agents parse cheaply. */
function printPapers(query, items, used, skipped, opts) {
  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ query, sources: used, skipped, total: items.length, items }, null, 2)}\n`);
    return;
  }
  const out = [`PAPERS query="${query}" results=${items.length} sources=${used.join(',') || 'none'}`];
  for (const entry of skipped) out.push(`skipped: ${entry.source} (${entry.reason})`);
  items.forEach((item, index) => {
    out.push('');
    out.push(`[${index + 1}] ${item.title}`);
    out.push(`    ${formatAuthors(item.authors)} · ${item.date || 'undated'} · ${item.sources.join('+')}${item.doi ? ` · ${item.doi}` : ''}`);
    if (item.url) out.push(`    ${item.url}`);
    if (item.abstract) out.push(`    ${truncate(item.abstract, ABSTRACT_CHARS)}`);
  });
  process.stdout.write(`${out.join('\n')}\n`);
}

function printTweet(tweet, opts) {
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(tweet, null, 2)}\n`);
    return;
  }
  const out = [`TWEET id=${tweet.id} author=${tweet.author || 'unknown'} date=${tweet.date || 'unknown'} favorites=${tweet.favorites ?? '?'}`];
  if (tweet.text) out.push(tweet.text);
  for (const url of tweet.media) out.push(`media: ${url}`);
  if (tweet.parent) out.push(`parent: ${tweet.parent.id} ${tweet.parent.author || ''} — ${truncate(tweet.parent.text, ABSTRACT_CHARS) || ''}`);
  if (tweet.quoted) out.push(`quoted: ${tweet.quoted.id} ${tweet.quoted.author || ''} — ${truncate(tweet.quoted.text, ABSTRACT_CHARS) || ''}`);
  process.stdout.write(`${out.join('\n')}\n`);
}

async function runPapers(opts) {
  const query = opts.positional.length ? opts.positional.join(' ') : null;
  if (!query) fail('papers needs a query: research-channels.mjs papers "<query>"');
  const selected = SOURCES.filter((source) => !opts.sources || opts.sources.includes(source.id));
  const ctx = { limit: opts.limit, mailto: opts.mailto };

  const settled = await Promise.allSettled(selected.map((source) => source.search(query, ctx)));
  const used = [];
  const skipped = [];
  const records = [];
  settled.forEach((result, index) => {
    const source = selected[index];
    if (result.status === 'fulfilled') {
      used.push(source.id);
      records.push(...result.value);
    } else {
      skipped.push({ source: source.id, reason: result.reason instanceof ChannelError ? result.reason.message : String(result.reason?.message || result.reason) });
    }
  });

  printPapers(query, mergeRecords(records), used, skipped, opts);
  // Every channel down is a real failure; a partial answer is the designed degradation.
  return used.length ? 0 : 1;
}

async function runTweet(opts) {
  const id = tweetId(opts.positional[0]);
  if (!id) fail('tweet needs a tweet id or status URL');
  try {
    printTweet(await fetchTweet(id, { mailto: null }), opts);
    return 0;
  } catch (err) {
    const reason = err instanceof ChannelError ? err.message : String(err.message || err);
    process.stdout.write(`TWEET unavailable id=${id} reason=${reason}\n`);
    return 1;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.command) {
    process.stdout.write(HELP);
    return 0;
  }
  switch (opts.command) {
    case 'papers': return runPapers(opts);
    case 'tweet': return runTweet(opts);
    case 'sources':
      for (const source of SOURCES) process.stdout.write(`${source.id}\t${source.label}\t${source.coverage}\n`);
      return 0;
    default:
      fail(`unknown command: ${opts.command}\nknown commands: papers, tweet, sources`);
      return 2;
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exitCode = await main();

export {
  SOURCES, parseArgs, parseArxiv, reconstructAbstract, normalizeDoi, dateFromParts,
  normalizePubdate, mergeRecords, tweetToken, tweetId, compressTweet, stripTags,
  decodeEntities, clean, truncate, formatAuthors,
};
