/**
 * Regression tests for research-channels.mjs — offline. Every source response is a
 * recorded fixture, so the suite never hits the network and cannot fail because an
 * upstream API is rate-limiting. Run with: node --test scripts/lint.test.mjs scripts/ingest-book.test.mjs scripts/research-channels.test.mjs scripts/setup-channels.test.mjs hooks/post-log.test.mjs
 *
 * Dependency-free: node:test / node:assert only.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import {
  parseArgs, parseArxiv, reconstructAbstract, normalizeDoi, dateFromParts,
  normalizePubdate, mergeRecords, tweetToken, tweetId, compressTweet, stripTags,
  decodeEntities, truncate, formatAuthors, SOURCES,
} from './research-channels.mjs';

const SCRIPT = new URL('./research-channels.mjs', import.meta.url).pathname;

// Trimmed from a real export.arxiv.org response (2026-08-16 shape).
const ARXIV_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2312.10997v5</id>
    <published>2023-12-18T09:16:34Z</published>
    <title>Retrieval-Augmented Generation for Large Language Models:
  A Survey</title>
    <summary>  LLMs face hallucination &amp; outdated knowledge; RAG &lt;helps&gt;.
</summary>
    <author><name>Yunfan Gao</name></author>
    <author><name>Yun Xiong</name></author>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2005.11401v4</id>
    <published>2020-05-22T00:00:00Z</published>
    <title>RAG for Knowledge-Intensive NLP Tasks</title>
    <summary>Second entry.</summary>
    <author><name>Patrick Lewis</name></author>
    <arxiv:doi xmlns:arxiv="http://arxiv.org/schemas/atom">10.5555/EXPLICIT</arxiv:doi>
  </entry>
</feed>`;

// --- arXiv parsing ---

test('parseArxiv extracts every entry with collapsed whitespace and decoded entities', () => {
  const entries = parseArxiv(ARXIV_ATOM);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].title, 'Retrieval-Augmented Generation for Large Language Models: A Survey');
  assert.equal(entries[0].abstract, 'LLMs face hallucination & outdated knowledge; RAG <helps>.');
  assert.deepEqual(entries[0].authors, ['Yunfan Gao', 'Yun Xiong']);
  assert.equal(entries[0].date, '2023-12-18');
  assert.equal(entries[0].source, 'arxiv');
});

test('parseArxiv upgrades the id to https and derives the DataCite DOI', () => {
  const [first] = parseArxiv(ARXIV_ATOM);
  assert.equal(first.url, 'https://arxiv.org/abs/2312.10997v5');
  assert.equal(first.doi, '10.48550/arxiv.2312.10997'); // version stripped, matches OpenAlex
});

test('parseArxiv prefers an explicit arxiv:doi over the derived one', () => {
  assert.equal(parseArxiv(ARXIV_ATOM)[1].doi, '10.5555/explicit');
});

test('parseArxiv returns nothing for an empty feed rather than throwing', () => {
  assert.deepEqual(parseArxiv('<feed></feed>'), []);
});

// --- Field helpers ---

test('reconstructAbstract inverts OpenAlex position maps', () => {
  assert.equal(reconstructAbstract({ Retrieval: [0], augmented: [1], generation: [2, 4], is: [3] }),
    'Retrieval augmented generation is generation');
  assert.equal(reconstructAbstract(null), null);
});

test('normalizeDoi strips the resolver prefix and lowercases', () => {
  assert.equal(normalizeDoi('https://doi.org/10.1145/3777378'), '10.1145/3777378');
  assert.equal(normalizeDoi('http://dx.doi.org/10.48550/ArXiv.1'), '10.48550/arxiv.1');
  assert.equal(normalizeDoi(''), null);
  assert.equal(normalizeDoi(undefined), null);
});

test('dateFromParts pads partial Crossref dates', () => {
  assert.equal(dateFromParts([2026, 3, 11]), '2026-03-11');
  assert.equal(dateFromParts([2026]), '2026-01-01');
  assert.equal(dateFromParts([]), null);
});

test('normalizePubdate handles both PubMed date shapes', () => {
  assert.equal(normalizePubdate('2024/03/11 00:00'), '2024-03-11');
  assert.equal(normalizePubdate('2024 Mar 11'), '2024-03-11');
  assert.equal(normalizePubdate('2024 Mar'), '2024-03');
  assert.equal(normalizePubdate('2024'), '2024');
  assert.equal(normalizePubdate(''), null);
});

test('stripTags survives entity-encoded JATS markup', () => {
  assert.equal(stripTags('&lt;jats:p&gt;<strong>Hi</strong>&lt;/jats:p&gt;').replace(/\s+/g, ' ').trim(), 'Hi');
});

test('decodeEntities resolves &amp; last so escaped entities stay escaped once', () => {
  assert.equal(decodeEntities('a &amp;lt; b'), 'a &lt; b');
  assert.equal(decodeEntities('&#39;quoted&#39;'), "'quoted'");
});

test('truncate and formatAuthors keep text-mode output bounded', () => {
  assert.equal(truncate('abcdef', 4), 'abc…');
  assert.equal(truncate('abc', 4), 'abc');
  assert.equal(formatAuthors([]), 'authors unknown');
  assert.equal(formatAuthors(['A', 'B']), 'A, B');
  assert.equal(formatAuthors(['A', 'B', 'C', 'D']), 'A, B, C et al. (4)');
});

// --- Merging ---

test('mergeRecords collapses the same DOI across sources and fills gaps', () => {
  const merged = mergeRecords([
    { source: 'pubmed', title: 'A Paper', authors: ['X'], date: '2026-01-02', doi: '10.1/a', url: 'https://doi.org/10.1/a', abstract: null },
    { source: 'europepmc', title: 'A Paper (reprint)', authors: [], date: null, doi: '10.1/a', url: null, abstract: 'the abstract' },
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].sources, ['pubmed', 'europepmc']);
  assert.equal(merged[0].abstract, 'the abstract'); // PubMed never returns one
  assert.equal(merged[0].date, '2026-01-02');
  assert.equal(merged[0].source, undefined); // replaced by `sources`
});

test('mergeRecords falls back to a normalised title when a DOI is missing', () => {
  const merged = mergeRecords([
    { source: 'arxiv', title: 'Deep Module Design', authors: ['A'], date: '2025-01-01', doi: null, url: 'u', abstract: null },
    { source: 'crossref', title: 'deep-module design', authors: [], date: null, doi: null, url: null, abstract: 'abs' },
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].sources, ['arxiv', 'crossref']);
});

test('mergeRecords sorts newest first and drops untitled records', () => {
  const merged = mergeRecords([
    { source: 'a', title: 'Old', authors: [], date: '2020-01-01', doi: '10.1/old', url: null, abstract: null },
    { source: 'b', title: null, authors: [], date: '2026-01-01', doi: '10.1/x', url: null, abstract: null },
    { source: 'c', title: 'New', authors: [], date: '2026-01-01', doi: '10.1/new', url: null, abstract: null },
    { source: 'd', title: 'Undated', authors: [], date: null, doi: '10.1/u', url: null, abstract: null },
  ]);
  assert.deepEqual(merged.map((r) => r.title), ['New', 'Old', 'Undated']);
});

// --- Tweet ---

test('tweetToken reproduces tokens that were accepted live', () => {
  // Captured from calls that returned http 200 (2026-08-17).
  assert.equal(tweetToken('20'), '6dq1a2xwd93');
  assert.equal(tweetToken('1885026028428681698'), '4khzf5wde37');
});

test('tweetId accepts bare ids and status URLs, rejects anything else', () => {
  assert.equal(tweetId('20'), '20');
  assert.equal(tweetId('https://x.com/jack/status/20'), '20');
  assert.equal(tweetId('https://twitter.com/karpathy/statuses/1885026028428681698?s=46'), '1885026028428681698');
  assert.equal(tweetId('https://example.com/not-a-tweet'), null);
  assert.equal(tweetId(undefined), null);
});

test('compressTweet keeps text, media, parent and quote', () => {
  const tweet = compressTweet({
    id_str: '1', text: 'hello  world', created_at: '2025-01-30T18:03:21.000Z', favorite_count: 7,
    user: { screen_name: 'karpathy', name: 'Andrej' },
    photos: [{ url: 'https://pbs.twimg.com/media/a.jpg' }],
    mediaDetails: [{ media_url_https: 'https://pbs.twimg.com/media/a.jpg' }],
    parent: { id_str: '0', text: 'root', user: { screen_name: 'jack' } },
    quoted_tweet: { id_str: '2', text: 'quoted', user: { screen_name: 'openai' } },
  });
  assert.equal(tweet.author, '@karpathy');
  assert.equal(tweet.text, 'hello world');
  assert.deepEqual(tweet.media, ['https://pbs.twimg.com/media/a.jpg']); // deduped across both keys
  assert.equal(tweet.parent.author, '@jack');
  assert.equal(tweet.quoted.id, '2');
});

test('compressTweet rejects a payload shape it does not recognise', () => {
  // The endpoint is undocumented; a silent shape change must surface as degradation.
  assert.throws(() => compressTweet({ error: 'gone' }), /may have changed/);
});

// --- CLI ---

test('parseArgs reads both --flag value and --flag=value', () => {
  const opts = parseArgs(['papers', 'deep', 'modules', '--limit=3', '--source', 'arxiv,crossref', '--json']);
  assert.equal(opts.command, 'papers');
  assert.deepEqual(opts.positional, ['deep', 'modules']);
  assert.equal(opts.limit, 3);
  assert.deepEqual(opts.sources, ['arxiv', 'crossref']);
  assert.equal(opts.json, true);
});

test('every source id is selectable and self-describing', () => {
  assert.deepEqual(SOURCES.map((s) => s.id), ['arxiv', 'openalex', 'crossref', 'europepmc', 'pubmed']);
  for (const source of SOURCES) assert.ok(source.label && source.coverage);
});

function runCli(args) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    return { code: err.status, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

test('CLI reports usage errors on exit 2 without touching the network', () => {
  assert.equal(runCli(['papers', 'q', '--source', 'scholar']).code, 2);
  assert.equal(runCli(['papers', 'q', '--limit', '0']).code, 2);
  assert.equal(runCli(['papers']).code, 2);
  assert.equal(runCli(['tweet', 'nope']).code, 2);
  assert.equal(runCli(['bogus-command']).code, 2);
});

test('CLI lists sources and help offline', () => {
  const sources = runCli(['sources']);
  assert.equal(sources.code, 0);
  assert.match(sources.out, /^arxiv\tarXiv\t/m);
  assert.match(runCli(['--help']).out, /research-channels\.mjs papers/);
});
