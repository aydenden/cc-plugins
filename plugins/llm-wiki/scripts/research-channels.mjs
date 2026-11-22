#!/usr/bin/env node
/**
 * llm-wiki research-channels — key-free REST channels for the research path.
 *
 * Dependency-free Node ESM, single file. Runs on macOS / Linux / Windows 11 with
 * nothing but `node` on PATH; uses only node: builtins and global fetch.
 *
 * Wraps exactly the channels that are key-free REST and therefore belong to the
 * mandatory (install-free) layer (ccp-0at, ccp-73z):
 *
 *   papers  arXiv · OpenAlex · Crossref · Europe PMC · PubMed
 *   tweet   cdn.syndication.twimg.com/tweet-result (single tweet, no auth)
 *   reddit  Arctic Shift archive (search within a subreddit, read one thread)
 *
 * Reddit moved here from the optional layer: since 2026-10 www.reddit.com
 * answers search.json with 403 "Blocked" even with a logged-in rdt-cli, RSS ended
 * 2026-11-13, and the public API is announced to close in 2027-03. Arctic Shift
 * is a volunteer-run copy of Reddit with no key and no install, so it is the one
 * path every machine has — with the caveat that scores lag and it can go down.
 *
 * Everything else stays unwrapped: WebSearch / WebFetch are built into Claude
 * Code, context7 is an MCP server, and X collection / YouTube / GitHub already
 * ship their own CLIs.
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
 *   node research-channels.mjs reddit search "<query>" --sub <name> [--after D] [--limit N] [--json]
 *   node research-channels.mjs reddit thread <id|url> [--limit N] [--json]
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

const ARCTIC_SHIFT = 'https://arctic-shift.photon-reddit.com';
/** Post fields requested from search; `permalink` is not selectable, so URLs are rebuilt. */
const REDDIT_POST_FIELDS = 'id,title,selftext,author,subreddit,created_utc,score,num_comments,url';
/** Comments fetched for one thread before collapsing; the printed count is --limit. */
const REDDIT_TREE_LIMIT = 500;
const REDDIT_DEFAULT_COMMENTS = 20;
/**
 * The archive sheds load by answering 422 "Timeout. Maybe slow down a bit" — on
 * 2026-11-22 about half of r/ClaudeAI searches did, independent of the date
 * window, and an identical retry seconds later often succeeded. One retry, then
 * degrade.
 */
const ARCTIC_RETRY_GAP_MS = 3000;
const ARCTIC_TIMEOUT_RE = /^http 422: .*timeout/i;
/** A thread's opening post is the evidence itself, so it gets far more room than an abstract. */
const REDDIT_POST_CHARS = 4000;
const REDDIT_COMMENT_CHARS = 600;
/** Bodies Reddit leaves behind for removed content, and authors that are not people. */
const REDDIT_GONE = new Set(['[removed]', '[deleted]']);
const REDDIT_BOTS = new Set(['AutoModerator']);

const USER_AGENT = 'llm-wiki-research-channels/1.0 (+https://github.com/aydenden/cc-plugins)';

const HELP = `llm-wiki research-channels — key-free REST channels

  node research-channels.mjs papers "<query>" [options]   search the 5 paper sources
  node research-channels.mjs tweet <id|url> [--json]      fetch one tweet, no auth
  node research-channels.mjs reddit search "<query>" --sub <name>   posts in one subreddit
  node research-channels.mjs reddit thread <id|url>       one post and its comments
  node research-channels.mjs sources                      list paper source ids

Options for \`papers\`:
  --source <id,...>   restrict to these sources (default: all)
  --limit N           results per source (default ${DEFAULT_LIMIT})
  --mailto <email>    polite-pool contact for OpenAlex / Crossref
                      (default: $LLM_WIKI_MAILTO)
  --json              full records, untruncated abstracts

Options for \`reddit\` (Arctic Shift archive — no key; scores lag, recent
posts may have no comments yet):
  --sub <name>        subreddit to search (r/ prefix optional)
  --author <name>     search one user's posts instead of / within a subreddit
  --after YYYY-MM-DD  only posts after this date
  --limit N           posts for search (default ${DEFAULT_LIMIT}), comments for
                      thread (default ${REDDIT_DEFAULT_COMMENTS})
  Reddit search needs a subreddit or author — find the subreddit first with
  WebSearch \`site:reddit.com <topic>\`.

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
  if (!response.ok) {
    // APIs explain refusals in the body (the archive's 422 says "Timeout. Maybe
    // slow down a bit"); a bare status code hides whether to narrow or to wait.
    const body = await response.text().catch(() => '');
    let reason = '';
    try {
      reason = JSON.parse(body)?.error || '';
    } catch {
      reason = '';
    }
    throw new ChannelError(`http ${response.status}${reason ? `: ${clean(String(reason)).slice(0, 160)}` : ''}`);
  }
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

// --- Reddit (Arctic Shift) ---

/** Accept a bare id, a `t3_` fullname, or any reddit.com comments URL. */
function redditPostId(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  const bare = /^(?:t3_)?([a-z0-9]{4,12})$/i.exec(trimmed);
  if (bare) return bare[1].toLowerCase();
  const url = /reddit\.com\/(?:r\/[^/]+\/)?comments\/([a-z0-9]{4,12})/i.exec(trimmed);
  return url ? url[1].toLowerCase() : null;
}

function redditDate(utc) {
  return Number.isFinite(utc) ? new Date(utc * 1000).toISOString().slice(0, 10) : null;
}

function redditBody(text) {
  const body = clean(text);
  return body && !REDDIT_GONE.has(body) ? body : null;
}

function compressRedditPost(post) {
  if (!post || typeof post !== 'object' || !post.id) {
    throw new ChannelError('unexpected payload shape — the archive API may have changed');
  }
  const permalink = post.subreddit ? `https://www.reddit.com/r/${post.subreddit}/comments/${post.id}/` : `https://www.reddit.com/comments/${post.id}/`;
  // A self post's `url` points back at reddit; only an outside URL is a separate source.
  const link = typeof post.url === 'string' && !/^https?:\/\/(www\.|old\.)?reddit\.com\//i.test(post.url) ? post.url : null;
  return {
    id: post.id,
    subreddit: post.subreddit || null,
    author: post.author || null,
    date: redditDate(post.created_utc),
    score: post.score ?? null,
    comments: post.num_comments ?? null,
    title: clean(post.title),
    text: redditBody(post.selftext),
    url: permalink,
    link,
  };
}

/**
 * Depth-first walk of an Arctic Shift comment tree, best-scored sibling first so
 * the cap keeps the comments a reader would actually see. Bots and removed bodies
 * are skipped but still descended into: a reply under a deleted comment can be
 * the answer. `more` nodes (collapsed by the server) are counted, not fetched.
 */
function flattenCommentTree(nodes, { limit }) {
  const comments = [];
  let total = 0;
  let more = 0;
  const walk = (list, depth) => {
    const sorted = [...(list || [])].sort((a, b) => (b?.data?.score ?? 0) - (a?.data?.score ?? 0));
    for (const node of sorted) {
      if (node?.kind === 'more') {
        more += (node.data?.children || []).length;
        continue;
      }
      const data = node?.data;
      if (!data) continue;
      const body = redditBody(data.body);
      if (body && !REDDIT_BOTS.has(data.author)) {
        total++;
        if (comments.length < limit) {
          comments.push({ depth, author: data.author || null, score: data.score ?? null, date: redditDate(data.created_utc), body });
        }
      }
      walk(data.replies?.data?.children, depth + 1);
    }
  };
  walk(nodes, 0);
  return { comments, total, more };
}

async function arcticJson(endpoint, params, ctx) {
  const url = `${ARCTIC_SHIFT}${endpoint}?${new URLSearchParams(params)}`;
  let data;
  try {
    data = await httpJson(url, ctx);
  } catch (err) {
    if (!(err instanceof ChannelError) || !ARCTIC_TIMEOUT_RE.test(err.message)) throw err;
    await sleep(ARCTIC_RETRY_GAP_MS);
    data = await httpJson(url, ctx);
  }
  if (data?.error) throw new ChannelError(`archive: ${data.error}`);
  if (!Array.isArray(data?.data)) throw new ChannelError('unexpected payload shape — the archive API may have changed');
  return data.data;
}

// No `sort`: with `sort=desc` every measured search timed out (2026-11-22), and
// without it results already come back newest first.
async function searchReddit(query, opts) {
  const params = { query, limit: String(opts.limit), fields: REDDIT_POST_FIELDS };
  if (opts.sub) params.subreddit = opts.sub;
  if (opts.author) params.author = opts.author;
  if (opts.after) params.after = opts.after;
  return (await arcticJson('/api/posts/search', params, { mailto: null })).map(compressRedditPost);
}

async function fetchRedditThread(id, opts) {
  const ctx = { mailto: null };
  const [posts, tree] = await Promise.all([
    arcticJson('/api/posts/ids', { ids: id, fields: REDDIT_POST_FIELDS }, ctx),
    arcticJson('/api/comments/tree', { link_id: `t3_${id}`, limit: String(REDDIT_TREE_LIMIT) }, ctx),
  ]);
  if (!posts.length) throw new ChannelError('post not in the archive');
  return { post: compressRedditPost(posts[0]), ...flattenCommentTree(tree, { limit: opts.limit }) };
}

// --- CLI ---

function parseArgs(argv) {
  const opts = {
    command: null, positional: [], sources: null, limit: null,
    mailto: process.env.LLM_WIKI_MAILTO || null, json: false, help: false,
    sub: null, author: null, after: null,
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
      case '--sub': opts.sub = next().replace(/^\/?r\//i, ''); break;
      case '--author': opts.author = next().replace(/^\/?u\//i, ''); break;
      case '--after': opts.after = next(); break;
      case '--json': opts.json = true; break;
      case '-h': case '--help': opts.help = true; break;
      default: fail(`unknown argument: ${arg}`);
    }
  }
  if (opts.limit !== null && (!Number.isInteger(opts.limit) || opts.limit < 1)) fail('--limit must be a positive integer');
  if (opts.after !== null && !/^\d{4}-\d{2}-\d{2}$/.test(opts.after)) fail('--after must be YYYY-MM-DD');
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

const REDDIT_CAVEAT = 'source=arctic-shift (archive: scores lag, newest posts may lack comments)';

function printRedditSearch(query, posts, opts) {
  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ query, subreddit: opts.sub, author: opts.author, after: opts.after, total: posts.length, items: posts }, null, 2)}\n`);
    return;
  }
  const scope = [opts.sub && `sub=r/${opts.sub}`, opts.author && `author=u/${opts.author}`, opts.after && `after=${opts.after}`].filter(Boolean).join(' ');
  const out = [`REDDIT search query="${query}" ${scope} results=${posts.length} ${REDDIT_CAVEAT}`];
  posts.forEach((post, index) => {
    out.push('');
    out.push(`[${index + 1}] ${post.title}`);
    out.push(`    r/${post.subreddit} · u/${post.author} · ${post.date || 'undated'} · score ${post.score ?? '?'} · comments ${post.comments ?? '?'}`);
    out.push(`    ${post.url}`);
    if (post.link) out.push(`    link: ${post.link}`);
    if (post.text) out.push(`    ${truncate(post.text, ABSTRACT_CHARS)}`);
  });
  process.stdout.write(`${out.join('\n')}\n`);
}

function printRedditThread(thread, opts) {
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(thread, null, 2)}\n`);
    return;
  }
  const { post } = thread;
  const out = [
    `REDDIT thread id=${post.id} r/${post.subreddit} u/${post.author} date=${post.date || 'unknown'} score=${post.score ?? '?'} comments=${post.comments ?? '?'} ${REDDIT_CAVEAT}`,
    post.title,
    post.url,
  ];
  if (post.link) out.push(`link: ${post.link}`);
  if (post.text) out.push('', truncate(post.text, REDDIT_POST_CHARS));
  out.push('', `--- comments shown=${thread.comments.length} of ${thread.total}${thread.more ? ` (+${thread.more} collapsed, not fetched)` : ''}`);
  for (const c of thread.comments) {
    out.push(`${'  '.repeat(c.depth)}[${c.score ?? '?'}] u/${c.author} ${c.date || ''}: ${truncate(c.body, REDDIT_COMMENT_CHARS)}`);
  }
  process.stdout.write(`${out.join('\n')}\n`);
}

/** Like `tweet`, an archive failure is degradation: one stable line, exit 1. */
async function runReddit(opts) {
  const [action, ...rest] = opts.positional;
  try {
    if (action === 'search') {
      const query = rest.join(' ');
      if (!query) fail('reddit search needs a query: research-channels.mjs reddit search "<query>" --sub <name>');
      if (!opts.sub && !opts.author) {
        fail('reddit search needs --sub <name> or --author <name> (the archive cannot search all of Reddit).\n'
          + 'Find the subreddit first: WebSearch `site:reddit.com <topic>`.');
      }
      printRedditSearch(query, await searchReddit(query, { ...opts, limit: opts.limit ?? DEFAULT_LIMIT }), opts);
      return 0;
    }
    if (action === 'thread') {
      const id = redditPostId(rest[0]);
      if (!id) fail('reddit thread needs a post id or reddit.com comments URL');
      printRedditThread(await fetchRedditThread(id, { limit: opts.limit ?? REDDIT_DEFAULT_COMMENTS }), opts);
      return 0;
    }
    fail('reddit needs a subcommand: search | thread');
  } catch (err) {
    const reason = err instanceof ChannelError ? err.message : String(err.message || err);
    process.stdout.write(`REDDIT unavailable action=${action} reason=${reason}\n`);
    return 1;
  }
  return 2;
}

async function runPapers(opts) {
  const query = opts.positional.length ? opts.positional.join(' ') : null;
  if (!query) fail('papers needs a query: research-channels.mjs papers "<query>"');
  const selected = SOURCES.filter((source) => !opts.sources || opts.sources.includes(source.id));
  const ctx = { limit: opts.limit ?? DEFAULT_LIMIT, mailto: opts.mailto };

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
    case 'reddit': return runReddit(opts);
    case 'sources':
      for (const source of SOURCES) process.stdout.write(`${source.id}\t${source.label}\t${source.coverage}\n`);
      return 0;
    default:
      fail(`unknown command: ${opts.command}\nknown commands: papers, tweet, reddit, sources`);
      return 2;
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exitCode = await main();

export {
  SOURCES, parseArgs, parseArxiv, reconstructAbstract, normalizeDoi, dateFromParts,
  normalizePubdate, mergeRecords, tweetToken, tweetId, compressTweet, stripTags,
  decodeEntities, clean, truncate, formatAuthors,
  redditPostId, compressRedditPost, flattenCommentTree,
};
